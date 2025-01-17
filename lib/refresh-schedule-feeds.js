// todo: use import assertions once they're supported by Node.js & ESLint
// https://github.com/tc39/proposal-import-assertions
import {createRequire} from 'module';
const require = createRequire(import.meta.url);

import {ok} from 'node:assert'
import {Summary, Gauge} from 'prom-client'
import {createLogger} from './logger.js'
import {getPgOpts} from './db.js'
import {queryImports} from '../postgis-gtfs-importer/index.js'
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

// postgis-gtfs-importer passes the databases to us sorted descending by date+time of import.
// Because the new database to be created is not included yet, we only keep `MAX_SCHEDULE_DBS - 1`. In case no new database is created (because the feed's digest hasn't changed), we end up with one DB less. Similarly, if the import fails, we end up with a DB more which is not usable.
const determineDbsToRetain = (latestSuccessfulImports, allDbs) => {
	return latestSuccessfulImports.slice(0, MAX_SCHEDULE_DBS - 1).map(_import => _import.dbName)
}

const noOfImportedScheduleFeeds = new Gauge({
	name: 'imported_schedule_feeds_total',
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
		latestSuccessfulImports,
	} = await queryImports({
		databaseNamePrefix,
		pgOpts: getPgOpts(),
	})
	const currentDatabases = latestSuccessfulImports.map(_import => ({
		name: _import.dbName,
		importedAt: _import.importedAt,
		feedDigest: _import.feedDigest,
	}))
	noOfImportedScheduleFeeds.set(currentDatabases.length)

	return currentDatabases
}

const _importerLogger = createLogger('postgis-gtfs-importer', IMPORTER_LOG_LEVEL)
const fetchAndImportScheduleFeed = async (cfg) => {
	const {
		feedName,
		gtfsDownloadUrl,
		fetchDurationSeconds,
		importAttemptedTimestampSeconds,
		importedTimestampSeconds,
		importDurationSeconds,
	} = cfg
	const databaseNamePrefix = `${DB_NAME_PREFIX}${feedName}_`

	const verboseLogging = _importerLogger.isLevelEnabled('trace')

	const tImportStarted = Date.now()
	importAttemptedTimestampSeconds.set({feed_name: feedName}, Math.round(tImportStarted / 1000))

	const res = await importGtfsAtomically({
		logger: _importerLogger,
		downloadScriptVerbose: verboseLogging,
		connectDownloadScriptToStdout: verboseLogging,
		importScriptVerbose: verboseLogging,
		connectImportScriptToStdout: verboseLogging,
		pgOpts: getPgOpts(),
		databaseNamePrefix,
		gtfsDownloadUrl,
		gtfsDownloadUserAgent: process.env.SCHEDULE_FETCHING_USER_AGENT || `${pkg.name} v${pkg.version}`, // todo: allow customising via env var, or pick up k8s pod name?
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
	if (!importSkipped) {
		importedTimestampSeconds.set({feed_name: feedName}, Math.round(tImportStarted / 1000))
	}
	importDurationSeconds.observe({feed_name: feedName}, importDurationMs / 1000)

	return res
}

const fetchDurationSeconds = new Summary({
	name: 'schedule_feed_fetch_duration_seconds',
	help: 'time needed to fetch the GTFS Schedule feed',
	registers: [metricsRegister],
	labelNames: ['feed_name'],
})
const importAttemptedTimestampSeconds = new Gauge({
	name: 'schedule_feed_import_attempted_timestamp_seconds',
	help: 'when a new Schedule feed (version) has last been *attempted* to be imported, regardless of the result',
	registers: [metricsRegister],
	labelNames: ['feed_name'],
})
const importedTimestampSeconds = new Gauge({
	name: 'schedule_feed_imported_timestamp_seconds',
	help: 'when a new Schedule feed (version) has last been imported successfully',
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
	// Environments like Kubernetes deploy a new version of a service as a new instance next to the old instance, and only kill the old one once the new now is ready.
	// Even though it would make sense to only report as ready once we have imported the Schedule data (or made sure it's up-to-date) at least once,
	// 1. this makes the new instance take a long time to become ready, which in turn means that
	// 2. the old instance to become unhealthy because it can't import new Schedule feed versions (because only one instance can import at a time and the new instance is already importing), which
	// 3. causes Kubernetes to consider both instances not ready/unhealthy and eventually kill both of them,
	// 4. leading to and endless loop of unavailable instances.
	// This is why we sacrifice the reliability and observability of checking for the first Schedule import here.
	// let isReady = false
	let isReady = true
	let isHealthy = true
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
			await fetchAndImportScheduleFeed({
				feedName: scheduleFeedName,
				gtfsDownloadUrl: scheduleFeedUrl,
				fetchDurationSeconds,
				importAttemptedTimestampSeconds,
				importedTimestampSeconds,
				importDurationSeconds,
			})
			const timePassedMs = performance.now() - t0

			const currentDatabases = await queryImportedScheduleFeedVersions({
				scheduleFeedName,
			})
			logger.debug({
				...logCtx,
				timePassedMs,
				currentDatabases,
			}, 'refreshed imported schedule feeds')

			isHealthy = true
			isReady = true
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
		isHealthy = false
		logger.error({
			error: err,
		}, `failed to refresh the "${scheduleFeedName}" GTFS Schedule feed`)
		// throw err
	})

	const stopRefreshing = () => {
		keepRefreshing = false
		if (waitTimer !== null) {
			clearTimeout(waitTimer)
		}
	}

	const checkIfHealthy = async () => {
		if (isHealthy) {
			logger.trace('service seems healthy')
		} else {
			logger.warn(`service doesn't seem healthy`)
		}
		return isHealthy
	}
	const checkIfReady = async () => {
		if (isReady) {
			logger.trace('service seems ready')
		} else {
			logger.debug(`service doesn't seem ready (yet?)`)
		}
		return isReady
	}

	return {
		stopRefreshing,
		checkIfHealthy,
		checkIfReady,
	}
}

export {
	queryImportedScheduleFeedVersions,
	startRefreshingScheduleFeed,
}
