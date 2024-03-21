import {ok} from 'node:assert'
import {Counter, Summary} from 'prom-client'
import gtfsRtBindings from './mta-gtfs-realtime.pb.js'

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

const createMatchTripUpdate = (cfg) => {
	const {
		db,
		logger,
		metricsRegister,
	} = cfg

	const dbQueryTimeSeconds = new Summary({
		name: 'tripupdates_matching_db_query_time_seconds',
		help: 'when matching TripUpdates, for how long GTFS Schedule stop_times are queried from the database',
		registers: [metricsRegister],
		labelNames: ['route_id', 'by_suffix', 'success'],
	})
	const matchingSuccesses = new Counter({
		name: 'tripupdates_matching_successes_total',
		help: 'nr. of successfully matched TripUpdates',
		registers: [metricsRegister],
		labelNames: ['route_id', 'by_suffix'],
	})
	const matchingFailures = new Counter({
		name: 'tripupdates_matching_failures_total',
		help: 'nr. of successfully matched TripUpdates',
		registers: [metricsRegister],
		labelNames: ['route_id', 'by_suffix'],
	})
	const stopTimeUpdateMatchingSuccesses = new Counter({
		name: 'tripupdates_stoptimeupdate_matching_successes_total',
		help: 'nr. of successfully matched TripUpdates',
		registers: [metricsRegister],
		labelNames: ['route_id'],
	})
	const stopTimeUpdateMatchingFailures = new Counter({
		name: 'tripupdates_stoptimeupdate_matching_failures_total',
		help: 'nr. of successfully matched TripUpdates',
		registers: [metricsRegister],
		labelNames: ['route_id'],
	})

	const subdivisionsByRouteId = new Map([
		['1', 'A'],
		// todo
	])
	const _queryScheduleStopTimes = async (cfg) => {
		const {
			route_id,
			start_date,
			trip_id,
		} = cfg
		ok(route_id, 'missing/empty route_id')
		ok(start_date, 'missing/empty start_date')
		ok(trip_id, 'missing/empty trip_id')

		// convert to ISO 8601 (PostgreSQL-compatible)
		const isoStartDate = [
			start_date.substr(0, 4),
			start_date.substr(4, 2),
			start_date.substr(6, 2),
		].join('-')

		// Try to match the GTFS Schedule trip ID by constructing it from the passed-in values.
		if (subdivisionsByRouteId.has(route_id)) {
			const startDayOfTheWeek = new Date(isoStartDate + 'T00:00Z').getDay()
			// eslint-disable-next-line no-unused-vars
			const _trip_id = [
				// e.g. `AFA23GEN-2042-Saturday-00_025350_2..N08R` – what is `FA23GEN`? what is the number behind?
				// e.g. `L0S1-7-1064-S02_008000_7..S97R`

				// https://api.mta.info/GTFS.pdf
				// > `A20111204SAT_021150_2..N08R` is decoded as follows:
				// > 1. `A` – Is the Sub-Division identifier.
				// > 	- `A` identifies Sub-Division A (IRT) which include the GC Shuttle and all number lines with the exception of the 7 line.
				// > 	- `B` identifies Sub-Division B (BMT and IND) which includes the Franklin Ave and Rockaway Shuttles, all letter lines and the 7 line.
				subdivisionsByRouteId.get(route_id),
				// > 2. `20111204` – Effective date of the base schedule, Dec 4, 2011
				start_date,
				// > 3. `SAT` – Is the applicable service code. Typically it will be `WKD`-Weekday, `SAT`-Saturday or `SUN`- Sunday
				([
					'SUN',
					'WKD', 'WKD', 'WKD', 'WKD', 'WKD', // Monday to Friday
					'SAT',
				])[startDayOfTheWeek],
				'_',
				// > 4. `021150` – This identifies the trips origin time. Times are coded reflecting hundredths of a minute past midnight and converts to (03:31:30 also described as 0331+ where the + equals 30 seconds). This format provides more "precision" than can be realistically attributed to a transit operation, and most applications can safely round or truncate these numbers to the nearest minute. Since Transit authority internal timetables frequently involve half-minute scheduling, systems involved in train control or monitoring will need to represent times in a more accurate manner (to at least the half minute, and perhaps to the tenth minute or one second level). It should be noted that the service associated with a single day's subway schedule is not necessarily confined to a twenty-four hour period. Negative numbers reflect times prior to the day of the schedule (-0000200 refers to 11:58 PM yesterday) and numbers exceeding 00144000 (a day has 1440 minutes) reflect times beyond the day of the schedule (00145000 refers to 12:10 AM tomorrow).
				// > 5. `2..N08R` – This identifies the Trip Path (stopping pattern) for a unique train trip. This can be decomposed into the Route ID (aka service, 2 train) Direction (Northbound train) and Path Identifier (08R). Internally this path provides operations planning such information as origination, destination, all stops, routing scheme (express/local) in Manhattan/Bronx/Brooklyn, operating time periods, and shape (circle = local, diamond = express).
				trip_id,
			].join('')

			// todo: this format isn't used in the GTFS Schedule data (anymore?)
// 			const t0 = performance.now()
// 			const {rows: scheduleStopTimes} = await db.query({
// 				// allow `pg` to create a prepared statement
// 				name: 'stop_times_exact',
// 				text: `\
// 					SELECT
// 						trip_id,
// 						stop_id,
// 						stop_sequence, -- useful for debugging
// 						t_arrival, t_departure
// 					FROM arrivals_departures
// 					WHERE route_id = $1
// 					AND "date" = $2
// 					AND trip_id = $3
// 					-- todo: for now, we don't support frequencies.txt-based trips yet
// 					AND frequencies_it = -1
// 					ORDER BY stop_sequence_consec ASC
// `,
// 				values: [
// 					route_id,
// 					isoStartDate,
// 					_trip_id,
// 				],
// 			})
// 			dbQueryTimeSeconds.observe({
// 				route_id,
// 				success: scheduleStopTimes.length >= 0,
// 				by_suffix: false,
// 			}, (performance.now() - t0) / 1000)

// 			if (scheduleStopTimes.length >= 0) {
// 				matchingSuccesses.inc({route_id, by_suffix: false})
// 				return scheduleStopTimes
// 			}
// 			matchingFailures.inc({route_id, by_suffix: false})
		}

		// As a fallback, try to match the trip by suffix-matching the GTFS Schedule trip ID using the GTFS Realtime ID.
		{
			const t0 = performance.now()
			const {rows: scheduleStopTimes} = await db.query({
				// allow `pg` to create a prepared statement
				name: 'stop_times_suffix',
				text: `\
					SELECT
						trip_id,
						stop_id,
						stop_sequence, -- useful for debugging
						t_arrival, t_departure
					FROM arrivals_departures
					WHERE route_id = $1
					AND "date" = $2
					AND trip_id LIKE $3
					-- todo: for now, we don't support frequencies.txt-based trips yet
					AND frequencies_it = -1
					ORDER BY stop_sequence_consec ASC
`,
				values: [
					route_id,
					isoStartDate,
					// Compared to GTFS Realtime trip IDs, the GTFS Schedule ones additionally have a prefix (see above), for example
					// - `072150_1..S03R` in GTFS Realtime, and
					// - `AFA23GEN-1092-Weekday-00_072150_1..S03R` in GTFS Schedule.
					// Note: We assume that the GTFS Realtime trip ID uniquely identifies the trip within the route & date or, put in another way, that no two trips of the same route & date share the same trip ID suffix.
					// > For example, if a trip_id in trips.txt is A20111204SAT_021150_2..N08R, the GTFS-realtime trip_id will be 021150_2..N08R which is unique within the day type (WKD, SAT, SUN).
					`%_${trip_id}`,
				],
			})
			dbQueryTimeSeconds.observe({
				route_id,
				success: scheduleStopTimes.length >= 0,
				by_suffix: true,
			}, (performance.now() - t0) / 1000)

			if (scheduleStopTimes.length >= 0) {
				matchingSuccesses.inc({route_id, by_suffix: true})
				return scheduleStopTimes
			}
			matchingFailures.inc({route_id, by_suffix: true})
		}

		return []
	}

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
			routeId: route_id,
			startDate,
			realtimeTripId,
		}
		logger.trace({
			...logCtx,
			tripUpdate,
		}, 'matching TripUpdate')

		const scheduleStopTimes = await _queryScheduleStopTimes({
			route_id,
			start_date: startDate,
			trip_id: realtimeTripId,
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
				stopTimeUpdateMatchingFailures.inc({route_id})
				// todo: set StopTimeUpdate.schedule_relationship to SKIPPED?
				logger.warn(_logCtx, 'failed to find matching schedule stop_time for StopTimeUpdate')
				continue
			}
			const scheduleStopTime = scheduleStopTimes[scheduleStopTimesIdx]
			stopTimeUpdateMatchingSuccesses.inc({route_id})
			logger.trace({
				..._logCtx,
				scheduleStopTimesIdx,
				scheduleStopTime,
			}, 'found matching schedule stop_time for StopTimeUpdate')

			stopTimeUpdate.schedule_relationship = ScheduleRelationship.SCHEDULED

			// > Delay (in seconds) can be positive (meaning that the vehicle is late) or negative (meaning that the vehicle is ahead of schedule).
			// https://gtfs.org/realtime/reference/#message-stoptimeevent
			const getDelay = (time, scheduleTimeAsIso8601) => {
				// Because `time` is a BigInt (StopTimeEvent defines it as a Protocol Buffers int64, which we parse as a BigInt), we do the entire calculation with BigInts.
				const scheduleTime = BigInt(Math.round(Date.parse(scheduleTimeAsIso8601) / 1000))
				const delay = time - scheduleTime
				// We expect the delay to be small enough to fit into a regular ECMAScript number.
				return parseInt(delay.toString(), 10)
			}
			const scheduleArrival = scheduleStopTime.t_arrival
			if (arrival && ('time' in arrival) && scheduleArrival) {
				arrival.delay = getDelay(arrival.time, scheduleArrival)
			}
			const scheduleDeparture = scheduleStopTime.t_departure
			if (departure && ('time' in departure) && scheduleDeparture) {
				departure.delay = getDelay(departure.time, scheduleDeparture)
			}
		}

		// NYCT subway feed frequently "forgets" past StopTimeUpdates
		// todo: add scheduled StopTimeUpdates that are missing in the realtime TripUpdate?

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
