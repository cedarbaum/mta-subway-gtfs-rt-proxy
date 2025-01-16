import {promisify} from 'node:util'
import {after, test} from 'node:test'
import cloneDeep from 'lodash/cloneDeep.js'
import {
	createParseAndProcessFeed,
} from '../lib/match.js'
import {deepStrictEqual, ok, strictEqual} from 'node:assert'
import sortBy from 'lodash/sortBy.js'
import gtfsRtBindings from '../lib/mta-gtfs-realtime.pb.js'
import {connectToPostgres} from '../lib/db.js'
import {_restoreStopTimeUpdate} from '../lib/restore-stoptimeupdates.js'

const {ScheduleRelationship} = gtfsRtBindings.transit_realtime.TripDescriptor
const {VehicleStopStatus} = gtfsRtBindings.transit_realtime.VehiclePosition

const SCHEDULE_DB_NAME = process.env.PGDATABASE
ok(SCHEDULE_DB_NAME, 'SCHEDULE_DB_NAME')
const SCHEDULE_FEED_DIGEST = 'ce8d9c' // first 3 bytes of SHA-256 hash
const SCHEDULE_FEED_DIGEST_SLICE = SCHEDULE_FEED_DIGEST.slice(0, 1)

const tripUpdate072350_1_N03RScheduleTripId = 'AFA23GEN-1092-Weekday-00_072350_1..N03R'
const tripUpdate072350_1_N03R = {
	trip: {
		trip_id: '072350_1..N03R',
		start_date: '20240320',
		route_id: '1',
		'.nyct_trip_descriptor': { train_id: '01 1203+ SFT/242', is_assigned: true },
	},
	stop_time_update: [
		{
			arrival: { time: 1710953959n },
			departure: { time: 1710953959n },
			stop_id: '104N',
			'.nyct_stop_time_update': { scheduled_track: '4', actual_track: '4' },
		},
		{
			arrival: { time: 1710954049n },
			departure: { time: 1710954199n },
			stop_id: '103N',
			'.nyct_stop_time_update': { scheduled_track: '4' },
		},
		{
			arrival: { time: 1710954289n },
			stop_id: '101N',
			'.nyct_stop_time_update': { scheduled_track: '4' },
		},
	],
}
const tripUpdate072350_1_N03RMatched = {
	...tripUpdate072350_1_N03R,
	trip: {
		...tripUpdate072350_1_N03R.trip,
		trip_id: tripUpdate072350_1_N03RScheduleTripId,
		// start_time: '12:03:30',
		schedule_relationship: 0,
	},
	vehicle: {
		id: '01 1203+ SFT/242'
	},
	stop_time_update: [
		{
			...tripUpdate072350_1_N03R.stop_time_update[0],
			arrival: {
				...tripUpdate072350_1_N03R.stop_time_update[0].arrival,
				delay: 319,
			},
			departure: {
				...tripUpdate072350_1_N03R.stop_time_update[0].departure,
				delay: 319,
			},
			schedule_relationship: 0,
			stop_sequence: 36,
		},
		{
			...tripUpdate072350_1_N03R.stop_time_update[1],
			arrival: {
				...tripUpdate072350_1_N03R.stop_time_update[1].arrival,
				delay: 319,
			},
			departure: {
				...tripUpdate072350_1_N03R.stop_time_update[1].departure,
				delay: 319,
			},
			schedule_relationship: 0,
			stop_sequence: 37,
		},
		{
			...tripUpdate072350_1_N03R.stop_time_update[2],
			arrival: {
				...tripUpdate072350_1_N03R.stop_time_update[2].arrival,
				delay: 319,
			},
			schedule_relationship: 0,
			stop_sequence: 38,
		},
	],
	delay: 319,
}

const vehiclePosition075150_1_S03RScheduleTripId = 'AFA23GEN-1092-Weekday-00_075150_1..S03R'
const vehiclePosition075150_1_S03R = {
	trip: {
		trip_id: '075150_1..S03R',
		start_date: '20240320',
		route_id: '1',
		'.nyct_trip_descriptor': {
			train_id: '01 1231+ 242/SFT',
			is_assigned: true,
			direction: 3
		},
	},
	current_stop_sequence: 17,
	timestamp: 1710953964n,
	stop_id: '119S',
}
const vehiclePosition075150_1_S03RMatched = {
	...vehiclePosition075150_1_S03R,
	trip: {
		...vehiclePosition075150_1_S03R.trip,
		trip_id: vehiclePosition075150_1_S03RScheduleTripId,
		// start_time: '12:31:30',
		schedule_relationship: 0,
	},
	vehicle: {
		id: '01 1231+ 242/SFT',
	},
}

