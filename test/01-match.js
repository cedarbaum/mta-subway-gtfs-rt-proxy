import {after, test} from 'node:test'
import cloneDeep from 'lodash/cloneDeep.js'

import {
	stopMatching,
	matchTripUpdate,
	matchVehiclePosition,
	matchAlert,
	matchFeedMessage,
} from '../index.js'
import { deepStrictEqual, strictEqual } from 'node:assert'

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

after(async () => {
	await stopMatching()
})

test('matching an N03R TripUpdate works', async (t) => {
	const now = 1710953000_000

	const tripUpdate = cloneDeep(tripUpdate072350_1_N03R)
	await matchTripUpdate(tripUpdate, {now})

	deepStrictEqual(tripUpdate, {
		trip: {
			trip_id: tripUpdate072350_1_N03RScheduleTripId,
			start_date: '20240320',
			route_id: '1',
			'.nyct_trip_descriptor': {
				train_id: '01 1203+ SFT/242',
				is_assigned: true,
			},
			schedule_relationship: 0,
		},
		vehicle: {
			id: '01 1203+ SFT/242'
		},
		stop_time_update: [
			{
				arrival: {time: 1710953959n, delay: 319},
				departure: {time: 1710953959n, delay: 319},
				stop_id: '104N',
				'.nyct_stop_time_update': {
					scheduled_track: '4',
					actual_track: '4',
				},
				schedule_relationship: 0,
			},
			{
				arrival: {time: 1710954049n, delay: 319},
				departure: {time: 1710954199n, delay: 319},
				stop_id: '103N',
				'.nyct_stop_time_update': {
					scheduled_track: '4',
				},
				schedule_relationship: 0,
			},
			{
				arrival: {time: 1710954289n, delay: 319},
				stop_id: '101N',
				'.nyct_stop_time_update': {
					scheduled_track: '4',
				},
				schedule_relationship: 0,
			},
		],
		delay: 319,
	})
})

test('matching a S03R VehiclePosition works', async (t) => {
	const vehiclePosition = cloneDeep(vehiclePosition075150_1_S03R)
	await matchVehiclePosition(vehiclePosition)

	deepStrictEqual(vehiclePosition, {
		trip: {
			trip_id: vehiclePosition075150_1_S03RScheduleTripId,
			start_date: '20240320',
			route_id: '1',
			'.nyct_trip_descriptor': {
				train_id: '01 1231+ 242/SFT',
				is_assigned: true,
				direction: 3
			},
			schedule_relationship: 0,
		},
		vehicle: {
			id: '01 1231+ 242/SFT',
		},
		current_stop_sequence: 17,
		timestamp: 1710953964n,
		stop_id: '119S',
	})
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
