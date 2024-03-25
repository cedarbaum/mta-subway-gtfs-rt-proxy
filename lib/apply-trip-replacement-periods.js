import {ok} from 'node:assert'
// protobuf.js (used to build the GTFS-Realtime bindings in this project) parses GTFS-Realtime's (u)int64 into its own bespoke `Long` repesentation.
// see also https://github.com/protobufjs/protobuf.js/issues/1151
// see also https://github.com/dcodeIO/long.js/issues/82#issuecomment-1163021226
import {toBigInt as protobufJsLongToBigInt} from 'longfn'
import {Gauge, Summary} from 'prom-client'
import pgFormat from 'pg-format'
import countBy from 'lodash/countBy.js'
import gtfsRtBindings from './mta-gtfs-realtime.pb.js'

const {ScheduleRelationship} = gtfsRtBindings.transit_realtime.TripDescriptor

const parseTripReplacementPeriods = (nyctFeedHeader) => {
	const tripReplacementPeriods = nyctFeedHeader.trip_replacement_period
	ok(Array.isArray(tripReplacementPeriods), 'invalid NyctFeedHeader.trip_replacement_period: not an array')

	// route_id -> {start: BigInt, end: BigInt}
	const byRouteId = new Map()

	for (const tripReplacementPeriod of tripReplacementPeriods) {
		const {
			route_id,
			replacement_period: {start = null, end = null},
		} = tripReplacementPeriod
		// todo: assert?
		byRouteId.set(route_id, {
			// Because start & end are UNIX timestamps, the can be safely converted into a number for the time being.
			start: parseInt(String(protobufJsLongToBigInt(start)), 10),
			end: parseInt(String(protobufJsLongToBigInt(end)), 10),
		})
	}

	return byRouteId
}

const createApplyTripReplacementPeriods = (cfg) => {
	const {
		db,
		logger,
		metricsRegister,
	} = cfg

	const _queryTripReplPeriodsTimeSeconds = new Summary({
		name: 'tripreplacementperiods_query_time_seconds',
		help: 'time needed to fetch all trips covered by the TripReplacementPeriods',
		registers: [metricsRegister],
		labelNames: [],
	})
	const _tripReplPeriodsCanceledTripUpdatesTotal = new Gauge({
		name: 'tripreplperiods_nr_of_canceled_trip_updates_total',
		help: 'nr of TripUpdates added because of a TripReplacementPeriod',
		registers: [metricsRegister],
		labelNames: ['route_id'],
	})
	// const _tripReplPeriodsCanceledVehiclePositionsTotal = new Gauge({
	// 	name: 'tripreplperiods_nr_of_canceled_vehicle_positions_total',
	// 	help: 'nr of VehiclePositions added because of a TripReplacementPeriod',
	// 	registers: [metricsRegister],
	// 	labelNames: ['route_id'],
	// })
	const applyTripReplacementPeriods = async (feedMessage) => {
		// Because it is a UNIX timestamp, it can be safely converted into a number for the time being.
		ok(feedMessage.header.timestamp, 'missing FeedMessage.header.timestamp')
		const tRef = parseInt(String(protobufJsLongToBigInt(feedMessage.header.timestamp)), 10)

		const nyctFeedHeader = feedMessage.header['.nyct_feed_header']
		ok(nyctFeedHeader, 'missing FeedMessage.header[".nyct_feed_header"]')

		const allTripIds = Array.from(new Set(
			feedMessage.entity
			.flatMap(entity => [
				entity.trip_update?.trip?.trip_id,
				entity.vehicle?.trip?.trip_id,
			])
			.filter(item => !!item)
		))
		logger.trace({
			allTripIds,
		}, 'not replacing trip IDs already present in the feed')

		let queryTpl = `\
	SELECT DISTINCT ON (ad.trip_id, "date")
		ad.trip_id,
		route_id,
		"date" AS start_date,
		('00:00'::time) + st0.departure_time AS start_time -- cast interval to time
	FROM arrivals_departures ad
	LEFT JOIN stop_times st0 ON ad.trip_id = st0.trip_id AND st0.stop_sequence_consec = 0
	WHERE true
	AND frequencies_it = -1 -- todo
	AND ad.trip_id NOT IN ($1)
	AND (
		False
	`
		const queryTplValues = []
		const queryArguments = [
			Array.from(allTripIds),
		]

		const tripReplacementPeriods = parseTripReplacementPeriods(nyctFeedHeader)
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
		_queryTripReplPeriodsTimeSeconds.observe(queryTime)
		logger.debug({
			queryTime,
		}, 'queried TripReplacementPeriods')

		if (canceled.length >= limit) {
			logger.warn(`TripReplacementPeriods query returned ${limit} results, not applying them`)
			return;
		}

		const counts = Object.entries(countBy(canceled, ({route_id}) => route_id))
		for (const [route_id, count] of counts) {
			_tripReplPeriodsCanceledTripUpdatesTotal.set(count, {route_id})
		}

		// todo: generate VehiclePositions?
		const canceledFeedEntities = canceled.map(({trip_id, route_id, start_date, start_time}) => {
			start_date = [
				start_date.getUTCFullYear(),
				('0' + start_date.getUTCMonth()).slice(-2),
				('0' + start_date.getUTCDate()).slice(-2),
			].join('')
			return {
				id: `deleted-${start_date}-${trip_id}`,
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
