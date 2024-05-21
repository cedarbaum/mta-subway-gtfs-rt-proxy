import {Counter, Summary} from 'prom-client'
import {toBigInt as protobufJsLongToBigInt} from 'longfn'
import gtfsRtBindings from './mta-gtfs-realtime.pb.js'
import {register as metricsRegister} from './metrics.js'
import {queryScheduleStopTimes} from './query-schedule-stop-times.js'

const {ScheduleRelationship} = gtfsRtBindings.transit_realtime.TripDescriptor

const estimateDelayFromUpcomingArrivalOrDeparture = (tripUpdate, now = Date.now()) => {
	// find first arrival/departure that is in the future
	now = now / 1000 | 0
	for (let i = 0; i < tripUpdate.stop_time_update.length; i++) {
		const stopTimeUpdate = tripUpdate.stop_time_update[i]
		const {
			arrival: arr,
			departure: dep,
		} = stopTimeUpdate

		if (arr?.time > now && ('delay' in arr)) {
			return {
				stopTimeUpdatesIdx: i,
				kind: 'arrival',
				delay: arr.delay,
			}
		}
		if (dep?.time > now && ('delay' in dep)) {
			return {
				stopTimeUpdatesIdx: i,
				kind: 'departure',
				delay: dep.delay,
			}
		}
	}
	return null
}

const dbQueryTimeSeconds = new Summary({
	name: 'tripupdates_matching_db_query_time_seconds',
	help: 'when matching TripUpdates, for how long GTFS Schedule stop_times are queried from the database',
	registers: [metricsRegister],
	labelNames: [
		'schedule_feed_digest',
		'route_id',
		'matching_method',
		'success',
	],
})
const matchingSuccesses = new Counter({
	name: 'tripupdates_matching_successes_total',
	help: 'nr. of successfully matched TripUpdates',
	registers: [metricsRegister],
	labelNames: [
		'schedule_feed_digest',
		'route_id',
		'matching_method',
	],
})
const matchingFailures = new Counter({
	name: 'tripupdates_matching_failures_total',
	help: 'nr. of successfully matched TripUpdates',
	registers: [metricsRegister],
	labelNames: [
		'schedule_feed_digest',
		'route_id',
		'matching_method',
	],
})
const stopTimeUpdateMatchingSuccesses = new Counter({
	name: 'tripupdates_stoptimeupdate_matching_successes_total',
	help: 'nr. of successfully matched TripUpdates',
	registers: [metricsRegister],
	labelNames: [
		'schedule_feed_digest',
		'route_id',
	],
})
const stopTimeUpdateMatchingFailures = new Counter({
	name: 'tripupdates_stoptimeupdate_matching_failures_total',
	help: 'nr. of successfully matched TripUpdates',
	registers: [metricsRegister],
	labelNames: [
		'schedule_feed_digest',
		'route_id',
	],
})

