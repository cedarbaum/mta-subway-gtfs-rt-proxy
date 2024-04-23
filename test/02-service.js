import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {createServer} from 'node:http'
import ky from 'ky'
import {getMetricsFromIterator as parseMetricsFromIterator} from 'prom2javascript'
import {beforeEach, afterEach, test} from 'node:test'
import {execa} from 'execa';
import {ok, strictEqual} from 'node:assert'
import {promisify} from 'node:util'
import gtfsRtBindings from '../lib/mta-gtfs-realtime.pb.js'
import {encodeFeedMessage} from '../lib/serve-gtfs-rt.js'
import {connectToPostgres} from '../lib/db.js'

const {FeedMessage} = gtfsRtBindings.transit_realtime
const {Direction} = gtfsRtBindings.NyctTripDescriptor
// const {ScheduleRelationship} = gtfsRtBindings.transit_realtime.TripDescriptor

const PATH_TO_SERVICE = new URL(import.meta.resolve('../start.js')).pathname

// DRY with https://github.com/mobidata-bw/postgis-gtfs-importer/blob/1e4481cb3874b1b3a5996e60ea5d6e98e2ec2df9/import.js#L24-L31
const DIGEST_LENGTH = 6
const sha256 = (buf) => {
	const hash = createHash('sha256')
	hash.update(buf)
	return hash.digest('hex').slice(0, DIGEST_LENGTH).toLowerCase()
}

// note: import.meta.resolve() is not stable yet!
const FOO_TRIP_ID_PREFIX = 'FoO_' // currently hard-coded in test/02-service-prepare.sh
const FOO_FEED = readFileSync(
	new URL(import.meta.resolve('./foo.gtfs.zip')).pathname,
)
const FOO_FEED_DIGEST = sha256(FOO_FEED)

const BAR_TRIP_ID_PREFIX = 'bAr_' // currently hard-coded in test/02-service-prepare.sh
const BAR_FEED = readFileSync(
	new URL(import.meta.resolve('./bar.gtfs.zip')).pathname,
)
const BAR_FEED_DIGEST = sha256(BAR_FEED)

const serveFile = async (filename) => {
	let file = null
	const setFile = (newFile) => {
		file = newFile
	}
	const serveFile = (req, res) => {
		const {pathname} = new URL(req.url, 'http://example.org')
		if (pathname === '/' + filename && file !== null) {
			res.end(file)
		} else {
			res.writeHead(404).end()
		}
	}
	const server = await new Promise((resolve, reject) => {
		const server = createServer(serveFile)
		server.listen((err) => {
			if (err) reject(err)
			else resolve(server)
		})
	})
	return {
		port: server.address().port,
		stop: server.close.bind(server),
		setFile,
	}
}

const fetchAndParseMatchedRealtimeFeed = async (cfg) => {
	const {
		port,
		realtimeFeedName,
		scheduleFeedDigest,
	} = cfg
	const url = `http://localhost:${port}/feeds/${realtimeFeedName}?schedule-feed-digest=${scheduleFeedDigest}`
	const res = await ky(url, {
		redirect: 'follow',
		retry: 0,
	})
	const feedEncoded = Buffer.from(await res.arrayBuffer())
	const feedMessage = FeedMessage.decode(feedEncoded)
	return feedMessage
}

const fetchAndParseMetrics = async (cfg) => {
	const {
		port,
	} = cfg
	const res = await ky(`http://localhost:${port}/metrics`, {
		redirect: 'follow',
		retry: 0,
	})
	let metricsEncoded = await res.text()

	metricsEncoded = metricsEncoded.split(/\r?\n/)
	const metrics = await parseMetricsFromIterator(metricsEncoded[Symbol.iterator]())
	return metrics
}

const SCHEDULE_FEED_BOOKKEEPING_DB_NAME = `test_${Math.random().toString(16).slice(2, 4)}`
const SCHEDULE_FEED_DB_NAME_PREFIX = SCHEDULE_FEED_BOOKKEEPING_DB_NAME + '_'

const createTestDbs = async () => {
	const db = connectToPostgres()

	await db.query(`CREATE DATABASE "${SCHEDULE_FEED_BOOKKEEPING_DB_NAME}"`)

	await promisify(db.end.bind(db))()
}

const purgeTestDbs = async () => {
	const db = connectToPostgres()

	await db.query(`DROP DATABASE "${SCHEDULE_FEED_BOOKKEEPING_DB_NAME}"`)

	const {rows} = await db.query(`\
		SELECT datname AS db_name
		FROM pg_catalog.pg_database
		ORDER BY datname ASC
	`)
	for (const {db_name} of rows) {
		if (db_name.slice(0, SCHEDULE_FEED_DB_NAME_PREFIX.length) === SCHEDULE_FEED_DB_NAME_PREFIX) {
			await db.query(`DROP DATABASE "${db_name}"`)
		}
	}

	await promisify(db.end.bind(db))()
}

