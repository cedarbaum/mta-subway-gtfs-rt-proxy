import {ok} from 'node:assert'
import {createServer as createHttpServer} from 'node:http'
import {createMetricsServer} from './lib/metrics.js'
import {createLogger} from './lib/logger.js'
import {startFetchingRealtimeFeed} from './lib/fetch-realtime-feed.js'
import {createParseAndProcessFeed} from './lib/match.js'
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
	await metricsServer.start()

	const logger = createLogger('service', SERVICE_LOG_LEVEL)

	// todo: DRY with lib/refresh-schedule-feeds.js
	// todo: support >1 schedule feeds
	const scheduleFeedName = 'nyct_subway'
	const realtimeFeeds = [
		{
			realtimeFeedName: 'nyct_subway_1234567',
			realtimeFeedUrl: 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs',
		},
		{
			realtimeFeedName: 'nyct_subway_ace',
			realtimeFeedUrl: 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace',
		},
		// todo: define more
	]

	const logCtx = {
		scheduleFeedName,
	}

	// ## fetch of GTFS Realtime feeds
	// Each realtime feed neeeds only one fetcher, regardless of how many schedule feeds it is matched against.

	// realtimeFeedName -> {stopFetching, events}
	const realtimeFetchersByName = new Map()

	for (const {realtimeFeedName, realtimeFeedUrl} of realtimeFeeds) {
		logger.debug(logCtx, `setting up realtime feed fetcher for "${realtimeFeedName}"`)

		const {
			stopFetching,
			events,
		} = startFetchingRealtimeFeed({
			realtimeFeedName,
			realtimeFeedUrl,
		})

		realtimeFetchersByName.set(realtimeFeedName, {
			stopFetching,
			events,
		})
	}

	// ## configure matching & serving of fetched realtime feeds
	
	// todo: refresh GTFS Schedule feed, handle >1 versions
	const scheduleDatabaseName = 'some_db' // todo: pick up from schedule import
	const scheduleFeedDigest = 'abc123' // todo: pick up from schedule import

	// todo: after process start it is empty, figure out a solution
	const feedHandlers = new Map() // realtimeFeedName -> {serveFeed, stop}

	{
		// Note: Prometheus stores time series per combination of label values, so having labels with a high or even unbound cardinality is a problem. We still want to be able to tell the schedule databases' metrics apart in the monitoring system, so we add the first hex digit (with a cardinality of 16) of the GTFS Schedule feed's hash as a label.
		// see also https://www.robustperception.io/cardinality-is-key/
		const scheduleFeedDigestSlice = scheduleFeedDigest.slice(0, 1)

		const {
			parseAndProcessFeed: parseAndMatchRealtimeFeed,
		} = createParseAndProcessFeed({
			// todo: pass realtimeFeedName through into metrics?
			scheduleDatabaseName,
			scheduleFeedDigest,
			scheduleFeedDigestSlice,
		})

		const createFeedHandler = (realtimeFeedName) => {
			const _logCtx = {
				...logCtx,
				realtimeFeedName,
			}
			logger.debug(_logCtx, 'setting up feed handler')

			const {
				setFeed: setFeedMessage,
				onRequest: serveFeedOnRequest,
			} = serveFeed({
				scheduleFeedDigest, scheduleFeedDigestSlice,
			})

			const processRealtimeFeed = ({feedEncoded}) => {
				// todo: trace-log

				(async () => {
					const feedMessage = await parseAndMatchRealtimeFeed(feedEncoded)
					setFeedMessage(feedMessage)
				})()
				.catch((err) => {
					logger.warn({
						..._logCtx,
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

		for (const {realtimeFeedName} of realtimeFeeds) {
			const feedHandler = createFeedHandler(realtimeFeedName)
			feedHandlers.set(realtimeFeedName, feedHandler)
		}
	}

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
			const _scheduleFeedDigest = url.searchParams.get('schedule-feed-digest')
			if (_scheduleFeedDigest !== scheduleFeedDigest) { // todo
				res.statusCode = 404
				res.end('invalid/unknown schedule-feed-digest')
				return;
			}

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
}

export {
	createService,
}
