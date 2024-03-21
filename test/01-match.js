import {after, test} from 'node:test'
import cloneDeep from 'lodash/cloneDeep.js'

import {
	stopMatching,
	matchTripUpdate,
	matchVehiclePosition,
	matchAlert,
} from '../index.js'
import { deepStrictEqual } from 'node:assert'

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

after(async () => {
	await stopMatching()
})

test('matching an N03R TripUpdate works', async (t) => {
	const now = 1710953000_000

	const tripUpdate = cloneDeep(tripUpdate072350_1_N03R)
	await matchTripUpdate(tripUpdate, {now})

	deepStrictEqual(tripUpdate, {
		trip: {
			trip_id: 'AFA23GEN-1092-Weekday-00_072350_1..N03R',
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
			trip_id: 'AFA23GEN-1092-Weekday-00_075150_1..S03R',
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