const assertMoreMatchingSuccessesThanFailures = (successesName, successes, failuresName, failures, filterFn) => {
	const _successes = successes.data.find(filterFn)
	const _failures = failures.data.find(filterFn)
	ok(
		(_successes?.value || 0) > (_failures?.value || 0),
		`${successesName} (${_successes?.value}) should be > ${failuresName} ${_failures?.value}`,
	)
}

const tripUpdate1 = {
	trip: {
		trip_id: 'b-outbound-on-working-days',
		start_date: '20190507',
		route_id: 'B',
		'.nyct_trip_descriptor': {train_id: 'some-train-id', is_assigned: true},
	},
	stop_time_update: [
		{
			arrival: {time: 1557245580}, // 2019-05-07T18:13:00+02:00
			departure: {time: 1557245658}, // 2019-05-07T18:14:18+02:00
			stop_id: 'center',
		},
		{
			arrival: {time: 1557246070}, // 2019-05-07T18:21:10+02:00
			departure: {time: 1557246145}, // 2019-05-07T18:22:25+02:00
			stop_id: 'lake',
			'.nyct_stop_time_update': {scheduled_track: '1a'},
		},
		{
			arrival: {time: 1557246610}, // 2019-05-07T18:40:00+02:00
			departure: {time: 1557246660}, // 2019-05-07T18:31:00+02:00
			stop_id: 'airport',
			'.nyct_stop_time_update': {scheduled_track: '2b'},
		},
	],
}
const vehiclePosition1 = {
	trip: {
		trip_id: 'a-downtown-all-day',
		start_date: '20190507',
		route_id: 'A',
		'.nyct_trip_descriptor': {
			train_id: 'another-train-id',
			is_assigned: true,
			direction: Direction.EAST,
		},
	},
	current_stop_sequence: 1, // at `museum`
	timestamp: 1557235812, // 2019-05-07T15:30:12+02:00
	stop_id: 'museum',
}
const feedMessage0 = {
	header: {
		gtfs_realtime_version: '1.0',
		timestamp: 1557235838, // 2019-05-07T15:30:38+02:00,
		'.nyct_feed_header': {
			nyct_subway_version: '1.0',
			trip_replacement_period: [], // todo
		},
	},
	entity: [
		{
			id: 'one',
			trip_update: tripUpdate1,
		},
		{
			id: 'two',
			vehicle: vehiclePosition1,
		},
	],
}

beforeEach(createTestDbs)
afterEach(purgeTestDbs)