const alert0Entity0ScheduleTripId = 'todo' // todo
const alert0Entity1ScheduleTripId = 'todo' // todo
const alert0 = {
	informed_entity: [
		{
			trip: {
				trip_id: '075150_1..S03R',
				route_id: '1',
				'.nyct_trip_descriptor': {
					train_id: '01 1231+ 242/SFT',
					is_assigned: true,
				},
			},
		},
		{
			trip: {
				trip_id: '072350_1..N03R',
				route_id: '1',
				'.nyct_trip_descriptor': {
					train_id: '01 1203+ SFT/242',
					is_assigned: true,
				},
			},
		},
	],
	header_text: {
		translation: [
			{text: 'Train delayed'},
		],
	},
}
const alert0Matched = {
	...alert0,
	informed_entity: [
		{
			...alert0.informed_entity[0],
			// todo: `trip_id: vehiclePosition075150_1_S03RScheduleTripId`
		},
		{
			...alert0.informed_entity[1],
			// todo: `trip_id: tripUpdate072350_1_N03RScheduleTripId`
		},
	],
}

// a made-up TripUpdate that has no Schedule equivalent
const tripUpdateFooBar = {
	trip: {
		trip_id: 'foo-bar',
		start_date: '20240320',
		route_id: 'foo',
	},
	stop_time_update: [
		{
			arrival: {time: 1710954567n},
			departure: {time: 1710955678n},
			stop_id: 'some-unknown-stop',
		},
	],
}

// a made-up VehiclePosition that has no Schedule equivalent
const vehiclePositionBarBaz = {
	trip: {
		trip_id: 'bar-baz',
		start_date: '20240320',
		route_id: 'foo',
	},
	current_stop_sequence: 123,
	current_status: VehicleStopStatus.IN_TRANSIT_TO,
}

const feedMessage0 = {
	header: {
		gtfs_realtime_version: '1.0',
		timestamp: 1709140532n,
		'.nyct_feed_header': {
			nyct_subway_version: '1.0',
			trip_replacement_period: [],
		},
	},
	entity: [
		{
			id: 'one',
			trip_update: tripUpdate072350_1_N03R,
		},
		{
			id: 'two',
			vehicle: vehiclePosition075150_1_S03R,
		},
		{
			id: 'three',
			alert: alert0,
		},
	],
}
const feedMessage0Matched = {
	...feedMessage0,
	entity: [
		{
			...feedMessage0.entity[0],
			trip_update: tripUpdate072350_1_N03RMatched,
		},
		{
			...feedMessage0.entity[1],
			vehicle: vehiclePosition075150_1_S03RMatched,
		},
		{
			...feedMessage0.entity[2],
			alert: alert0Matched,
		},
	],
}

const feedMessage1Matched = {
	...feedMessage0Matched,
	header: {
		...feedMessage0Matched.header,
		'.nyct_feed_header': {
			...feedMessage0Matched.header['.nyct_feed_header'],
			trip_replacement_period: [
				{ // overlaps with `tripUpdate072350_1_N03R` & `vehiclePosition075150_1_S03R`
					route_id: '1',
					replacement_period: {
						start: 1710952410n, // 2024-03-20T12:33:30-04:00
						end: 1710952471n, // 2024-03-20T12:34:31-04:00
					},
				},
				{ // overlaps with no feed entity
					route_id: '4',
					replacement_period: {
						start: 1710954410n, // 2024-03-20T13:06:50-04:00
						end: 1710954430n, // 2024-03-20T13:07:10-04:00
					},
				},
			],
		},
	},
}

const queryDbOnce = async (...queryArgs) => {
	const db = await connectToPostgres()
	try {
		return await db.query(...queryArgs)
	} finally {
		await promisify(db.end.bind(db))()
	}
}
const clearPreviousStopTimeUpdatesDb = async () => {
	await queryDbOnce(`TRUNCATE TABLE previous_stoptimeupdates`)
}

