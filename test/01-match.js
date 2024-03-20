import {after, test} from 'node:test'
import cloneDeep from 'lodash/cloneDeep.js'

import {
	stopMatching,
	matchTripUpdate,
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

after(async () => {
	await stopMatching()
})

test('matching an N03R TripUpdate works', async (t) => {
	const tripUpdate = cloneDeep(tripUpdate072350_1_N03R)
	await matchTripUpdate(tripUpdate)

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
	})
})
