import {Counter, Summary} from 'prom-client'
import {toBigInt as protobufJsLongToBigInt} from 'longfn'
import gtfsRtBindings from './mta-gtfs-realtime.pb.js'
import {register as metricsRegister} from './metrics.js'
import {queryScheduleStopTimes} from './query-schedule-stop-times.js'

const {ScheduleRelationship} = gtfsRtBindings.transit_realtime.TripDescriptor

const MATCHED = Symbol('TripUpdate matched')

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
	help: 'number of successfully matched TripUpdates',
	registers: [metricsRegister],
	labelNames: [
		'schedule_feed_digest',
		'route_id',
		'matching_method',
	],
})
const matchingFailures = new Counter({
	name: 'tripupdates_matching_failures_total',
	help: 'number of unsuccessfully matched TripUpdates',
	registers: [metricsRegister],
	labelNames: [
		'schedule_feed_digest',
		'route_id',
		'matching_method',
	],
})
const stopTimeUpdateMatchingSuccesses = new Counter({
	name: 'tripupdates_stoptimeupdate_matching_successes_total',
	help: 'number of successfully matched TripUpdates',
	registers: [metricsRegister],
	labelNames: [
		'schedule_feed_digest',
		'route_id',
	],
})
const stopTimeUpdateMatchingFailures = new Counter({
	name: 'tripupdates_stoptimeupdate_matching_failures_total',
	help: 'number of successfully matched TripUpdates',
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
			realtimeFeedName,
		} = {
			now: Date.now(),
			realtimeFeedName: null,
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
			realtimeFeedName,
			routeId: route_id,
			startDate,
			realtimeTripId,
		}
		logger.trace({
			...logCtx,
			tripUpdate,
		}, 'matching TripUpdate')

		// find StopTimeUpdate with stop_id & stop_sequence, fall back to one with only stop_id
		if (!tripUpdate.stop_time_update || tripUpdate.stop_time_update.length === 0) {
			logger.warn(logCtx, 'cannot match TripUpdate, it has 0 StopTimeUpdates')
			return null
		}
		let someStopTimeUpdate = tripUpdate.stop_time_update
		.find(sTU => typeof sTU.stop_id === 'string' && Number.isInteger(sTU.stop_sequence))
		if (!someStopTimeUpdate) {
			logger.warn(logCtx, 'cannot match TripUpdate unambiguously, it has no StopTimeUpdate with stop_id & stop_sequence; now matching ambiguously')
		}
		someStopTimeUpdate = tripUpdate.stop_time_update
		.find(sTU => typeof sTU.stop_id === 'string')
		if (!someStopTimeUpdate) {
			logger.warn(logCtx, 'cannot match TripUpdate at all, it has no StopTimeUpdate with stop_id')
			return null
		}

		const isMatch = scheduleStopTimes => scheduleStopTimes.length > 0
		const scheduleStopTimes = await queryScheduleStopTimes({
			logger,
			route_id,
			start_date: startDate,
			trip_id: realtimeTripId,
			stop_id: someStopTimeUpdate.stop_id,
			stop_sequence: someStopTimeUpdate.stop_sequence ?? null,
			scheduleFeedDigestSlice,
			db,
			isMatch,
			matchingSuccesses,
			matchingFailures,
			dbQueryTimeSeconds,
			matchLimit: 1,
			queryTripStopTimes: true,
			tripStopTimesLimit: 1000,
		})

		if (!isMatch(scheduleStopTimes)) {
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

		let prevScheduleStopTimesIdx = -1
		for (let i = 0; i < tripUpdate.stop_time_update.length; i++) {
			const stopTimeUpdate = tripUpdate.stop_time_update[i]
			const {
				stop_id: stopId,
				stop_sequence: stopSequence = null,
				arrival = null,
				departure = null,
			} = stopTimeUpdate
			const _logCtx = {
				...logCtx,
				stopTimeUpdatesIdx: i,
				stopTimeUpdate,
			}

			// > # StopTimeUpdate
			// > […] If the same stop_id is visited more than once in a trip, then stop_sequence should be provided in all StopTimeUpdates for that stop_id on that trip.
			// > https://gtfs.org/realtime/reference/#message-stoptimeupdate
			const scheduleStopTimesIdx = scheduleStopTimes.findIndex((sT, idx) => {
				if (idx <= prevScheduleStopTimesIdx) {
					// We cannot match two Realtime StopTimeUpdates with one Schedule stop_time.
					return false
				}

				// from https://gtfs.org/realtime/reference/#message-stoptimeupdate:
				// > stop_sequence – Must be the same as in stop_times.txt in the corresponding GTFS [Schedule] feed.
				// from https://gtfs.org/schedule/reference/#stop_timestxt:
				// > The values must increase along the trip but do not need to be consecutive.
				// todo: Does this mean that, in order to support additional (realtime) StopTimeUpdates in between, I *have to* use non-consecutive values in the Schedule feed?
				if (
					sT.stop_sequence !== null
					&& stopSequence !== null
					&& sT.stop_sequence !== stopSequence
				) {
					return false
				}

				return stopId === sT.stop_id
			})
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

			prevScheduleStopTimesIdx = scheduleStopTimesIdx
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

		return MATCHED
	}

	const matchTripUpdateOrTransformToAdded = async (tripUpdate, opt = {}) => {
		const {
			realtimeFeedName,
		} = {
			realtimeFeedName: null,
			...opt,
		}

		const {
			route_id,
			start_date: startDate,
			trip_id: tripId,
		} = tripUpdate.trip
		const logCtx = {
			scheduleFeedDigest,
			realtimeFeedName,
			routeId: route_id,
			startDate,
			tripId,
		}

		const isMatched = await matchTripUpdate(tripUpdate, opt)

		// In other parts of the code base, we mark all schedule trip "instances" that we couldn't match a realtime TripUpdate with as `schedule_relationship: CANCELED`.
		// Correspondingly, we mark all realtime TripUpdates that we couldn't match with a schedule trip "instance" as `schedule_relationship: ADDED`, in order to "make up for the missing trips".
		if (isMatched !== MATCHED) {
			logger.trace({
				...logCtx,
				tripUpdate,
			}, 'marking unmatched TripUpdate as schedule_relationship: ADDED')
			tripUpdate.trip.schedule_relationship = ScheduleRelationship.ADDED
		}
	}

	return {
		matchTripUpdate,
		matchTripUpdateOrTransformToAdded,
	}
}

export {
	createMatchTripUpdate,
}
