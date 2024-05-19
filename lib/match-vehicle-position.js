import {Counter, Summary} from 'prom-client'
import gtfsRtBindings from './mta-gtfs-realtime.pb.js'
import {register as metricsRegister} from './metrics.js'
import {queryScheduleStopTimes} from './query-schedule-stop-times.js'

const {ScheduleRelationship} = gtfsRtBindings.transit_realtime.TripDescriptor

// see also https://www.robustperception.io/cardinality-is-key/
const dbQueryTimeSeconds = new Summary({
	name: 'vehiclepositions_matching_db_query_time_seconds',
	help: 'when matching VehiclePositions, for how long GTFS Schedule stop_times are queried from the database',
	registers: [metricsRegister],
	labelNames: [
		'schedule_feed_digest',
		'route_id',
		'by_suffix',
		'success',
	],
})
const matchingSuccesses = new Counter({
	name: 'vehiclepositions_matching_successes_total',
	help: 'nr. of successfully matched VehiclePositions',
	registers: [metricsRegister],
	labelNames: [
		'schedule_feed_digest',
		'route_id',
		'by_suffix',
	],
})
const matchingFailures = new Counter({
	name: 'vehiclepositions_matching_failures_total',
	help: 'nr. of successfully matched VehiclePositions',
	registers: [metricsRegister],
	labelNames: [
		'schedule_feed_digest',
		'route_id',
		'by_suffix',
	],
})

const createMatchVehiclePosition = (cfg) => {
	const {
		scheduleFeedDigest, scheduleFeedDigestSlice,
		db,
		logger,
	} = cfg

	// Note: This function mutates `vehiclePosition`.
	const matchVehiclePosition = async (vehiclePosition) => {
		const {
			route_id,
			start_date: startDate,
			trip_id: realtimeTripId,
		} = vehiclePosition.trip
		const {
			stop_id,
			current_stop_sequence,
		} = vehiclePosition
		const nyctTripDescriptor = vehiclePosition.trip['.nyct_trip_descriptor'] || null

		const logCtx = {
			scheduleFeedDigest,
			routeId: route_id,
			stopId: stop_id,
			startDate,
			realtimeTripId,
		}
		logger.trace({
			...logCtx,
			vehiclePosition,
		}, 'matching VehiclePosition')

		const scheduleStopTimes = await queryScheduleStopTimes({
			route_id,
			start_date: startDate,
			trip_id: realtimeTripId,
			// Note: This assumes that no trip visits a stop more than once.
			// todo: find a way to handle this, e.g. using stop_sequence
			stop_id,
			scheduleFeedDigestSlice,
			db,
			matchingSuccesses,
			matchingFailures,
			dbQueryTimeSeconds,
			limit: 2,
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

		if (scheduleStopTime.stop_sequence !== current_stop_sequence) {
			logger.warn({
				...logCtx,
				realtimeCurrentStopSequence: current_stop_sequence,
				stopSequence: scheduleStopTime.stop_sequence,
			}, 'stop_sequences not matching')
			// we probably have the wrong stop_times row
			return null
		}

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
	}

	return {
		matchVehiclePosition,
	}
}

export {
	createMatchVehiclePosition,
}