const {
	matchTripUpdate,
	matchVehiclePosition,
	matchAlert,
	matchFeedMessage,
	storeStopTimeUpdatesInDb,
	restoreStopTimeUpdatesFromDb,
	applyTripReplacementPeriods,
	stop: stopMatching,
} = await createParseAndProcessFeed({
	scheduleDatabaseName: SCHEDULE_DB_NAME,
	scheduleFeedDigest: SCHEDULE_FEED_DIGEST,
	scheduleFeedDigestSlice: SCHEDULE_FEED_DIGEST_SLICE,
})

after(async () => {
	await stopMatching()
})

test('matching an N03R TripUpdate works', async (t) => {
	const now = 1710953000_000

	const tripUpdate = cloneDeep(tripUpdate072350_1_N03R)
	await matchTripUpdate(tripUpdate, {now})

	deepStrictEqual(tripUpdate, tripUpdate072350_1_N03RMatched)
})

test('matching N03R TripUpdate still happens if it has the Schedule trip_id', async (t) => {
	const now = 1710953000_000

	const tripUpdate = cloneDeep(tripUpdate072350_1_N03R)
	tripUpdate.trip.trip_id = tripUpdate072350_1_N03RScheduleTripId
	await matchTripUpdate(tripUpdate, {now})

	deepStrictEqual(tripUpdate, tripUpdate072350_1_N03RMatched)
})

test('unmatched TripUpdates get schedule_relationship: ADDED', async (t) => {
	const tripUpdate = cloneDeep(tripUpdateFooBar)
	await matchTripUpdate(tripUpdate)

	strictEqual(tripUpdate?.trip?.schedule_relationship, ScheduleRelationship.ADDED, 'wrong schedule_relationship')
})

test('matching a S03R VehiclePosition works', async (t) => {
	const vehiclePosition = cloneDeep(vehiclePosition075150_1_S03R)
	await matchVehiclePosition(vehiclePosition)

	deepStrictEqual(vehiclePosition, vehiclePosition075150_1_S03RMatched)
})

test('unmatched VehiclePositions get schedule_relationship: ADDED', async (t) => {
	const vehiclePosition = cloneDeep(vehiclePositionBarBaz)
	await matchVehiclePosition(vehiclePosition)

	strictEqual(vehiclePosition?.trip?.schedule_relationship, ScheduleRelationship.ADDED, 'wrong schedule_relationship')
})

test('matchTripUpdate() correctly filter by suffix', async (t) => {
	const now = 1710953000_000
	const prefixed = {
		...tripUpdate072350_1_N03R,
		trip: {
			...tripUpdate072350_1_N03R.trip,
			trip_id: '__' + tripUpdate072350_1_N03R.trip.trip_id,
		},
	}

	const tripUpdate = cloneDeep(prefixed)
	await matchTripUpdate(tripUpdate, {now})
	strictEqual(tripUpdate.trip.trip_id, prefixed.trip.trip_id, 'TripUpdate must not be matched')
})

// todo
test.skip('matching an Alert affecting S03R & N03R works', async (t) => {
	const alert = cloneDeep(alert0)
	await matchAlert(alert)

	deepStrictEqual(alert, {
		informed_entity: [
			{
				trip: {
					trip_id: '075150_1..S03R',
					start_date: '20240320',
					route_id: '1',
					'.nyct_trip_descriptor': {
						train_id: '01 1231+ 242/SFT',
						is_assigned: true,
					},
				},
			},
			{
				trip: {
					trip_id: '072350_1..N03R',
					start_date: '20240320',
					route_id: '1',
					'.nyct_trip_descriptor': {
						train_id: '01 1203+ SFT/242',
						is_assigned: true,
					},
				},
			},
		],
		header_text: {
			translation: [
				{text: 'Train delayed'},
			],
		},
	})
})

