import {ok} from 'node:assert'
import {Counter, Summary} from 'prom-client'
import {register as metricsRegister} from './metrics.js'
import {queryScheduleStopTimes} from './query-schedule-stop-times.js'

// const queryScheduleTrip = async (cfg) => {
// 	const {
// 		route_id,
// 		trip_id,
// 		scheduleFeedDigestSlice,
// 		db,
// 		matchingSuccesses,
// 		matchingFailures,
// 		dbQueryTimeSeconds,
// 	} = cfg
// 	ok(route_id, 'missing/empty route_id')
// 	ok(trip_id, 'missing/empty trip_id')

// 	const t0 = performance.now()
// 	const {rows: scheduleTrips} = await db.query({
// 		// allow `pg` to create a prepared statement
// 		name: 'trips_suffix',
// 		text: `\
// 			SELECT
// 				trips.trip_id,
// 				"date" as start_date,
// 				st.departure_time as start_time
// 			FROM trips
// 			LEFT JOIN stop_times st ON trips.trip_id = st.trip_id AND stop_sequence_consec = 0
// 			WHERE route_id = $1
// 			AND trip_id LIKE $2
// 			LIMIT 2
// `,
// 		values: [
// 			route_id,
// 			// Compared to GTFS Realtime trip IDs, the GTFS Schedule ones additionally have a prefix (see above), for example
// 			// - `072150_1..S03R` in GTFS Realtime, and
// 			// - `AFA23GEN-1092-Weekday-00_072150_1..S03R` in GTFS Schedule.
// 			// We check if the GTFS Realtime trip ID uniquely identifies the trip among all trips of the route or, put in another way, that no two trips of the same route share the same trip ID suffix.
// 			// If there's only 1, we have a match. If there are 2, it's ambiguous, so we don't have a match.
// 			`%_${trip_id}`,
// 		],
// 	})
// 	const match = scheduleTrips.length === 1
// 	dbQueryTimeSeconds.observe({
// 		schedule_feed_digest: scheduleFeedDigestSlice,
// 		route_id,
// 		success: match,
// 	}, (performance.now() - t0) / 1000)

// 	if (match) {
// 		matchingSuccesses.inc({
// 			schedule_feed_digest: scheduleFeedDigestSlice,
// 			route_id,
// 		})
// 		return scheduleTrips[0]
// 	}
// 	matchingFailures.inc({
// 		schedule_feed_digest: scheduleFeedDigestSlice,
// 		route_id,
// 	})
// 	return null
// }

const dbQueryTimeSeconds = new Summary({
	name: 'alerts_matching_db_query_time_seconds',
	help: 'when matching Alerts, for how long GTFS Schedule stop_times are queried from the database',
	registers: [metricsRegister],
	labelNames: [
		'schedule_feed_digest',
		'route_id',
		'matching_method',
		'success',
	],
})
const matchingSuccesses = new Counter({
	name: 'alerts_matching_successes_total',
	help: 'nr. of successfully matched Alerts',
	registers: [metricsRegister],
	labelNames: [
		'schedule_feed_digest',
		'route_id',
		'matching_method',
	],
})
const matchingFailures = new Counter({
	name: 'alerts_matching_failures_total',
	help: 'nr. of successfully matched Alerts',
	registers: [metricsRegister],
	labelNames: [
		'schedule_feed_digest',
		'route_id',
		'matching_method',
	],
})

const createMatchAlert = (cfg) => {
	const {
		scheduleFeedDigest, scheduleFeedDigestSlice,
		db,
		logger,
	} = cfg

	// Note: This function mutates `alert`.
	const matchAlert = async (alert) => {
		for (let entitiesIdx = 0; entitiesIdx < alert.informed_entity.length; entitiesIdx++) {
			const entitySelector = alert.informed_entity[entitiesIdx]

			const logCtx = {
				scheduleFeedDigest,
				entitiesIdx,
				entitySelector,
			}

			if (!entitySelector.trip) {
				logger.trace(logCtx, `skipping EntitySelector because it doesn't have a trip`)
				continue
			}
			const tripDescriptor = entitySelector.trip

			// todo: DRY with matchTripUpdate & matchVehiclePosition

			const {
				route_id,
				trip_id: realtimeTripId,
			} = tripDescriptor
			// const nyctTripDescriptor = tripDescriptor['.nyct_trip_descriptor'] || null

			const _logCtx = {
				...logCtx,
				routeId: route_id,
				realtimeTripId,
			}
			logger.trace({
				..._logCtx,
				alert,
			}, 'matching TripDescriptor in Alert')

			// Note: We assume that the Alert informs the current (as in today's) trip "instance".
			// todo: Is this assumption correct? What about midnight?
			const start_date = [
				// todo
			].join('')
			// // todo: what if there are >1 matches? the match should be unambiguous, right?
			// const isMatch = scheduleStopTimes => scheduleStopTimes.length > 0
			// const scheduleStopTimes = await queryScheduleStopTimes({
			// 	logger,
			// 	route_id,
			// 	start_date,
			// 	trip_id: realtimeTripId,
			// 	scheduleFeedDigestSlice,
			// 	db,
			// 	isMatch,
			// 	matchingSuccesses,
			// 	matchingFailures,
			// 	dbQueryTimeSeconds,
			// 	limit: 1000,
			// })

			// if (!isMatch(scheduleStopTimes)) {
			// 	logger.warn(_logCtx, 'failed to find matching schedule trip for TripDescriptor in Alert')
			// 	// todo: if trip is duplicated/added, provide TripProperties.{trip_id,start_date,start_time,shape_id}?
			// 	return null
			// }

			// const tripId = scheduleStopTimes[0].trip_id
			// _logCtx.tripId = tripId
			// logger.debug(_logCtx, 'found matching schedule trip for TripDescriptor in Alert')

			// // We want to expose trip IDs matching the GTFS Schedule data.
			// alert.trip.trip_id = tripId
			// // todo: add start_date?

			// // > When the trip_id corresponds to a non-frequency-based trip, this field should either be omitted or be equal to the value in the GTFS feed. When the trip_id correponds to a frequency-based trip defined in GTFS frequencies.txt, start_time is required and must be specified for trip updates and vehicle positions.
			// // https://gtfs.org/realtime/reference/#message-tripdescriptor
			// // todo: add start_time

			// // todo: add trip.direction_id?

			// // fill VehicleDescriptor.id using nyctTripDescriptor.train_id
			// if (!alert.vehicle?.id && nyctTripDescriptor?.train_id) {
			// 	if (!alert.vehicle) {
			// 		alert.vehicle = {}
			// 	}
			// 	alert.vehicle.id = nyctTripDescriptor?.train_id
			// }
		}

		// todo: if header_txt.translation[].text === 'Train delayed', set effect to SIGNIFICANT_DELAYS?
	}

	return {
		matchAlert,
	}
}

export {
	createMatchAlert,
}
