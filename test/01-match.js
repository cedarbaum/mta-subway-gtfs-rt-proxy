import {after, test} from 'node:test'
import cloneDeep from 'lodash/cloneDeep.js'

import {
	stopMatching,
	matchTripUpdate,
	matchVehiclePosition,
	matchAlert,
	matchFeedMessage,
	applyTripReplacementPeriods,
} from '../index.js'
import { deepStrictEqual, strictEqual } from 'node:assert'
import sortBy from 'lodash/sortBy.js'
import gtfsRtBindings from '../lib/mta-gtfs-realtime.pb.js'

const {ScheduleRelationship} = gtfsRtBindings.transit_realtime.TripDescriptor

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
		},
		{
			...tripUpdate072350_1_N03R.stop_time_update[2],
			arrival: {
				...tripUpdate072350_1_N03R.stop_time_update[2].arrival,
				delay: 319,
			},
			schedule_relationship: 0,
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

after(async () => {
	await stopMatching()
})

test('matching an N03R TripUpdate works', async (t) => {
	const now = 1710953000_000

	const tripUpdate = cloneDeep(tripUpdate072350_1_N03R)
	await matchTripUpdate(tripUpdate, {now})

	deepStrictEqual(tripUpdate, tripUpdate072350_1_N03RMatched)
})

test('matching a S03R VehiclePosition works', async (t) => {
	const vehiclePosition = cloneDeep(vehiclePosition075150_1_S03R)
	await matchVehiclePosition(vehiclePosition)

	deepStrictEqual(vehiclePosition, vehiclePosition075150_1_S03RMatched)
})

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
	const feedMessage = cloneDeep(feedMessage0)
	await matchFeedMessage(feedMessage)

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
