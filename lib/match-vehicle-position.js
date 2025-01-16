import {Counter, Summary} from 'prom-client'
import gtfsRtBindings from './mta-gtfs-realtime.pb.js'
import {register as metricsRegister} from './metrics.js'
import {queryScheduleStopTimes} from './query-schedule-stop-times.js'

const {ScheduleRelationship} = gtfsRtBindings.transit_realtime.TripDescriptor

const MATCHED = Symbol('TripUpdate matched')

// see also https://www.robustperception.io/cardinality-is-key/
const dbQueryTimeSeconds = new Summary({
	name: 'vehiclepositions_matching_db_query_time_seconds',
	help: 'when matching VehiclePositions, for how long GTFS Schedule stop_times are queried from the database',
	registers: [metricsRegister],
	labelNames: [
		'schedule_feed_digest',
		'route_id',
		'matching_method',
		'success',
	],
})
const matchingSuccesses = new Counter({
	name: 'vehiclepositions_matching_successes_total',
	help: 'number of successfully matched VehiclePositions',
	registers: [metricsRegister],
	labelNames: [
		'schedule_feed_digest',
		'route_id',
		'matching_method',
	],
})
const matchingFailures = new Counter({
	name: 'vehiclepositions_matching_failures_total',
	help: 'number of successfully matched VehiclePositions',
	registers: [metricsRegister],
	labelNames: [
		'schedule_feed_digest',
		'route_id',
		'matching_method',
	],
})

const createMatchVehiclePosition = (cfg) => {
	const {
		scheduleFeedDigest, scheduleFeedDigestSlice,
		db,
		logger,
	} = cfg

	// Note: This function mutates `vehiclePosition`.
	const matchVehiclePosition = async (vehiclePosition, opt = {}) => {
		const {
			realtimeFeedName,
		} = {
			realtimeFeedName: null,
			...opt,
		}

		const {
			route_id,
			start_date: startDate,
			trip_id: realtimeTripId,
		} = vehiclePosition.trip
		const {
			stop_id,
			current_stop_sequence = null,
		} = vehiclePosition
		const nyctTripDescriptor = vehiclePosition.trip['.nyct_trip_descriptor'] || null

		const logCtx = {
			scheduleFeedDigest,
			realtimeFeedName,
			routeId: route_id,
			stopId: stop_id,
			startDate,
			realtimeTripId,
		}
		logger.trace({
			...logCtx,
			vehiclePosition,
		}, 'matching VehiclePosition')

		const isMatch = scheduleStopTimes => scheduleStopTimes.length === 1
		const scheduleStopTimes = await queryScheduleStopTimes({
			logger,
			route_id,
			start_date: startDate,
			trip_id: realtimeTripId,
			// Note: If a trip visits a stop more than once, e.g. in a loop, the Realtime spec only demands stop_sequence to be present (to eliminate ambiguity) for StopTimeUpdates, but not for VehiclePositions.
			// IMHO this is a shortcoming of the spec that cannot really be worked around here.
			// todo: propose a spec change
			stop_id,
			stop_sequence: current_stop_sequence,
			scheduleFeedDigestSlice,
			db,
			isMatch,
			matchingSuccesses,
			matchingFailures,
			dbQueryTimeSeconds,
			matchLimit: 2,
			queryTripStopTimes: false,
			tripStopTimesLimit: 1, // whatever
		})

		if (scheduleStopTimes.length === 0) {
			logger.warn(logCtx, 'failed to find matching schedule trip for VehiclePosition')
			// todo: if trip is duplicated/added, provide TripProperties.{trip_id,start_date,start_time,shape_id}?
			return null
		}
		if (scheduleStopTimes.length > 1) {
			// todo: add a metric for this
			logger.warn({
				...logCtx,
				scheduleStopTimes,
			}, 'failed to find unambiguously matching schedule trip for VehiclePosition')
			return null
		}

		const scheduleStopTime = scheduleStopTimes[0]
		logCtx.tripId = scheduleStopTime.trip_id
		logger.debug(logCtx, 'found matching schedule trip for VehiclePosition')

		// We want to expose trip IDs matching the GTFS Schedule data.
		vehiclePosition.trip.trip_id = scheduleStopTime.trip_id

		vehiclePosition.trip.schedule_relationship = ScheduleRelationship.SCHEDULED

		// > When the trip_id corresponds to a non-frequency-based trip, this field should either be omitted or be equal to the value in the GTFS feed. When the trip_id correponds to a frequency-based trip defined in GTFS frequencies.txt, start_time is required and must be specified for trip updates and vehicle positions.
		// https://gtfs.org/realtime/reference/#message-tripdescriptor
		// todo: add start_time

		// todo: add trip.direction_id?

		// fill VehicleDescriptor.id using nyctTripDescriptor.train_id
		if (!vehiclePosition.vehicle?.id && nyctTripDescriptor?.train_id) {
			if (!vehiclePosition.vehicle) {
				vehiclePosition.vehicle = {}
			}
			vehiclePosition.vehicle.id = nyctTripDescriptor?.train_id
		}

		return MATCHED
	}

	const matchVehiclePositionOrTransformToAdded = async (vehiclePosition, opt = {}) => {
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
		} = vehiclePosition.trip
		const {
			stop_id = null,
		} = vehiclePosition
		const logCtx = {
			scheduleFeedDigest,
			realtimeFeedName,
			routeId: route_id,
			stopId: stop_id,
			startDate,
			tripId,
		}

		const isMatched = await matchVehiclePosition(vehiclePosition, opt)

		if (isMatched !== MATCHED) {
			logger.trace({
				...logCtx,
				vehiclePosition,
			}, 'marking unmatched VehiclePosition as schedule_relationship: ADDED')
			vehiclePosition.trip.schedule_relationship = ScheduleRelationship.ADDED
		}
	}

	return {
		matchVehiclePosition,
		matchVehiclePositionOrTransformToAdded,
	}
}

export {
	createMatchVehiclePosition,
}
