// todo: use import assertions once they're supported by Node.js & ESLint
// https://github.com/tc39/proposal-import-assertions
import {createRequire} from 'module';
const require = createRequire(import.meta.url);

import {ok} from 'node:assert'
import {Summary, Gauge} from 'prom-client'
import sortBy from 'lodash/sortBy.js';
import {createLogger} from './logger.js'
import {getPgOpts} from './db.js'
import {readImportedDatabases} from '../postgis-gtfs-importer/index.js'
import {importGtfsAtomically} from '../postgis-gtfs-importer/import.js'
import {
	register as metricsRegister,
} from './metrics.js'
const pkg = require('../package.json')

import {dirname} from 'node:path'
// todo: use import.meta.resolve once it is stable?
// see https://nodejs.org/docs/latest-v20.x/api/esm.html#importmetaresolvespecifier
const PREVIOUS_STOPTIMEUPDATES_POSTPROCESSING_D_PATH = require.resolve('./postprocessing.d/previous-stoptimeupdates.sql')
const POSTPROCESSING_D_PATH = dirname(PREVIOUS_STOPTIMEUPDATES_POSTPROCESSING_D_PATH)

const IMPORTER_LOG_LEVEL = process.env.LOG_LEVEL_POSTGIS_GTFS_IMPORTER || 'warn'
const SCHEDULE_DATA_LOG_LEVEL = process.env.LOG_LEVEL_SCHEDULE_DATA || 'info'

const DB_NAME_PREFIX = process.env.SCHEDULE_FEED_DB_NAME_PREFIX || 'gtfs_'

const FETCH_INTERVAL_MS = process.env.SCHEDULE_FEED_REFRESH_INTERVAL
	? parseInt(process.env.SCHEDULE_FEED_REFRESH_INTERVAL) * 1000
	: 30 * 60 * 1000 // 30 minutes
const FETCH_INTERVAL_MIN_MS = process.env.SCHEDULE_FEED_REFRESH_MIN_INTERVAL
	? parseInt(process.env.SCHEDULE_FEED_REFRESH_MIN_INTERVAL) * 1000
	: 5 * 60 * 1000 // 5 minutes

// Whenever a new GTFS Schedule dataset is imported, we only keep the most recent `MAX_SCHEDULE_DBS`. This is a trade-off between being able to serve OTP requests for older datasets (see readme.md) and disk storage.
const MAX_SCHEDULE_DBS = 4

// postgis-gtfs-importer passes the databases to us sorted alphabetically (ascending). Because their naming scheme is `$databaseNamePrefix_$timestamp_$scheduleFeedDigest`, we could just pick the last `MAX_SCHEDULE_DBS` items, but we sort numerically by `importedAt` to be on the safe side.
// Because `oldDbs` does not include the new database to be created, we only keep `MAX_SCHEDULE_DBS - 1`. In case no new database is created (because the feed's digest hasn't changed), we end up with one DB less.
const determineDbsToRetain = oldDbs => sortBy(oldDbs, ['importedAt']).slice(-(MAX_SCHEDULE_DBS - 1))

const noOfImportedScheduleFeeds = new Gauge({
	name: 'imported_schedule_feeds_count',
	help: 'number of currently imported GTFS-Schedule feeds',
	registers: [metricsRegister],
})

const queryImportedScheduleFeedVersions = async (cfg) => {
	const {
		scheduleFeedName,
	} = cfg
	ok(scheduleFeedName, 'scheduleFeedName')

	const databaseNamePrefix = `${DB_NAME_PREFIX}${scheduleFeedName}_`
	const {
		oldDbs: currentDatabases,
	} = await readImportedDatabases({
		databaseNamePrefix,
		pgOpts: getPgOpts(),
	})
	noOfImportedScheduleFeeds.set(currentDatabases.length)

	return currentDatabases
}

