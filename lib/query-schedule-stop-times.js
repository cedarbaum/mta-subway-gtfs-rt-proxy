import {ok} from 'node:assert'

const subdivisionsByRouteId = new Map([
	['1', 'A'],
	// todo
])

const queryScheduleStopTimes = async (cfg) => {
	const {
		route_id,
		start_date,
		trip_id,
		stop_id = null,
		db,
		matchingSuccesses,
		matchingFailures,
		dbQueryTimeSeconds,
		limit,
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
		// todo: DRY with query below
// 		const t0 = performance.now()
// 		const {rows: scheduleStopTimes} = await db.query({
// 			// allow `pg` to create a prepared statement
// 			name: `stop_times_suffix${stop_id === null ? '' : '_stop_id'}`,
// 			text: `\
// 				SELECT
// 					trip_id,
// 					stop_id,
// 					stop_sequence, -- useful for debugging
// 					t_arrival, t_departure
// 				FROM arrivals_departures
// 				WHERE route_id = $1
// 				-- Because we identify our parameters using their index in the "values" array below, dynamically inserting the entire "stop_id" condition would mean that all subsequent parameters' indices change, making the code much more complex.
// 				-- Instead, if "stop_id" is "null", we make this condition *always* true by comparing "$5" to itself. Because in SQL "NULL" is compared using the "is" operator, we insert "1" below, yielding "AND 1 = 1".
// 				AND ${stop_id === null ? '$5' : 'stop_id'} = $5
// 				AND "date" = $2
// 				AND trip_id = $3
// 				-- todo: for now, we don't support frequencies.txt-based trips yet
// 				AND frequencies_it = -1
// 				ORDER BY stop_sequence_consec ASC
// 				LIMIT $4
// `,
// 			values: [
// 				route_id,
// 				isoStartDate,
// 				_trip_id,
// 				limit,
// 				stop_id === null ? 1 : stop_id,
// 			],
// 		})
// 		dbQueryTimeSeconds.observe({
// 			route_id,
// 			success: scheduleStopTimes.length > 0,
// 			by_suffix: false,
// 		}, (performance.now() - t0) / 1000)

// 		if (scheduleStopTimes.length > 0) {
// 			matchingSuccesses.inc({route_id, by_suffix: false})
// 			return scheduleStopTimes
// 		}
// 		matchingFailures.inc({route_id, by_suffix: false})
	}

	// As a fallback, try to match the trip by suffix-matching the GTFS Schedule trip ID using the GTFS Realtime ID.
	{
		const t0 = performance.now()
		const {rows: scheduleStopTimes} = await db.query({
			// allow `pg` to create a prepared statement
			name: `stop_times_suffix${stop_id === null ? '' : '_stop_id'}`,
			text: `\
				SELECT
					trip_id,
					stop_id,
					stop_sequence, -- useful for debugging
					t_arrival, t_departure
				FROM arrivals_departures
				WHERE route_id = $1
				-- Because we identify our parameters using their index in the "values" array below, dynamically inserting the entire "stop_id" condition would mean that all subsequent parameters' indices change, making the code much more complex.
				-- Instead, if "stop_id" is "null", we make this condition *always* true by comparing "$5" to itself. Because in SQL "NULL" is compared using the "is" operator, we insert "1" below, yielding "AND 1 = 1".
				AND ${stop_id === null ? '$5' : 'stop_id'} = $5
				AND "date" = $2
				AND trip_id LIKE $3
				-- todo: for now, we don't support frequencies.txt-based trips yet
				AND frequencies_it = -1
				ORDER BY stop_sequence_consec ASC
				LIMIT $4
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
				limit,
				stop_id === null ? 1 : stop_id,
			],
		})
		dbQueryTimeSeconds.observe({
			route_id,
			success: scheduleStopTimes.length > 0,
			by_suffix: true,
		}, (performance.now() - t0) / 1000)

		if (scheduleStopTimes.length > 0) {
			matchingSuccesses.inc({route_id, by_suffix: true})
			return scheduleStopTimes
		}
		matchingFailures.inc({route_id, by_suffix: true})
	}

	return []
}

export {
	queryScheduleStopTimes,
}