test('matching a FeedMessage works', async (t) => {
	const now = 1710953000_000

	const feedMessage = cloneDeep(feedMessage0)
	await matchFeedMessage(feedMessage, {now})

	// assert that matching has succeeded by checking for GTFS Schedule trip IDs

	deepStrictEqual(feedMessage, feedMessage0Matched) // todo: remove

	{
		const tripUpdate = feedMessage.entity[0].trip_update
		strictEqual(
			tripUpdate.trip.trip_id,
			tripUpdate072350_1_N03RScheduleTripId,
			'feedMessage.entity[0].trip_update.trip.trip_id',
		)
	}

	{
		const vehiclePosition = feedMessage.entity[1].vehicle
		strictEqual(
			vehiclePosition.trip.trip_id,
			vehiclePosition075150_1_S03RScheduleTripId,
			'feedMessage.entity[1].vehicle.trip.trip_id',
		)
	}

	// todo: fix matchAlert
	// {
	// 	const alert = feedMessage.entity[2].alert
	// 	strictEqual(
	// 		alert.informed_entity[0].trip.trip_id,
	// 		alert0Entity0ScheduleTripId,
	// 		'feedMessage.entity[2].alert.informed_entity[0].trip.trip_id',
	// 	)
	// 	strictEqual(
	// 		alert.informed_entity[1].trip.trip_id,
	// 		alert0Entity1ScheduleTripId,
	// 		'feedMessage.entity[2].alert.informed_entity[1].trip.trip_id',
	// 	)
	// }
})

test('StopTimeUpdates restoring logic works', (t) => {
	const timestamp = 1234567n
	const _stopTimeUpdate1 = tripUpdate072350_1_N03R.stop_time_update[1]
	const _scheduleStopTimeUpdate1 = {
		trip_id: tripUpdate072350_1_N03R.trip.trip_id,
		start_date: tripUpdate072350_1_N03R.trip.start_date,
		stop_id: _stopTimeUpdate1.stop_id,
		timestamp: timestamp - BigInt(123),
		arrival_time: 123456n,
		arrival_delay: 123n,
		departure_time: 234567n,
		departure_delay: 234n,
	}

	{ // Realtime `arrival: null`
		const stopTimeUpdate1 = cloneDeep({
			..._stopTimeUpdate1,
			arrival: null
		})
		const scheduleStopTimeUpdate1 = cloneDeep(_scheduleStopTimeUpdate1)
		_restoreStopTimeUpdate(stopTimeUpdate1, timestamp, scheduleStopTimeUpdate1)
		deepStrictEqual(stopTimeUpdate1.arrival, {
			time: _scheduleStopTimeUpdate1.arrival_time,
			// no delay field
		})
	}
	{ // Realtime `arrival.time: null` & `arrival.delay: null`
		const stopTimeUpdate1 = cloneDeep({
			..._stopTimeUpdate1,
			arrival: {
				time: null,
				delay: null,
			},
		})
		const scheduleStopTimeUpdate1 = cloneDeep(_scheduleStopTimeUpdate1)
		_restoreStopTimeUpdate(stopTimeUpdate1, timestamp, scheduleStopTimeUpdate1)
		deepStrictEqual(stopTimeUpdate1.arrival, {
			time: _scheduleStopTimeUpdate1.arrival_time,
			// no delay field
		})
	}
	{ // Realtime timestamp older than Schedule timestamp
		const stopTimeUpdate1 = cloneDeep(_stopTimeUpdate1)
		const scheduleStopTimeUpdate1 = cloneDeep({
			..._scheduleStopTimeUpdate1,
			timestamp: timestamp + BigInt(12),
		})
		_restoreStopTimeUpdate(stopTimeUpdate1, timestamp, scheduleStopTimeUpdate1)
		deepStrictEqual(stopTimeUpdate1.arrival, {
			time: _scheduleStopTimeUpdate1.arrival_time,
			// no delay field
		})
	}
	{ // Realtime arrival unchanged
		const stopTimeUpdate1 = cloneDeep(_stopTimeUpdate1)
		const scheduleStopTimeUpdate1 = cloneDeep(_scheduleStopTimeUpdate1)
		_restoreStopTimeUpdate(stopTimeUpdate1, timestamp, scheduleStopTimeUpdate1)
		deepStrictEqual(stopTimeUpdate1.arrival, _stopTimeUpdate1.arrival)
	}

	{ // Realtime `departure: null`
		const stopTimeUpdate1 = cloneDeep({
			..._stopTimeUpdate1,
			departure: null
		})
		const scheduleStopTimeUpdate1 = cloneDeep(_scheduleStopTimeUpdate1)
		_restoreStopTimeUpdate(stopTimeUpdate1, timestamp, scheduleStopTimeUpdate1)
		deepStrictEqual(stopTimeUpdate1.departure, {
			time: _scheduleStopTimeUpdate1.departure_time,
			// no delay field
		})
	}
	{ // Realtime `departure.time: null` & `departure.delay: null`
		const stopTimeUpdate1 = cloneDeep({
			..._stopTimeUpdate1,
			departure: {
				time: null,
				delay: null,
			},
		})
		const scheduleStopTimeUpdate1 = cloneDeep(_scheduleStopTimeUpdate1)
		_restoreStopTimeUpdate(stopTimeUpdate1, timestamp, scheduleStopTimeUpdate1)
		deepStrictEqual(stopTimeUpdate1.departure, {
			time: _scheduleStopTimeUpdate1.departure_time,
			// no delay field
		})
	}
	{ // Realtime timestamp older than Schedule timestamp
		const stopTimeUpdate1 = cloneDeep(_stopTimeUpdate1)
		const scheduleStopTimeUpdate1 = cloneDeep({
			..._scheduleStopTimeUpdate1,
			timestamp: timestamp + BigInt(12),
		})
		_restoreStopTimeUpdate(stopTimeUpdate1, timestamp, scheduleStopTimeUpdate1)
		deepStrictEqual(stopTimeUpdate1.departure, {
			time: _scheduleStopTimeUpdate1.departure_time,
			// no delay field
		})
	}
	{ // Realtime departure unchanged
		const stopTimeUpdate1 = cloneDeep(_stopTimeUpdate1)
		const scheduleStopTimeUpdate1 = cloneDeep(_scheduleStopTimeUpdate1)
		_restoreStopTimeUpdate(stopTimeUpdate1, timestamp, scheduleStopTimeUpdate1)
		deepStrictEqual(stopTimeUpdate1.departure, _stopTimeUpdate1.departure)
	}

	// todo: other cases?
})

