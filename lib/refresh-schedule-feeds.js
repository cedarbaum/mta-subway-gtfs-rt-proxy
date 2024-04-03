// todo: use import assertions once they're supported by Node.js & ESLint
// https://github.com/tc39/proposal-import-assertions
import {createRequire} from 'module';
const require = createRequire(import.meta.url);

import {ok} from 'node:assert'
import {Summary, Gauge} from 'prom-client'
import sortBy from 'lodash/sortBy.js';
import {createLogger} from './logger.js'
import {importGtfsAtomically} from './postgis-gtfs-importer/import.js'
import {
	register as metricsRegister,
} from './metrics.js'
const pkg = require('../package.json')

const IMPORTER_LOG_LEVEL = process.env.LOG_LEVEL_POSTGIS_GTFS_IMPORTER || 'warn'
const SCHEDULE_DATA_LOG_LEVEL = process.env.LOG_LEVEL_SCHEDULE_DATA || 'info'

const NYCT_SUBWAY_FEED_NAME = 'nyct_subway'
const NYCT_SUBWAY_SCHEDULE_FEED_URL = (
	process.env.NYCT_SUBWAY_NYCT_SUBWAY_SCHEDULE_FEED_URL ||
	'http://web.mta.info/developers/data/nyct/subway/google_transit.zip'
)

const FETCH_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes
const FETCH_INTERVAL_MIN_MS = 5 * 60 * 1000 // 5 minutes

// Whenever a new GTFS Schedule dataset is imported, we only keep the most recent `MAX_SCHEDULE_DBS`. This is a trade-off between being able to serve OTP requests for older datasets (see readme.md) and disk storage.
const MAX_SCHEDULE_DBS = 4

// postgis-gtfs-importer passes the databases to us sorted alphabetically (ascending). Because their naming scheme is `$databaseNamePrefix_$timestamp_$scheduleFeedDigest`, we could just pick the last `MAX_SCHEDULE_DBS` items, but we sort numerically by `importedAt` to be on the safe side.
// Because `oldDbs` does not include the new database to be created, we only keep `MAX_SCHEDULE_DBS - 1`. In case no new database is created (because the feed's digest hasn't changed), we end up with one DB less.
const determineDbsToRetain = oldDbs => sortBy(oldDbs, ['importedAt']).slice(-(MAX_SCHEDULE_DBS - 1))

const _importerLogger = createLogger('postgis-gtfs-importer', IMPORTER_LOG_LEVEL)
const fetchAndImportScheduleFeed = async (cfg) => {
	const {
		feedName,
		gtfsDownloadUrl,
		fetchDurationSeconds,
		dataImported,
		importDurationSeconds,
	} = cfg
	const databaseNamePrefix = `gtfs_${feedName}_`

	const res = await importGtfsAtomically({
		logger: _importerLogger,
		databaseNamePrefix,
		gtfsDownloadUrl,
		gtfsDownloadUserAgent: pkg.name,
		gtfstidyBeforeImport: false,
		determineDbsToRetain,
	})
	const {
		downloadDurationMs,
		importSkipped,
		importDurationMs,
	} = res

	fetchDurationSeconds.observe({feed_name: feedName}, downloadDurationMs / 1000)
	dataImported.set({feed_name: feedName}, importSkipped ? 1 : 0)
	importDurationSeconds.observe({feed_name: feedName}, importDurationMs / 1000)

	return res
}

const _scheduleLogger = createLogger('schedule-data', SCHEDULE_DATA_LOG_LEVEL)
const startRefreshingNyctSubwayScheduleFeed = (cfg) => {
	const logger = _scheduleLogger

	const fetchDurationSeconds = new Summary({
		name: 'schedule_feed_fetch_duration_seconds',
		help: 'time needed to fetch the GTFS Schedule feed',
		registers: [metricsRegister],
		labelNames: ['feed_name'],
	})
	const dataImported = new Gauge({
		name: 'schedule_feed_imported_boolean',
		help: 'during the last fetch/import cycle, if the feed has changed and thus been imported',
		registers: [metricsRegister],
		labelNames: ['feed_name'],
	})
	const importDurationSeconds = new Summary({
		name: 'schedule_feed_import_duration_seconds',
		help: 'time needed to import the GTFS Schedule feed',
		registers: [metricsRegister],
		labelNames: ['feed_name'],
	})

	let keepRefreshing = true
	let waitTimer = null
	;(async () => {
		// If an import crashes the process, the latter will be restarted by the environment (e.g. Kubernetes) and attempt another import *right away*.
		// todo: use a proper task scheduler with a back-off logic, e.g. Kubernetes CronJob [1]
		// [1] https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/
		while (keepRefreshing) {
			const t0 = performance.now()
			await fetchAndImportScheduleFeed({
				feedName: NYCT_SUBWAY_FEED_NAME,
				gtfsDownloadUrl: NYCT_SUBWAY_SCHEDULE_FEED_URL,
				fetchDurationSeconds,
				dataImported,
				importDurationSeconds,
			})
			const timePassedMs = performance.now() - t0

			// wait so that we pull every `FETCH_INTERVAL_MS`, but at least `FETCH_INTERVAL_MIN_MS`
			const _waitMs = Math.max(FETCH_INTERVAL_MS - timePassedMs, FETCH_INTERVAL_MIN_MS)
			await new Promise((resolve) => {
				waitTimer = setTimeout(resolve, _waitMs)
			})
		}
	})()
	.catch((err) => {
		logger.error({
			error: err,
		}, 'failed to refresh the NYCT Subway GTFS Schedule feed')
		throw err
	})

	const stopRefreshing = () => {
		keepRefreshing = false
		if (waitTimer !== null) {
			clearTimeout(waitTimer)
		}
	}

	return {
		stopRefreshing,
	}
}

export {
	startRefreshingNyctSubwayScheduleFeed,
}
