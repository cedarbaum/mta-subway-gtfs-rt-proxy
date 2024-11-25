import {ok} from 'node:assert'
import {createServer as createHttpServer} from 'node:http'
import {createMetricsServer} from './lib/metrics.js'
import {createLogger} from './lib/logger.js'
import {ALL_FEEDS} from './lib/feeds.js'
import {startFetchingRealtimeFeed} from './lib/fetch-realtime-feed.js'
import {createParseAndProcessFeed} from './lib/match.js'
import {
	queryImportedScheduleFeedVersions,
	startRefreshingScheduleFeed,
} from './lib/refresh-schedule-feeds.js'
import {serveFeed} from './lib/serve-gtfs-rt.js'

const SERVICE_LOG_LEVEL = process.env.LOG_LEVEL_SERVICE || 'info'

const createService = async (opt = {}) => {
	const {
		port,
	} = {
		port: parseInt(process.env.PORT || '3000'),
		...opt,
	}

	const metricsServer = createMetricsServer()

	const logger = createLogger('service', SERVICE_LOG_LEVEL)

	// todo: iterate over all schedule feeds
	const [scheduleFeed] = ALL_FEEDS
	const {
		scheduleFeedName,
		scheduleFeedUrl,
		realtimeFeeds,
	} = scheduleFeed

	const logCtx = {
		scheduleFeedName,
	}

	// ## fetch of GTFS Realtime feeds
	// Each realtime feed neeeds only one fetcher, regardless of how many schedule feeds it is matched against.

	// realtimeFeedName -> {abortFetching, events}
	const realtimeFetchersByName = new Map()

	for (const realtimeFeed of realtimeFeeds) {
		const {
			realtimeFeedName,
			realtimeFeedUrl,
			realtimeFeedApiKey,
		} = realtimeFeed
		logger.debug(logCtx, `setting up realtime feed fetcher for "${realtimeFeedName}"`)

		const {
			abortFetching,
			events,
		} = startFetchingRealtimeFeed({
			realtimeFeedName,
			realtimeFeedUrl,
			realtimeFeedApiKey,
		})

		realtimeFetchersByName.set(realtimeFeedName, {
			abortFetching,
			events,
		})
	}

	// ## configure matching & serving of fetched realtime feeds
	// We set up a nested Map structure below to accomodate the following business logic:
	// - Each schedule feed has a constantly changing set of versions, each "schedule feed version" identified by its digest (and its database name, which includes the feed digest).
	// - We match each of the schedule feed's `r` associated realtime feeds against each of the its `v` versions, so we end up with `r * v` "feed handlers".
	// - Each "feed handler" consists of two functions `matchAndEncodeFeed` & `serveFeed`.

	// todo: after process start it is empty, figure out a solution
	// scheduleFeedDigest -> {
	// 	feedHandlers: realtimeFeedName -> {serveFeed, stop},
	// 	closeConnections,
	// }
	const feedHandlersByScheduleFeedDigest = new Map()

	const addScheduleFeedVersion = async (scheduleFeedDigest, scheduleDatabaseName) => {
		const _logCtx = {
			...logCtx,
			scheduleFeedDigest,
			scheduleDatabaseName,
		}
		logger.info(_logCtx, `creating new matcher for schedule database "${scheduleDatabaseName}"`)

		// Note: Prometheus stores time series per combination of label values, so having labels with a high or even unbound cardinality is a problem. We still want to be able to tell the schedule databases' metrics apart in the monitoring system, so we add the first hex digit (with a cardinality of 16) of the GTFS Schedule feed's hash as a label.
		// see also https://www.robustperception.io/cardinality-is-key/
		const scheduleFeedDigestSlice = scheduleFeedDigest.slice(0, 1)

		const {
			parseAndProcessFeed: parseAndMatchRealtimeFeed,
			closeConnections,
		} = await createParseAndProcessFeed({
			// todo: pass realtimeFeedName through into metrics?
			scheduleDatabaseName,
			scheduleFeedDigest,
			scheduleFeedDigestSlice,
		})

		const createFeedHandler = (realtimeFeedName) => {
			const __logCtx = {
				..._logCtx,
				realtimeFeedName,
			}
			logger.debug(__logCtx, 'setting up feed handler')

			const {
				setFeed: setFeedMessage,
				onRequest: serveFeedOnRequest,
			} = serveFeed({
				scheduleFeedDigest, scheduleFeedDigestSlice,
			})

			const processRealtimeFeed = ({feedEncoded}) => {
				logger.trace({
					...__logCtx,
					feedEncoded,
				}, 'processing realtime feed')

				;(async () => {
					// todo: pass in `realtimeFeedName` for logging
					const feedMessage = await parseAndMatchRealtimeFeed(feedEncoded)
					setFeedMessage(feedMessage)
				})()
				.catch((err) => {
					// todo: only warn-log for certain errors, otherwise error-log
					logger.warn({
						...__logCtx,
						error: err,
					}, 'failed to process realtime feed update')
				})
				// todo: add metrics for success/fail
			}

			// connect with realtime fetcher
			ok(realtimeFetchersByName.has(realtimeFeedName), realtimeFeedName)
			const {
				events: realtimeFeedEvents,
			} = realtimeFetchersByName.get(realtimeFeedName)
			realtimeFeedEvents.on('update', processRealtimeFeed)
			const stopListeningToRealtimeFeedUpdates = () => {
				realtimeFeedEvents.removeListener('update', processRealtimeFeed)
			}

			return {
				serveFeed: serveFeedOnRequest,
				stop: stopListeningToRealtimeFeedUpdates,
			}
		}

		const feedHandlers = new Map()
		for (const {realtimeFeedName} of realtimeFeeds) {
			const feedHandler = createFeedHandler(realtimeFeedName)
			feedHandlers.set(realtimeFeedName, feedHandler)
		}

		feedHandlersByScheduleFeedDigest.set(scheduleFeedDigest, {
			feedHandlers,
			closeConnections,
		})
	}

	// todo: isn't this function called only after the database has been (attempted to get) removed? why close client connections then? solving this properly probably needs a rework of postgis-gtfs-importer.
	const removeScheduleFeedVersion = (scheduleFeedDigest) => {
		logger.info(logCtx, `removing obsolete matcher for digest "${scheduleFeedDigest}"`)

		const {
			feedHandlers,
			closeConnections,
		} = feedHandlersByScheduleFeedDigest.get(scheduleFeedDigest)

		for (const feedHandler of feedHandlers.values()) {
			feedHandler.stop()
		}

		closeConnections()
		.catch((err) => {
			logger.warn(logCtx, `failed to closeConnections obsolete matcher for digest "${scheduleFeedDigest}": ${err.message}`)
			logger.debug(err)
		})

		feedHandlersByScheduleFeedDigest.delete(scheduleFeedDigest)
	}

	// ## refreshing of GTFS Schedule feeds

	let currentDatabases = []
	{
		currentDatabases = await queryImportedScheduleFeedVersions({
			scheduleFeedName,
		})
		// todo: do this in parallel?
		for (const {name, feedDigest} of currentDatabases) {
			logger.trace(logCtx, `adding handlers for already imported schedule feed version with digest "${feedDigest}"`)
			await addScheduleFeedVersion(feedDigest, name)
		}
	}

	startRefreshingScheduleFeed({
		scheduleFeedName,
		scheduleFeedUrl,
		onImportDone: ({currentDatabases: _currentDatabases}) => {
			currentDatabases = _currentDatabases
			logger.trace(logCtx, 'currently imported databases: ' + currentDatabases.map(db => db.name).join(', '))

			for (const oldScheduleFeedDigest of feedHandlersByScheduleFeedDigest.keys()) {
				if (!currentDatabases.find(({feedDigest}) => feedDigest === oldScheduleFeedDigest)) {
					logger.trace(logCtx, `removing handlers for obsolete schedule feed version with digest "${oldScheduleFeedDigest}"`)
					removeScheduleFeedVersion(oldScheduleFeedDigest)
				}
			}

			for (const newScheduleFeedVersion of currentDatabases) {
				const {
					name: scheduleDatabaseName,
					feedDigest: scheduleFeedDigest,
				} = newScheduleFeedVersion
				if (!feedHandlersByScheduleFeedDigest.has(scheduleFeedDigest)) {
					logger.trace(logCtx, `adding handlers for new schedule feed version with digest "${scheduleFeedDigest}"`)
					addScheduleFeedVersion(scheduleFeedDigest, scheduleDatabaseName)
				}
			}
		},
	})

	// ## serve matched realtime feeds via HTTP

	// modeled after https://github.com/derhuerst/hafas-gtfs-rt-feed/blob/8.2.3/lib/serve.js#L156-L217
	const onRequest = (req, res) => {
		logger.trace({
			httpVersion: req.httpVersion,
			method: req.method,
			url: req.url,
			headers: req.headers,
		}, 'handling incoming HTTP request')
		const url = new URL(req.url, 'http://localhost')
		const pathComponents = url.pathname === '/' ? [] : url.pathname.slice(1).split('/')

		// /feeds
		if (pathComponents[0] === 'feeds' && pathComponents.length === 1) {
			const body = currentDatabases.flatMap((scheduleFeedDb) => {
				const {
					feedDigest: scheduleFeedDigest,
				} = scheduleFeedDb
				if (!feedHandlersByScheduleFeedDigest.has(scheduleFeedDigest)) {
					return []
				}
				const realtimeFeedNames = Array.from(feedHandlersByScheduleFeedDigest.get(scheduleFeedDigest).feedHandlers.keys())
				return realtimeFeedNames.map((realtimeFeedName) => ({
					// todo [breaking]: remove, the schedule feed DB's name is not helpful
					name: scheduleFeedDb.name,
					realtimeFeedName,
					// todo [breaking]: rename to scheduleFeedDigest
					feedDigest: scheduleFeedDigest,
				}))
			})
			res.setHeader('content-type', 'application/json')
			res.end(JSON.stringify(body))
			return;
		}

		// /feeds/:realtimeFeedName?schedule-feed-digest
		// todo: use express for routing?
		if (pathComponents[0] === 'feeds' && pathComponents.length === 2) {
			const realtimeFeedName = pathComponents[1]
			if (!realtimeFetchersByName.has(realtimeFeedName)) {
				res.statusCode = 404
				res.end('invalid realtime feed name')
				return;
			}

			if (!url.searchParams.has('schedule-feed-digest')) {
				res.statusCode = 400
				res.end('missing schedule-feed-digest parameter')
				return;
			}
			const scheduleFeedDigest = url.searchParams.get('schedule-feed-digest')
			if (!feedHandlersByScheduleFeedDigest.has(scheduleFeedDigest)) {
				res.statusCode = 404
				res.end('invalid/unknown schedule-feed-digest')
				return;
			}

			const {
				feedHandlers,
			} = feedHandlersByScheduleFeedDigest.get(scheduleFeedDigest)
			const {
				serveFeed,
			} = feedHandlers.get(realtimeFeedName)
			serveFeed(req, res)
			return;
		}

		// todo: add health check endpoint
		res.statusCode = 404
		res.end('not found')
	}

	// todo: enable CORS?
	const server = createHttpServer(onRequest)
	await new Promise((resolve, reject) => {
		server.listen(port, (err) => {
			if (err) reject(err)
			else resolve()
		})
	})
	logger.info(`listening on port ${server.address().port}`)

	await metricsServer.start()
	logger.info(`metrics server listening on port ${metricsServer.address().port}`)

	const stopService = async () => {
		// todo: info-log
		for (const {abortFetching} of realtimeFetchersByName.values()) {
			await abortFetching()
		}
		for (const {closeConnections} of feedHandlersByScheduleFeedDigest.values()) {
			await closeConnections()
		}
		server.close()
	}

	return {
		stopService,
	}
}

export {
	createService,
}