test('storing current & restoring previous StopTimeUpdates works', async (t) => {
	await clearPreviousStopTimeUpdatesDb()
	try {
		// 1. store TripUpdate's StopTimeUpdates in the DB
		{
			// todo: test with FeedMessage with >1 TripUpdate
			const feedMessage = cloneDeep(feedMessage0)
			await storeStopTimeUpdatesInDb(feedMessage)

			// todo
			// We expect only the (single) TripUpdate (0th feed entity) to be in here, as restoring StopTimeUpdates only makes sense for TripUpdates.
			const bigintToNumber = bi => parseInt(String(bi), 10)
			const expectedStopTimeUpdates = tripUpdate072350_1_N03R.stop_time_update.map((sTU) => ({
				stop_id: sTU.stop_id,
				timestamp: bigintToNumber(feedMessage0.header.timestamp),
				arrival_time: bigintToNumber(sTU.arrival.time),
				arrival_delay: null, // we didn't provide this before
				departure_time: sTU.departure?.time ? bigintToNumber(sTU.departure.time) : null,
				departure_delay: null, // we didn't provide this before
			}))
			const {
				rows: storedStopTimeUpdates,
			} = await queryDbOnce(`\
				SELECT
					stop_id,
					timestamp,
					arrival_time,
					arrival_delay,
					departure_time,
					departure_delay
				FROM previous_stoptimeupdates
				WHERE trip_id = $1
				AND start_date = $2
				ORDER BY stop_id
			`, [
				tripUpdate072350_1_N03R.trip.trip_id,
				tripUpdate072350_1_N03R.trip.start_date,
			])
			deepStrictEqual(
				storedStopTimeUpdates,
				sortBy(expectedStopTimeUpdates, ({stop_id}) => stop_id),
				'stored StopTimeUpdates seem wrong',
			)
		}

		// 2. match TU with STUs missing some realtime data, check if restored from the DB
		{
			const newStopTimeUpdate = {
				stop_id: 'some-random-stop-id',
				arrival: {time: 1710954123n},
				departure: {time: 1710954234n},
			}
			const feedMessageRestored = cloneDeep({
				...feedMessage0,
				entity: [
					{
						id: 'foo',
						trip_update: {
							...tripUpdate072350_1_N03R,
							// todo: modify timestamp!
							stop_time_update: [
								{ // STU #0: remove departure_time
									...tripUpdate072350_1_N03R.stop_time_update[0],
									departure: {time: null},
								},
								{ // STU #1: remove arrival_time
									...tripUpdate072350_1_N03R.stop_time_update[1],
									arrival: {time: null},
								},
								newStopTimeUpdate,
								// all other STUs: keep as-is
								...tripUpdate072350_1_N03R.stop_time_update.slice(2),
							],
						},
					},
				],
			})
			await restoreStopTimeUpdatesFromDb(feedMessageRestored)

			const tripUpdate0Restored = feedMessageRestored.entity[0].trip_update
			const tripUpdate0Expected = feedMessage0.entity[0].trip_update

			deepStrictEqual(
				tripUpdate0Restored.stop_time_update[0],
				tripUpdate0Expected.stop_time_update[0],
				`TripUpdate #0's StopTimeUpdate #0 is not restored`,
			)

			deepStrictEqual(
				tripUpdate0Restored.stop_time_update[1],
				tripUpdate0Expected.stop_time_update[1],
				`TripUpdate #0's StopTimeUpdate #1 is not restored`,
			)

			deepStrictEqual(
				tripUpdate0Restored.stop_time_update[2],
				newStopTimeUpdate,
				`TripUpdate #0's StopTimeUpdate #2 is wrong`,
			)
		}
	} finally {
		await clearPreviousStopTimeUpdatesDb()
	}
})

