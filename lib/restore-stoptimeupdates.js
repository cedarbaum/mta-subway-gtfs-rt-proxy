import {toBigInt as _protobufJsLongToBigInt} from 'longfn'

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

	const storeStopTimeUpdatesInDb = async (feedMessage) => {
		const logCtx = {
			..._logCtx,
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

		// todo: add metrics (e.g. query time)
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
	}

	const restoreStopTimeUpdatesFromDb = async (feedMessage) => {
		const logCtx = {
			scheduleFeedDigest,
		}

		// todo
	}

	const storeAndRestoreStopTimeUpdatesFromDb = async (feedMessage) => {
		// todo: make sure restore() doesn't already mutate `feedMessage` while the store() still accesses it
		await Promise.all([
			restoreStopTimeUpdatesFromDb(feedMessage),
			storeStopTimeUpdatesInDb(feedMessage),
		])
	}

	const cleanOldStoredStopTimeUpdates = async () => {
		const timestampMin = ((Date.now() / 1000 | 0) - MAX_AGE)
		const logCtx = {
			timestampMin,
			..._logCtx,
		}

		logger.trace(logCtx, 'deleting old stored StopTimeUpdates')
		const {rowCount} = await db.query({
			text: `\
				DELETE FROM previous_stoptimeupdates
				WHERE timestamp < $1
`,
			values: [
				timestampMin,
			],
		})
		logger.debug(logCtx, `deleted ${rowCount} old stored StopTimeUpdates`)
		// todo: expose metrics
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
}