const _importerLogger = createLogger('postgis-gtfs-importer', IMPORTER_LOG_LEVEL)
const fetchAndImportScheduleFeed = async (cfg) => {
	const {
		feedName,
		gtfsDownloadUrl,
		fetchDurationSeconds,
		dataImported,
		importDurationSeconds,
	} = cfg
	const databaseNamePrefix = `${DB_NAME_PREFIX}${feedName}_`

	const verboseLogging = _importerLogger.isLevelEnabled('trace')

	const res = await importGtfsAtomically({
		logger: _importerLogger,
		downloadScriptVerbose: verboseLogging,
		connectDownloadScriptToStdout: verboseLogging,
		importScriptVerbose: verboseLogging,
		connectImportScriptToStdout: verboseLogging,
		pgOpts: getPgOpts(),
		databaseNamePrefix,
		gtfsDownloadUrl,
		gtfsDownloadUserAgent: `${pkg.name} v${pkg.version}`, // todo: allow customising via env var
		gtfstidyBeforeImport: false,
		determineDbsToRetain,
		gtfsPostprocessingDPath: POSTPROCESSING_D_PATH,
	})
	const {
		downloadDurationMs,
		importSkipped,
		importDurationMs,
	} = res

	fetchDurationSeconds.observe({feed_name: feedName}, downloadDurationMs / 1000)
	dataImported.set({feed_name: feedName}, importSkipped ? 0 : 1)
	importDurationSeconds.observe({feed_name: feedName}, importDurationMs / 1000)

	return res
}

const fetchDurationSeconds = new Summary({
	name: 'schedule_feed_fetch_duration_seconds',
	help: 'time needed to fetch the GTFS Schedule feed',
	registers: [metricsRegister],
	labelNames: ['feed_name'],
})
// todo [breaking]: change to timestamp, rename to `schedule_feed_imported_timestamp_seconds`
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

const _scheduleLogger = createLogger('schedule-data', SCHEDULE_DATA_LOG_LEVEL)
const startRefreshingScheduleFeed = (cfg) => {
	const {
		scheduleFeedName,
		scheduleFeedUrl,
		onImportDone,
	} = cfg
	ok(scheduleFeedName, 'scheduleFeedName')
	ok(scheduleFeedUrl, 'scheduleFeedUrl')
	ok(onImportDone, 'onImportDone')

	const logger = _scheduleLogger
	const logCtx = {
		scheduleFeedName,
	}

	let keepRefreshing = true
	let waitTimer = null
	;(async () => {
		// If an import crashes the process, the latter will be restarted by the environment (e.g. Kubernetes) and attempt another import *right away*.
		// todo: use a proper task scheduler with a back-off logic, e.g. Kubernetes CronJob [1]
		// [1] https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/
		while (keepRefreshing) {
			logger.trace(logCtx, 'refreshing imported schedule feeds')
			const t0 = performance.now()
			// todo: catch and log failures
			// todo: expose res.downloadDurationMs as metric?
			// todo: expose res.importSkipped as metric?
			// todo: expose res.importDurationMs as metric?
			const {
				retainedDatabases,
				database,
			} = await fetchAndImportScheduleFeed({
				feedName: scheduleFeedName,
				gtfsDownloadUrl: scheduleFeedUrl,
				fetchDurationSeconds,
				dataImported,
				importDurationSeconds,
			})
			const timePassedMs = performance.now() - t0

			const currentDatabases = [
				...retainedDatabases,
				...(database ? [database] : []),
			]
			noOfImportedScheduleFeeds.set(currentDatabases.length)
			logger.debug({
				...logCtx,
				timePassedMs,
			}, 'refreshed imported schedule feeds')

			onImportDone({
				currentDatabases,
			})

			// wait so that we pull every `FETCH_INTERVAL_MS`, but at least `FETCH_INTERVAL_MIN_MS`
			const _waitMs = Math.max(FETCH_INTERVAL_MS - timePassedMs, FETCH_INTERVAL_MIN_MS)
			await new Promise((resolve) => {
				waitTimer = setTimeout(resolve, _waitMs)
			})
		}
	})()
	.catch((err) => {
		logger.error({
			error: {
				message: err.message,
				...err,
			},
		}, `failed to refresh the "${scheduleFeedName}" GTFS Schedule feed`)
		// throw err
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
	queryImportedScheduleFeedVersions,
	startRefreshingScheduleFeed,
}