test('applying FeedReplacementPeriods works', async (t) => {
	const feedMessage = cloneDeep(feedMessage1Matched)
	await applyTripReplacementPeriods(feedMessage)

	const expectedCanceled = sortBy(
		[
			['1', 'AFA23GEN-1092-Weekday-00_069750_1..S03R', '20240320', '11:37:30'],
			['1', 'AFA23GEN-1092-Weekday-00_070350_1..S03R', '20240320', '11:43:30'],
			['1', 'AFA23GEN-1092-Weekday-00_070550_1..N03R', '20240320', '11:45:30'],
			['1', 'AFA23GEN-1092-Weekday-00_070950_1..S03R', '20240320', '11:49:30'],
			['1', 'AFA23GEN-1092-Weekday-00_071150_1..N03R', '20240320', '11:51:30'],
			['1', 'AFA23GEN-1092-Weekday-00_071550_1..S03R', '20240320', '11:55:30'],
			['1', 'AFA23GEN-1092-Weekday-00_071750_1..N03R', '20240320', '11:57:30'],
			['1', 'AFA23GEN-1092-Weekday-00_072150_1..S03R', '20240320', '12:01:30'],
			['1', 'AFA23GEN-1092-Weekday-00_072750_1..S03R', '20240320', '12:07:30'],
			['1', 'AFA23GEN-1092-Weekday-00_072950_1..N03R', '20240320', '12:09:30'],
			['1', 'AFA23GEN-1092-Weekday-00_073550_1..N03R', '20240320', '12:15:30'],
			['1', 'AFA23GEN-1092-Weekday-00_074150_1..N03R', '20240320', '12:21:30'],
			['1', 'AFA23GEN-1092-Weekday-00_074750_1..N03R', '20240320', '12:27:30'],
			['1', 'AFA23GEN-1092-Weekday-00_075350_1..N03R', '20240320', '12:33:30'],
			['4', 'AFA23GEN-4103-Weekday-00_072350_4..S06R', '20240320', '12:03:30'],
			['4', 'AFA23GEN-4103-Weekday-00_077200_4..S06R', '20240320', '12:52:00'],
		],
		// match sorting in applyTripReplacementPeriods(): route_id, then trip_id, then start_date
		([route_id]) => route_id,
		([_, trip_id]) => trip_id,
		([_, __, start_date]) => start_date,
	)

	const expectedAddFeedEntities = expectedCanceled
	.map(([route_id, trip_id, start_date, start_time]) => ({
		id: `canceled-${start_date}-${trip_id}`,
		trip_update: {
			trip: {
				trip_id,
				route_id,
				start_date,
				start_time,
				schedule_relationship: ScheduleRelationship.CANCELED,
			},
		},
	}))
	const expectedFeedMessage = {
		...feedMessage1Matched,
		entity: [
			...expectedAddFeedEntities,
			...feedMessage1Matched.entity,
		],
	}

	deepStrictEqual(feedMessage, expectedFeedMessage)
})

// todo: trip that visits one stop more than once, e.g. a loop
