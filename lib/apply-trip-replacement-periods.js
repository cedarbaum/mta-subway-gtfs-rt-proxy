import {ok} from 'node:assert'
// protobuf.js (used to build the GTFS-Realtime bindings in this project) parses GTFS-Realtime's (u)int64 into its own bespoke `Long` repesentation.
// see also https://github.com/protobufjs/protobuf.js/issues/1151
// see also https://github.com/dcodeIO/long.js/issues/82#issuecomment-1163021226
import {toBigInt as protobufJsLongToBigInt} from 'longfn'
import {Gauge, Summary} from 'prom-client'
import pgFormat from 'pg-format'
import countBy from 'lodash/countBy.js'
import gtfsRtBindings from './mta-gtfs-realtime.pb.js'
import {register as metricsRegister} from './metrics.js'

const {ScheduleRelationship} = gtfsRtBindings.transit_realtime.TripDescriptor

const parseTripReplacementPeriods = (cfg, feedHeader) => {
	const {
		logger,
		logCtx,
	} = cfg

	const feedTimestamp = feedHeader.timestamp
	ok(feedTimestamp, 'missing FeedMessage.header.timestamp')
	const nyctFeedHeader = feedHeader['.nyct_feed_header']
	ok(nyctFeedHeader, 'missing FeedMessage.header[".nyct_feed_header"]')
	const tripReplacementPeriods = nyctFeedHeader.trip_replacement_period
	if (!Array.isArray(tripReplacementPeriods)) {
		return null
	}

	// route_id -> {start: BigInt, end: BigInt}
	const byRouteId = new Map()

	for (const tripReplacementPeriod of tripReplacementPeriods) {
		const {route_id} = tripReplacementPeriod
		if (!route_id) {
			// todo: add metric?
			logger.warn({
				...logCtx,
				tripReplacementPeriod,
			}, 'cannot handle TripReplacementPeriod without route_id')
			continue
		}
		const replPeriod = tripReplacementPeriod.replacement_period
		if (!replPeriod) {
			// todo: add metric?
			logger.warn({
				...logCtx,
				tripReplacementPeriod,
			}, 'cannot handle TripReplacementPeriod without replacement_period')
			continue
		}

		// > TripReplacementPeriod
		// > replacement_period (TimeRange, optional)
		// > The start time is omitted, the end time is currently now + 30 minutes for all routes of the A division.
		// https://api.mta.info/GTFS.pdf
		// Both start & end are UNIX timestamps, so we can safely convert them into a number for the time being.
		const defaultStart = parseInt(String(
			typeof feedTimestamp === 'bigint'
				? feedTimestamp
				: protobufJsLongToBigInt(feedTimestamp)
		), 10)
		const defaultEnd = defaultStart + 30 * 60 // 30 minutes from now
		const start = replPeriod.start
			? parseInt(String(
				typeof replPeriod.start === 'bigint'
					? replPeriod.start
					: protobufJsLongToBigInt(replPeriod.start),
			))
			: defaultStart
		const end = replPeriod.end
			? parseInt(String(
				typeof replPeriod.end === 'bigint'
					? replPeriod.end
					: protobufJsLongToBigInt(replPeriod.end),
			))
			: defaultEnd

		byRouteId.set(route_id, {start, end})
	}

	return byRouteId
}

const _queryTripReplPeriodsTimeSeconds = new Summary({
	name: 'tripreplacementperiods_query_time_seconds',
	help: 'time needed to fetch all trips covered by the TripReplacementPeriods',
	registers: [metricsRegister],
	labelNames: [
		'schedule_feed_digest',
	],
})
const _tripReplPeriodsCanceledTripUpdatesTotal = new Gauge({
	name: 'tripreplperiods_no_of_canceled_trip_updates_total',
	help: 'number of TripUpdates added because of a TripReplacementPeriod',
	registers: [metricsRegister],
	labelNames: [
		'schedule_feed_digest',
		'route_id',
	],
})
// const _tripReplPeriodsCanceledVehiclePositionsTotal = new Gauge({
// 	name: 'tripreplperiods_no_of_canceled_vehicle_positions_total',
// 	help: 'number of VehiclePositions added because of a TripReplacementPeriod',
// 	registers: [metricsRegister],
// 	labelNames: ['route_id'],
// })

