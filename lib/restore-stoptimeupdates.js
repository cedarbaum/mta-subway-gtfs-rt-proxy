import groupBy from 'lodash/groupBy.js'
import {toBigInt as _protobufJsLongToBigInt} from 'longfn'
import {Summary, Gauge} from 'prom-client'
import gtfsRtBindings from './mta-gtfs-realtime.pb.js'
import {register as metricsRegister} from './metrics.js'

const {ScheduleRelationship} = gtfsRtBindings.transit_realtime.TripDescriptor

const MAX_AGE = process.env.STOP_TIME_UPDATES_MAX_AGE_SECONDS
	? parseInt(process.env.STOP_TIME_UPDATES_MAX_AGE_SECONDS)
	: 3 * 60 * 60 // 3h
const CLEAN_INTERVAL = process.env.STOP_TIME_UPDATES_CLEAN_INTERVAL_SECONDS
	? parseInt(process.env.STOP_TIME_UPDATES_CLEAN_INTERVAL_SECONDS)
	: 1 * 60 * 60 // 1h

// protobuf.js (used to build the GTFS-Realtime bindings in this project) parses GTFS-Realtime's (u)int64 into its own bespoke `Long` repesentation.
// see also https://github.com/protobufjs/protobuf.js/issues/1151
// see also https://github.com/dcodeIO/long.js/issues/82#issuecomment-1163021226
const protobufJsLongToBigInt = (val) => {
	if (typeof val === 'bigint') return val
	return _protobufJsLongToBigInt(val)
}

const _restoreStopTimeEvent = (field, sTU, timestamp, prevSTU) => {
	// todo: think about this logic again! what about {arrival,departure}.delay?

	if (
		prevSTU[`${field}_time`] !== null
		&& (
			!sTU[field]?.time
			|| timestamp < prevSTU.timestamp
		)
	) {
		// todo: trace-log
		// todo: add .uncertainty based on how old the measurement is?
		// todo: what about .delay? based on schedule?
		sTU[field] = {
			time: BigInt(prevSTU[`${field}_time`]),
		}
	}
}
const _restoreStopTimeUpdate = (sTU, timestamp, prevSTU) => {
	_restoreStopTimeEvent('arrival', sTU, timestamp, prevSTU)
	_restoreStopTimeEvent('departure', sTU, timestamp, prevSTU)
}

const storeQueryTimeSeconds = new Summary({
	name: 'previous_stoptimeupdates_store_query_time_seconds',
	help: 'time needed to write all StopTimeUpdates seen in the current Realtime feed into the DB',
	registers: [metricsRegister],
	labelNames: [
		'schedule_feed_digest',
	],
})

const restoreQueryTimeSeconds = new Summary({
	name: 'previous_stoptimeupdates_restore_query_time_seconds',
	help: 'time needed to query all previously seen StopTimeUpdates matching the current Realtime feed from the DB',
	registers: [metricsRegister],
	labelNames: [
		'schedule_feed_digest',
	],
})

const cleanQueryTimeSeconds = new Summary({
	name: 'previous_stoptimeupdates_clean_query_time_seconds',
	help: 'time needed to delete old/obsolete previously seen StopTimeUpdates from the DB',
	registers: [metricsRegister],
	labelNames: [
		'schedule_feed_digest',
	],
})
const noCleaned = new Gauge({
	name: 'previous_stoptimeupdates_cleaned_total',
	help: 'number of old/obsolete previously seen StopTimeUpdates cleaned from the DB during the last cleanup',
	registers: [metricsRegister],
	labelNames: [
		'schedule_feed_digest',
	],
})