const createMatchTripUpdate = (cfg) => {
	const {
		scheduleFeedDigest, scheduleFeedDigestSlice,
		db,
		logger,
	} = cfg

	// Note: This function mutates `tripUpdate`.
	const matchTripUpdate = async (tripUpdate, opt = {}) => {
		const {
			now,
		} = {
			now: Date.now(),
			...opt,
		}

		const {
			route_id,
			start_date: startDate,
			trip_id: realtimeTripId,
		} = tripUpdate.trip
		const nyctTripDescriptor = tripUpdate.trip['.nyct_trip_descriptor'] || null

		const logCtx = {
			scheduleFeedDigest,
			routeId: route_id,
			startDate,
			realtimeTripId,
		}
		logger.trace({
			...logCtx,
			tripUpdate,
		}, 'matching TripUpdate')

		// todo: use some StopTimeUpdate's stop_id/stop_sequence to unambiguously identify the trip "instance", then query all its stop_times
		const scheduleStopTimes = await queryScheduleStopTimes({
			route_id,
			start_date: startDate,
			trip_id: realtimeTripId,
			scheduleFeedDigestSlice,
			db,
			matchingSuccesses,
			matchingFailures,
			dbQueryTimeSeconds,
			limit: 1000,
		})

		if (scheduleStopTimes.length === 0) {
			logger.warn(logCtx, 'failed to find matching schedule trip for TripUpdate')
			// todo: if trip is duplicated/added, provide TripProperties.{trip_id,start_date,start_time,shape_id}?
			return null
		}

		const tripId = scheduleStopTimes[0].trip_id
		logCtx.tripId = tripId
		logger.debug(logCtx, 'found matching schedule trip for TripUpdate')

		// We want to expose trip IDs matching the GTFS Schedule data.
		tripUpdate.trip.trip_id = tripId

		tripUpdate.trip.schedule_relationship = ScheduleRelationship.SCHEDULED

		for (let i = 0; i < tripUpdate.stop_time_update.length; i++) {
			const stopTimeUpdate = tripUpdate.stop_time_update[i]
			const {
				stop_id: stopId,
				arrival = null,
				departure = null,
			} = stopTimeUpdate
			const _logCtx = {
				...logCtx,
				stopTimeUpdatesIdx: i,
				stopTimeUpdate,
			}

			// Note: This assumes that no trip visits a stop more than once.
			// Currently, with the MTA/NYCT subway GTFS feed, that is the case.
			// SELECT *
			// FROM (
			// 	SELECT
			// 		row_number() OVER (PARTITION BY trip_id, stop_id) as visit_count
			// 	FROM stop_times
			// 	ORDER BY trip_id, stop_sequence_consec ASC
			// ) t
			// WHERE visit_count > 1
			// todo: But does this apply to all? What about the future? Find a way to handle this!
			// Check the stop visit count (e.g. 3rd visiting `101N`)? Or the previous stop ID?
			const scheduleStopTimesIdx = scheduleStopTimes.findIndex(sT => stopId === sT.stop_id)
			if (scheduleStopTimesIdx === -1) {
				stopTimeUpdateMatchingFailures.inc({
					schedule_feed_digest: scheduleFeedDigestSlice,
					route_id,
				})
				// todo: set StopTimeUpdate.schedule_relationship to SKIPPED?
				logger.warn(_logCtx, 'failed to find matching schedule stop_time for StopTimeUpdate')
				continue
			}
			const scheduleStopTime = scheduleStopTimes[scheduleStopTimesIdx]
			stopTimeUpdateMatchingSuccesses.inc({
				schedule_feed_digest: scheduleFeedDigestSlice,
				route_id,
			})
			logger.trace({
				..._logCtx,
				scheduleStopTimesIdx,
				scheduleStopTime,
			}, 'found matching schedule stop_time for StopTimeUpdate')

			stopTimeUpdate.stop_sequence = scheduleStopTime.stop_sequence
			stopTimeUpdate.schedule_relationship = ScheduleRelationship.SCHEDULED

			// > Delay (in seconds) can be positive (meaning that the vehicle is late) or negative (meaning that the vehicle is ahead of schedule).
			// https://gtfs.org/realtime/reference/#message-stoptimeevent
			const getDelay = (timeAsProtobufJsLong, scheduleTimeAsIso8601) => {
				const time = typeof timeAsProtobufJsLong === 'bigint'
					? timeAsProtobufJsLong
					: protobufJsLongToBigInt(timeAsProtobufJsLong)
				// Because `time` is a BigInt (StopTimeEvent defines it as a Protocol Buffers int64, which we parse as a BigInt), we do the entire calculation with BigInts.
				const scheduleTime = BigInt(Math.round(Date.parse(scheduleTimeAsIso8601) / 1000))
				const delay = time - scheduleTime
				// We expect the delay to be small enough to fit into a regular ECMAScript number.
				return parseInt(delay.toString(), 10)
			}
			// todo: as a fallback, use `scheduleStopTime.{arrival,departure}_{time,delay}`
			const scheduleArrival = scheduleStopTime.t_arrival
			if (arrival && ('time' in arrival) && scheduleArrival) {
				arrival.delay = getDelay(arrival.time, scheduleArrival)
			}
			const scheduleDeparture = scheduleStopTime.t_departure
			if (departure && ('time' in departure) && scheduleDeparture) {
				departure.delay = getDelay(departure.time, scheduleDeparture)
			}

			// todo: re-map stopTimeUpdate.nyct_stop_time_update.actual_track to StopTimeProperties.assigned_stop_id?
			// > Supports real-time stop assignments. Refers to a stop_id defined in the GTFS stops.txt.
			// > The new assigned_stop_id should not result in a significantly different trip experience for the end user than the stop_id defined in GTFS stop_times.txt. In other words, the end user should not view this new stop_id as an "unusual change" if the new stop was presented within an app without any additional context. For example, this field is intended to be used for platform assignments by using a stop_id that belongs to the same station as the stop originally defined in GTFS stop_times.txt.
			// > […]
			// > If this field is populated, StopTimeUpdate.stop_sequence must be populated and StopTimeUpdate.stop_id should not be populated. Stop assignments should be reflected in other GTFS-realtime fields as well (e.g., VehiclePosition.stop_id).
			// https://gtfs.org/realtime/reference/#message-stoptimeproperties
		}

		// NYCT subway feed frequently "forgets" past StopTimeUpdates

		// > When the trip_id corresponds to a non-frequency-based trip, this field should either be omitted or be equal to the value in the GTFS feed. When the trip_id correponds to a frequency-based trip defined in GTFS frequencies.txt, start_time is required and must be specified for trip updates and vehicle positions.
		// https://gtfs.org/realtime/reference/#message-tripdescriptor
		// todo: add start_time

		// todo: add trip.direction_id?

		// fill VehicleDescriptor.id using nyctTripDescriptor.train_id
		if (!tripUpdate.vehicle?.id && nyctTripDescriptor?.train_id) {
			if (!tripUpdate.vehicle) {
				tripUpdate.vehicle = {}
			}
			tripUpdate.vehicle.id = nyctTripDescriptor?.train_id
		}

		// fill TripUpdate.delay using an upcoming arrival/departure
		if (!('delay' in tripUpdate)) {
			const estimation = estimateDelayFromUpcomingArrivalOrDeparture(tripUpdate, now)
			if (estimation === null) {
				logger.info(logCtx, 'failed to find upcoming arrival/departure to use for TripUpdate.delay')
			} else {
				const {
					stopTimeUpdatesIdx,
					delay,
					kind,
				} = estimation
				logger.trace({
					...logCtx,
					stopTimeUpdatesIdx,
					stopTimeUpdate: tripUpdate.stop_time_update[stopTimeUpdatesIdx],
					delay,
				}, `using upcoming ${kind} for TripUpdate.delay`)
				tripUpdate.delay = delay
			}
		}
	}

	return {
		matchTripUpdate,
	}
}

export {
	createMatchTripUpdate,
}