test('importing Schedule feed, matching & serving Realtime feed works', async (t) => {
	const now = 1557235841_000 // 2019-05-07T15:30:41+02:00

	const port = 10_000 + Math.round(Math.random() * 9999)
	const metricsPort = 20_000 + Math.round(Math.random() * 9999)
	const env = {
		PORT: String(port),
		METRICS_SERVER_PORT: String(metricsPort),
		PGDATABASE: SCHEDULE_FEED_BOOKKEEPING_DB_NAME,
		SCHEDULE_FEED_DB_NAME_PREFIX,
		SCHEDULE_FEED_REFRESH_INTERVAL: 6, // seconds
		SCHEDULE_FEED_REFRESH_MIN_INTERVAL: 6, // seconds
		REALTIME_FEED_FETCH_INTERVAL: 1, // seconds
		REALTIME_FEED_FETCH_MIN_INTERVAL: 1, // seconds
	}

	const {
		port: scheduleFeedPort,
		stop: stopServingScheduleFeed,
		setFile: setScheduleFeed,
	} = await serveFile('gtfs.zip')
	const scheduleFeedName = 'nyct_subway' // currently hard-coded by lib/feeds.js
	env.NYCT_SUBWAY_SCHEDULE_FEED_URL = `http://localhost:${scheduleFeedPort}/gtfs.zip`

	const {
		port: realtimeFeedPort,
		stop: stopServingRealtimeFeed,
		setFile: setRealtimeFeed,
	} = await serveFile('gtfs-rt.pb')
	const realtimeFeedName = 'nyct_subway_1234567' // currently hard-coded by lib/feeds.js
	env.NYCT_SUBWAY_1234567_REALTIME_FEED_URL = `http://localhost:${realtimeFeedPort}/gtfs-rt.pb`
	env.NYCT_SUBWAY_ACE_REALTIME_FEED_URL = '-' // disable

	const checkMatchingSuccessesAndFailures = (metrics) => {
		const {
			tripupdates_matching_successes_total,
			tripupdates_matching_failures_total,
			vehiclepositions_matching_successes_total,
			vehiclepositions_matching_failures_total,
		} = metrics
		assertMoreMatchingSuccessesThanFailures(
			'tripupdates_matching_successes_total',
			tripupdates_matching_successes_total,
			'tripupdates_matching_failures_total',
			tripupdates_matching_failures_total,
			({labels: {schedule_feed_digest: sched_digest, route_id}}) => (
				sched_digest === scheduleFeedDigest.slice(0, sched_digest.length)
				&& route_id === tripUpdate1.trip.route_id
			),
		)
		assertMoreMatchingSuccessesThanFailures(
			'vehiclepositions_matching_successes_total',
			vehiclepositions_matching_successes_total,
			'vehiclepositions_matching_failures_total',
			vehiclepositions_matching_failures_total,
			({labels: {schedule_feed_digest: sched_digest, route_id}}) => (
				sched_digest === scheduleFeedDigest.slice(0, sched_digest.length)
				&& route_id === vehiclePosition1.trip.route_id
			),
		)
	}

	setScheduleFeed(FOO_FEED)
	let scheduleFeedDigest = FOO_FEED_DIGEST
	setRealtimeFeed(encodeFeedMessage(feedMessage0))

	// todo: pass in `now`?
	const pServiceProcess = execa(PATH_TO_SERVICE, [], {
		stdio: 'inherit',
		env: {
			...process.env,
			...env,
		},
	})

	const pTest = (async () => {
		// check matching with FOO_FEED
		// todo: get notified about schedule re-import instead of waiting
		await new Promise(r => setTimeout(r, 3_000)) // wait for Schedule feed to be imported
		{
			const {
				header: feedHeader,
				entity: feedEntities,
			} = await fetchAndParseMatchedRealtimeFeed({port, realtimeFeedName, scheduleFeedDigest})
			strictEqual(
				feedEntities[0]?.trip_update?.trip?.trip_id?.slice(0, FOO_TRIP_ID_PREFIX.length),
				FOO_TRIP_ID_PREFIX,
				`TripUpdate's (feedMessage.entity[0].trip_update) trip_id should begin with "${FOO_TRIP_ID_PREFIX}"`,
			)
			strictEqual(
				feedEntities[0]?.trip_update?.stop_time_update?.[0]?.departure?.delay,
				18,
				`StopTimeUpdate's (feedMessage.entity[0].stop_time_update[0]) departure delay must be correct`,
			)
			strictEqual(
				feedEntities[1]?.vehicle?.trip?.trip_id?.slice(0, FOO_TRIP_ID_PREFIX.length),
				FOO_TRIP_ID_PREFIX,
				`VehiclePosition's (feedMessage.entity[1].vehicle) trip_id should begin with "${FOO_TRIP_ID_PREFIX}"`,
			)
			console.info('Realtime feed (feedMessage0) matched against FOO_FEED looks good ✔︎')

			const metrics = await fetchAndParseMetrics({
				port: metricsPort,
			})

			const scheduleFeedImported = metrics.schedule_feed_imported_boolean.data
			.find(({labels: l}) => l.feed_name === scheduleFeedName)
			// imported for the first time
			strictEqual(scheduleFeedImported?.value, 1, 'schedule_feed_imported_boolean should be 1')

			checkMatchingSuccessesAndFailures(metrics)
		}

		// check matching with BAR_FEED
		setScheduleFeed(BAR_FEED)
		scheduleFeedDigest = BAR_FEED_DIGEST
		// todo: trigger & get notified about schedule re-import instead of waiting
		await new Promise(r => setTimeout(r, 6_000 + 3_000)) // wait for Schedule feed to be (re-)imported
		{
			const {
				header: feedHeader,
				entity: feedEntities,
			} = await fetchAndParseMatchedRealtimeFeed({port, realtimeFeedName, scheduleFeedDigest})
			strictEqual(
				feedEntities[0]?.trip_update?.trip?.trip_id?.slice(0, BAR_TRIP_ID_PREFIX.length),
				BAR_TRIP_ID_PREFIX,
				`TripUpdate's (feedMessage.entity[0].trip_update) trip_id should begin with "${BAR_TRIP_ID_PREFIX}"`,
			)
			strictEqual(
				feedEntities[1]?.vehicle?.trip?.trip_id?.slice(0, BAR_TRIP_ID_PREFIX.length),
				BAR_TRIP_ID_PREFIX,
				`VehiclePosition's (feedMessage.entity[1].vehicle) trip_id should begin with "${BAR_TRIP_ID_PREFIX}"`,
			)
			console.info('Realtime feed (feedMessage0) matched against BAR_FEED looks good ✔︎')

			const metrics = await fetchAndParseMetrics({
				port: metricsPort,
			})

			const scheduleFeedImported = metrics.schedule_feed_imported_boolean.data
			.find(({labels: l}) => l.feed_name === scheduleFeedName)
			// imported again because the Schedule feed's digest has changed
			strictEqual(scheduleFeedImported?.value, 1, 'schedule_feed_imported_boolean should be 1')

			checkMatchingSuccessesAndFailures(metrics)
		}

		pServiceProcess.kill()
	})()

	try {
		await Promise.all([
			pServiceProcess.catch((err) => {
				// if the process has been killed deliberately (see below), we silence the error
				if (err.killed) return;
				throw err
			}),
			pTest,
		])
	} finally {
		pServiceProcess.kill()
		await stopServingScheduleFeed()
		await stopServingRealtimeFeed()
	}
})