const createStoreAndRestoreStopTimeUpdatesFromDb = (cfg) => {
	const {
		scheduleFeedDigest, scheduleFeedDigestSlice,
		db,
		logger,
		// todo: expect realtimeFeedName, add to logCtx
	} = cfg

	const _logCtx = {
		scheduleFeedDigest,
	}

	const storeStopTimeUpdatesInDb = async (feedMessage, opt = {}) => {
		const {
			realtimeFeedName,
		} = {
			realtimeFeedName: null,
			...opt,
		}

		const logCtx = {
			..._logCtx,
			realtimeFeedName,
		}

		const feedTimestamp = protobufJsLongToBigInt(feedMessage.header.timestamp)

		const trip_ids = []
		const start_dates = []
		const stop_ids = []
		const timestamps = []
		const arrival_times = []
		const arrival_delays = []
		const departure_times = []
		const departure_delays = []
		for (const feedEntity of feedMessage.entity) {
			// Restoring – and therefore storing – StopTimeUpdates only really makes sense for TripUpdates.
			if (!feedEntity.trip_update) continue
			const tripUpdate = feedEntity.trip_update

			if (!tripUpdate.stop_time_update) {
				const {schedule_relationship} = tripUpdate.trip
				if (schedule_relationship && schedule_relationship !== ScheduleRelationship.SCHEDULED) {
					logger.warn({
						...logCtx,
						tripUpdate,
					}, 'TripUpdate without stop_time_update[] even though its schedule_relationship is SCHEDULED, skipping storing')
				} else {
					logger.debug({
						...logCtx,
						tripUpdate,
					}, 'TripUpdate without stop_time_update[], skipping storing')
				}
				continue
			}

			for (const stopTimeUpdate of tripUpdate.stop_time_update) {
				if (
					!tripUpdate.trip?.trip_id
					|| !tripUpdate.trip?.start_date
					|| !stopTimeUpdate.stop_id
				) continue // todo: log?

				trip_ids.push(tripUpdate.trip.trip_id)
				start_dates.push(tripUpdate.trip.start_date)
				stop_ids.push(stopTimeUpdate.stop_id)
				timestamps.push(tripUpdate.timestamp
					&& protobufJsLongToBigInt(tripUpdate.timestamp)
					|| feedTimestamp
				)

				// We prefer {arrival,departure}_time over {arrival,departure}_delay.
				const arrival_time = stopTimeUpdate.arrival?.time
					&& protobufJsLongToBigInt(stopTimeUpdate.arrival.time)
					|| null
				arrival_times.push(arrival_time)
				const departure_time = stopTimeUpdate.departure?.time
					&& protobufJsLongToBigInt(stopTimeUpdate.departure.time)
					|| null
				arrival_delays.push(arrival_time === null
					? (
						stopTimeUpdate.arrival?.delay
							&& protobufJsLongToBigInt(stopTimeUpdate.arrival.delay)
							|| null
					)
					: null
				)
				departure_times.push(departure_time)
				departure_delays.push(departure_time === null
					? (
						stopTimeUpdate.departure?.delay
							&& protobufJsLongToBigInt(stopTimeUpdate.departure.delay)
							|| null
					)
					: null
				)
			}
		}
		const nrOfStopTimeUpdates = timestamps.length

		const t0 = performance.now()
		// https://github.com/brianc/node-postgres/issues/957#issuecomment-295583050
		await db.query(`\
			INSERT INTO previous_stoptimeupdates (
				trip_id, start_date, stop_id,
				"timestamp",
				arrival_time, arrival_delay,
				departure_time, departure_delay
			)
			SELECT * FROM UNNEST (
				$1::text[], $2::timestamp without time zone[], $3::text[],
				$4::integer[],
				$5::integer[], $6::integer[],
				$7::integer[], $8::integer[]
			)
			-- todo: define a trigger on the table instead? seems cleaner
			ON CONFLICT ON CONSTRAINT previous_stoptimeupdates_unique DO UPDATE
				SET
					"timestamp" = excluded."timestamp",
					-- todo: with an update providing only arrival_{time,delay}, do we want to keep departure_{time,delay}?
					arrival_time = excluded.arrival_time,
					arrival_delay = excluded.arrival_delay,
					departure_time = excluded.departure_time,
					departure_delay = excluded.departure_delay
				WHERE excluded."timestamp" >= previous_stoptimeupdates."timestamp";
		`, [
			trip_ids,
			start_dates,
			stop_ids,
			timestamps,
			arrival_times,
			arrival_delays,
			departure_times,
			departure_delays,
		])
		const queryTime = (performance.now() - t0) / 1000
		storeQueryTimeSeconds.observe({
			schedule_feed_digest: scheduleFeedDigestSlice,
		}, queryTime)
		logger.debug({
			...logCtx,
			queryTime,
			nrOfStopTimeUpdates,
		}, 'queried TripReplacementPeriods')
		// todo: add metric for number of newly stored StopTimeUpdates?
	}

	const restoreStopTimeUpdatesFromDb = async (feedMessage, opt = {}) => {
		const {
			realtimeFeedName,
		} = {
			realtimeFeedName: null,
			...opt,
		}

		const logCtx = {
			..._logCtx,
			realtimeFeedName,
		}

		// todo: use stop_sequence!
		let query = `\
			SELECT
				trip_id,
				(start_date::date)::text AS start_date,
				stop_id,
				"timestamp",
				arrival_time, arrival_delay,
				departure_time, departure_delay
			FROM previous_stoptimeupdates
			WHERE False -- "OR"s follow
`
		const values = []
		let valuesI = 1, nrOfTrips = 0
		for (const feedEntity of feedMessage.entity) {
			// Restoring – and therefore storing – StopTimeUpdates only really makes sense for TripUpdates.
			if (!feedEntity.trip_update) continue
			const tripUpdate = feedEntity.trip_update

			query += `\
				OR (trip_id = $${valuesI++} AND start_date = $${valuesI++})
			`

			// convert to ISO 8601 (PostgreSQL-compatible)
			const isoStartDate = [
				tripUpdate.trip.start_date.substr(0, 4),
				tripUpdate.trip.start_date.substr(4, 2),
				tripUpdate.trip.start_date.substr(6, 2),
			].join('-')
			values.push(
				tripUpdate.trip.trip_id,
				isoStartDate,
			)
			nrOfTrips++
		}
		query += `\
			ORDER BY trip_id ASC, start_date ASC
`

		const t0 = performance.now()
		const {
			rows: _previousStopTimeUpdates,
		} = await db.query(query, values)
		const queryTime = (performance.now() - t0) / 1000
		restoreQueryTimeSeconds.observe({
			schedule_feed_digest: scheduleFeedDigestSlice,
		}, queryTime)
		logger.debug({
			...logCtx,
			queryTime,
			nrOfTrips,
			nrOfStopTimeUpdates: _previousStopTimeUpdates.length,
		}, 'queried TripReplacementPeriods')

		// use a Map to get from `n^2` to `n*log(n)` runtime
		// trip_id:start_date -> [previousStopTimeUpdate]
		// todo: add stop_sequence to key
		const previousStopTimeUpdatesByTrip = new Map(Object.entries(
			groupBy(
				_previousStopTimeUpdates,
				(sTU) => [
					sTU.trip_id,
					sTU.start_date.split('-').join(''),
				].join(':'),
			),
		))

		// todo: add metric for ratio of trips with >=1 restored STU?
		for (const feedEntity of feedMessage.entity) {
			// We only restoring StopTimeUpdates for TripUpdates, see also the storing logic.
			if (!feedEntity.trip_update) continue
			const tripUpdate = feedEntity.trip_update

			const {
				route_id,
				trip_id,
				start_date,
			} = tripUpdate.trip
			const _logCtx = {
				...logCtx,
				route_id,
				trip_id,
				start_date,
			}

			const mapKey = `${trip_id}:${start_date}`
			if (!previousStopTimeUpdatesByTrip.has(mapKey)) {
				logger.trace(_logCtx, 'no previously seen StopTimeUpdates')
				continue
			}
			const previousStopTimeUpdates = previousStopTimeUpdatesByTrip.get(mapKey)

			const timestamp = tripUpdate.timestamp ?? feedMessage.header.timestamp

			if (!tripUpdate.stop_time_update) {
				const {schedule_relationship} = tripUpdate.trip
				if (schedule_relationship && schedule_relationship !== ScheduleRelationship.SCHEDULED) {
					logger.warn({
						...logCtx,
						tripUpdate,
					}, 'TripUpdate without stop_time_update[] even though its schedule_relationship is SCHEDULED, skipping restoring')
					continue
				}

				tripUpdate.stop_time_update = previousStopTimeUpdates
			} else {
				for (const stopTimeUpdate of tripUpdate.stop_time_update) {
					const {
						stop_id,
						// todo: (also?) use stop_sequence to compare
					} = stopTimeUpdate
					const previousStopTimeUpdate = previousStopTimeUpdates
					.find(({stop_id: scheduleStopId}) => scheduleStopId === stop_id)
					if (!previousStopTimeUpdate) {
						// todo: trace-log?
						continue
					}

					_restoreStopTimeUpdate(stopTimeUpdate, timestamp, previousStopTimeUpdate)
					// todo: trace-log?
				}
			}
		}
	}

	const storeAndRestoreStopTimeUpdatesFromDb = async (feedMessage, opt = {}) => {
		// todo: make sure restore() doesn't already mutate `feedMessage` while the store() still accesses it
		await Promise.all([
			restoreStopTimeUpdatesFromDb(feedMessage, opt),
			// storeStopTimeUpdatesInDb(feedMessage, opt),
		])
	}

	const cleanOldStoredStopTimeUpdates = async () => {
		const timestampMin = ((Date.now() / 1000 | 0) - MAX_AGE)
		const logCtx = {
			timestampMin,
			..._logCtx,
		}

		logger.trace(logCtx, 'deleting old stored StopTimeUpdates')
		const t0 = performance.now()
		const {rowCount: nrOfStopTimeUpdates} = await db.query({
			text: `\
				DELETE FROM previous_stoptimeupdates
				WHERE timestamp < $1
`,
			values: [
				timestampMin,
			],
		})
		const queryTime = (performance.now() - t0) / 1000
		cleanQueryTimeSeconds.observe({
			schedule_feed_digest: scheduleFeedDigestSlice,
		}, queryTime)
		noCleaned.set({
			schedule_feed_digest: scheduleFeedDigestSlice,
		}, nrOfStopTimeUpdates)
		logger.debug({
			...logCtx,
			queryTime,
			nrOfStopTimeUpdates,
		}, `deleted ${nrOfStopTimeUpdates} old stored StopTimeUpdates`)
	}
	const startCleaningOldStoredStopTimeUpdates = () => {
		const run = async () => {
			try {
				await cleanOldStoredStopTimeUpdates()
			} catch (err) {
				logger.warn({err}, 'failed to clean old stored StopTimeUpdates')
			} finally {
				timer = setTimeout(run, CLEAN_INTERVAL * 1000)
			}
		}

		// If the process crashes soon after start for some reason, no cleanup will ever run.
		// todo: use a proper task scheduler with a back-off logic, e.g. Kubernetes CronJob [1]
		// [1] https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/
		let timer = setTimeout(run, 100) // todo
		const stop = () => {
			if (timer === null) return;
			clearTimeout(timer)
			timer = null
		}
		return stop
	}

	return {
		storeStopTimeUpdatesInDb,
		restoreStopTimeUpdatesFromDb,
		storeAndRestoreStopTimeUpdatesFromDb,
		startCleaningOldStoredStopTimeUpdates,
	}
}

export {
	createStoreAndRestoreStopTimeUpdatesFromDb,
	_restoreStopTimeUpdate,
}