const createApplyTripReplacementPeriods = (cfg) => {
	const {
		scheduleFeedDigest, scheduleFeedDigestSlice,
		db,
		logger,
	} = cfg
	const applyTripReplacementPeriods = async (feedMessage) => {
		const logCtx = {
			scheduleFeedDigest,
		}

		// Because it is a UNIX timestamp, it can be safely converted into a number for the time being.
		const {timestamp: _ts} = feedMessage.header
		ok(_ts, 'missing FeedMessage.header.timestamp')
		const tRef = parseInt(String(
			typeof _ts === 'bigint' ? _ts : protobufJsLongToBigInt(_ts),
		), 10)

		const allTripIds = Array.from(new Set(
			feedMessage.entity
			.flatMap(entity => [
				entity.trip_update?.trip?.trip_id,
				entity.vehicle?.trip?.trip_id,
			])
			.filter(item => !!item)
		))
		logger.trace({
			...logCtx,
			allTripIds,
		}, 'not replacing trip IDs already present in the feed')

		let queryTpl = `\
	SELECT DISTINCT ON (ad.route_id, ad.trip_id, "date")
		ad.trip_id,
		route_id,
		("date"::date)::text AS start_date,
		('00:00'::time) + st0.departure_time AS start_time -- cast interval to time
	FROM arrivals_departures ad
	LEFT JOIN stop_times st0 ON ad.trip_id = st0.trip_id AND st0.stop_sequence_consec = 0
	WHERE true
	AND frequencies_it = -1 -- todo
	AND NOT (ad.trip_id = ANY($1))
	AND (
		False
	`
		const queryTplValues = []
		const queryArguments = [
			Array.from(allTripIds),
		]

		const tripReplacementPeriods = parseTripReplacementPeriods({
			logger,
			logCtx,
		}, feedMessage.header)
		if (tripReplacementPeriods === null) {
			logger.debug({
				...logCtx,
				feedMessage,
			}, 'could not parse TripReplacementPeriods, skipping FeedMessage')
			return;
		}

		for (const [route_id, replPeriod] of tripReplacementPeriods) {
			// https://gtfs.org/realtime/reference/#message-timerange
			// > The interval is considered active at time t if t is greater than or equal to the start time and less than the end time.
			// > TimeRange.start – Start time, in POSIX time (i.e., number of seconds since January 1st 1970 00:00:00 UTC). If missing, the interval starts at minus infinity. If a TimeRange is provided, either start or end must be provided - both fields cannot be empty.
			// > TimeRange.end – End time, in POSIX time (i.e., number of seconds since January 1st 1970 00:00:00 UTC). If missing, the interval ends at plus infinity. If a TimeRange is provided, either start or end must be provided - both fields cannot be empty.
			// https://api.mta.info/GTFS.pdf
			// > TripReplacementPeriod
			// > replacement_period – The start time is omitted, the end time is currently now + 30 minutes for all routes of the A division. See transit_realtime.TimeRange.
			// todo: Given the MTA's realtime feed usually only explicitly specifies the status of *current* trip "instances", if we were to use -infinity as the start, *all* not-explicitly-enumerated ones (e.g. those a week ago) would be considered cancelled. Surely this is not the intention. 🤔
			const start = 'start' in replPeriod && replPeriod.start > 0
				? replPeriod.start
				: tRef - 30 * 60 // 30 minutes ago
			const end = 'end' in replPeriod && replPeriod.end > 0
				? replPeriod.end
				: tRef + 30 * 60 // 30 minutes ago
			logger.trace({
				...logCtx,
				route_id,
				start,
				end,
			}, 'applying TripReplacementPeriod') // todo: trace-log?

			// Note: We assume that the *entire trip is affected* (cancelled if it does’t have an entry in the realtime feed) as soon as any part of it is within the TripReplacementPeriod's TimeRange.
			queryTpl += `\
		OR (
			route_id = %L
			-- filter by absolute departure date+time
			AND coalesce(t_arrival, t_departure) >= to_timestamp(%L::int)
			AND coalesce(t_departure, t_arrival) < to_timestamp(%L::int)
			-- allow "cutoffs" by filtering by date
			AND "date" >= dates_filter_min(to_timestamp(%L::int))
			AND "date" <= dates_filter_max(to_timestamp(%L::int))
		)
	`
			queryTplValues.push(
				route_id,
				start, end,
				start, end,
			)
		}

		queryTpl += `\
	)
	ORDER BY ad.route_id, ad.trip_id, "date"
	LIMIT $2
	`
		const limit = 1000
		queryArguments.push(limit)

		const t0 = performance.now()
		const {rows: canceled} = await db.query({
			text: pgFormat(queryTpl, ...queryTplValues),
			values: queryArguments,
		})
		const queryTime = (performance.now() - t0) / 1000
		_queryTripReplPeriodsTimeSeconds.observe({
			schedule_feed_digest: scheduleFeedDigestSlice,
		}, queryTime)
		logger.debug({
			...logCtx,
			queryTime,
		}, 'queried TripReplacementPeriods')

		if (canceled.length >= limit) {
			logger.warn(logCtx, `TripReplacementPeriods query returned ${limit} results, not applying them`)
			return;
		}

		const counts = Object.entries(countBy(canceled, ({route_id}) => route_id))
		for (const [route_id, count] of counts) {
			_tripReplPeriodsCanceledTripUpdatesTotal.set({
				schedule_feed_digest: scheduleFeedDigestSlice,
				route_id,
			}, count)
		}

		// todo: generate VehiclePositions?
		const canceledFeedEntities = canceled.map(({trip_id, route_id, start_date, start_time}) => {
			// start_date has been cast to ISO 8601 in the query above, so we can directly remove the `-`.
			start_date = start_date.replace(/-/g, '')
			return {
				id: `canceled-${start_date}-${trip_id}`,
				trip_update: {
					trip: {
						trip_id,
						route_id,
						start_date,
						start_time,
						schedule_relationship: ScheduleRelationship.CANCELED,
					},
				},
			}
		})
		feedMessage.entity.unshift(...canceledFeedEntities)
	}

	return applyTripReplacementPeriods
}

export {
	createApplyTripReplacementPeriods,
}
