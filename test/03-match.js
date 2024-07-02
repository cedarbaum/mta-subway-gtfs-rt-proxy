import merge from 'lodash/merge.js'
import {after, test} from 'node:test'
import cloneDeep from 'lodash/cloneDeep.js'
import gtfsRtBindings from '../lib/mta-gtfs-realtime.pb.js'
import {
	createParseAndProcessFeed,
} from '../lib/match.js'
import {deepStrictEqual, ok} from 'node:assert'

const {VehicleStopStatus} = gtfsRtBindings.transit_realtime.VehiclePosition

const SCHEDULE_DB_NAME = process.env.PGDATABASE
ok(SCHEDULE_DB_NAME, 'SCHEDULE_DB_NAME')
// `sha256sum node_modules/sample-gtfs-feed/gtfs.zip`
const SCHEDULE_FEED_DIGEST = '3669d7' // first 3 bytes of SHA-256 hash
const SCHEDULE_FEED_DIGEST_SLICE = SCHEDULE_FEED_DIGEST.slice(0, 1)

// from sample-gtfs-feed@0.13's `stop_times.js`:
// > ```
// > applyToTrips(cOutboundAllDay, 1,      null,  '19:20:00', airport.station),
// > applyToTrips(cOutboundAllDay, 2, '19:29:30', '19:30:30', museum.station),
// > applyToTrips(cOutboundAllDay, 3, '19:39:30', '19:40:30', airport.station),
// > applyToTrips(cOutboundAllDay, 4, '19:50:00',      null,  center.station),
// > ```
const cOutboundAllDayScheduleTripId = 'c-outbound-all-day'

const tripUpdateCOutboundAllDay = {
	trip: {
		// Because the code base assumes that (route_id, date, trip_id_suffix) is unique, we have to use such a long suffix here. (`all-day` would not be specific enough.)
		trip_id: 'outbound-all-day', // a suffix of the Schedule trip_id
		start_date: '20190524', // friday
		route_id: 'C',
		'.nyct_trip_descriptor': {train_id: 'rAndom-vehicle-id', is_assigned: true},
	},
	stop_time_update: [
		{
			arrival: {time: 1558718380n}, // 2019-05-24T19:19:40+02:00
			departure: {time: 1558718470n}, // 2019-05-24T19:21:10+02:00, 70s delay
			stop_id: 'airport',
			stop_sequence: 1,
			// '.nyct_stop_time_update': {scheduled_track: '4', actual_track: '4'},
		},
		{
			arrival: {time: 1558718970n}, // 2019-05-24T19:29:30+02:00, 0s delay
			// departure omitted on purpose
			stop_id: 'museum',
			stop_sequence: 2,
		},
		{ // note the loop
			arrival: {time: 1558719600n}, // 2019-05-24T19:40:00+02:00, 30s delay
			departure: {time: 1558719670n}, // 2019-05-24T19:41:10+02:00, 40s delay
			stop_id: 'airport',
			stop_sequence: 3,
		},
		{
			arrival: {time: 1558720230n}, // 2019-05-24T19:50:30+02:00, 30s delay
			stop_id: 'center',
			stop_sequence: 4,
		},
	],
}
const tripUpdateCOutboundAllDayMatched = merge(cloneDeep(tripUpdateCOutboundAllDay), {
	trip: {
		trip_id: cOutboundAllDayScheduleTripId,
		// start_time: '19:20:00',
		schedule_relationship: 0,
	},
	vehicle: {
		id: 'rAndom-vehicle-id',
	},
	stop_time_update: [
		{
			arrival: {
				// no planned arrival, so no delay field
			},
			departure: {
				delay: 70,
			},
			schedule_relationship: 0,
		},
		{
			arrival: {
				delay: 0,
			},
			// todo?
			// // departure from Schedule feed
			// departure: {
			// 	time: 1558719030n, // 2019-05-24T19:30:30+02:00
			// 	// delay: 0,
			// },
			schedule_relationship: 0,
		},
		{
			arrival: {
				delay: 30,
			},
			departure: {
				delay: 40,
			},
			schedule_relationship: 0,
		},
		{
			arrival: {
				delay: 30,
			},
			schedule_relationship: 0,
		},
	],
	delay: 70, // as of 2019-05-24T19:21:00+02:00
})

const vehiclePositionCOutboundAllDay = {
	trip: {
		// Because the code base assumes that (route_id, date, trip_id_suffix) is unique, we have to use such a long suffix here. (`all-day` would not be specific enough.)
		trip_id: 'outbound-all-day', // a suffix of the Schedule trip_id
		start_date: '20190524', // friday
		route_id: 'C',
		'.nyct_trip_descriptor': {train_id: 'rAndom-vehicle-id', is_assigned: true},
	},
	// on its way from museum to airport
	current_status: VehicleStopStatus.IN_TRANSIT_TO,
	current_stop_sequence: 3,
	stop_id: 'airport',
	timestamp: 1558719312n, // 2019-05-24T19:35:12+02:00
}
const vehiclePositionCOutboundAllDayMatched = merge(cloneDeep(vehiclePositionCOutboundAllDay), {
	trip: {
		trip_id: cOutboundAllDayScheduleTripId,
		// start_time: '19:20:00',
		schedule_relationship: 0,
	},
	vehicle: {
		id: 'rAndom-vehicle-id',
	},
})

const {
	matchTripUpdate,
	matchVehiclePosition,
	stop: stopMatching,
} = await createParseAndProcessFeed({
	scheduleDatabaseName: SCHEDULE_DB_NAME,
	scheduleFeedDigest: SCHEDULE_FEED_DIGEST,
	scheduleFeedDigestSlice: SCHEDULE_FEED_DIGEST_SLICE,
})

after(async () => {
	await stopMatching()
})

test('matching a TripUpdate of a trip that visits a stop twice works', async (t) => {
	const now = 1558718460_000 // 2019-05-24T19:21:00+02:00

	const tripUpdate = cloneDeep(tripUpdateCOutboundAllDay)
	await matchTripUpdate(tripUpdate, {now})

	deepStrictEqual(tripUpdate, tripUpdateCOutboundAllDayMatched)
})
// todo: test stop_time matching with additional realtime StopTimeUpdate

test('matching a VehiclePosition of a trip that visits a stop twice works', async (t) => {
	const now = 1558719360_000 // 2019-05-24T19:36:00+02:00

	const vehiclePosition = cloneDeep(vehiclePositionCOutboundAllDay)
	await matchVehiclePosition(vehiclePosition, {now})

	deepStrictEqual(vehiclePosition, vehiclePositionCOutboundAllDayMatched)
})
