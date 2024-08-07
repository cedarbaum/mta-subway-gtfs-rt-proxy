// todo: use import assertions once they're supported by Node.js & ESLint
// https://github.com/tc39/proposal-import-assertions
import {createRequire} from 'module';
const require = createRequire(import.meta.url);

import {Summary} from 'prom-client'
import {ok} from 'node:assert'
import {EventEmitter} from 'node:events';
import ky from 'ky'
import {createLogger} from './logger.js'
import {register as metricsRegister} from './metrics.js'
const pkg = require('../package.json')

const REALTIME_FETCHING_LOG_LEVEL = process.env.LOG_LEVEL_REALTIME_FETCHING || 'info'

const USER_AGENT = process.env.REALTIME_FETCHING_USER_AGENT || `${pkg.name} v${pkg.version}`

// todo [breaking]: rename to `REALTIME_FEED_FETCH_INTERVAL_MS`
const FETCH_INTERVAL_MS = process.env.REALTIME_FEED_FETCH_INTERVAL
	? parseInt(process.env.REALTIME_FEED_FETCH_INTERVAL) * 1000
	: 60 * 1000 // 1 minute
// todo [breaking]: rename to `REALTIME_FEED_FETCH_MIN_INTERVAL_MS`
const FETCH_INTERVAL_MIN_MS = process.env.REALTIME_FEED_FETCH_MIN_INTERVAL
	? parseInt(process.env.REALTIME_FEED_FETCH_MIN_INTERVAL) * 1000
	: 30 * 1000 // 30 seconds

const logger = createLogger('realtime-data', REALTIME_FETCHING_LOG_LEVEL)

const fetchDurationSeconds = new Summary({
	name: 'realtime_feed_fetch_duration_seconds',
	help: 'time needed to fetch the GTFS Realtime feed',
	registers: [metricsRegister],
	labelNames: ['feed_name'],
})

// todo: change to return an async iterable/iterator?
const startFetchingRealtimeFeed = (cfg) => {
	const {
		realtimeFeedName,
		realtimeFeedUrl,
		realtimeFeedApiKey,
	} = cfg
	ok(realtimeFeedName, 'missing/empty cfg.realtimeFeedName')
	ok(realtimeFeedUrl, 'missing/empty cfg.realtimeFeedUrl')
	ok(realtimeFeedApiKey || realtimeFeedApiKey === null, 'invalid cfg.realtimeFeedApiKey')

	const logCtx = {
		realtimeFeedName,
	}

	const events = new EventEmitter()

	const fetchRealtimeFeed = async () => {
		logger.trace(logCtx, 'fetching GTFS Realtime feed')

		const abortController = new AbortController()
		const {signal} = abortController
		events.on('abort', abortController.abort)

		const t0 = performance.now()
		const res = await ky(realtimeFeedUrl, {
			signal,
			redirect: 'follow',
			headers: {
				'user-agent': USER_AGENT,
				...(realtimeFeedApiKey ? {
					'x-api-key': realtimeFeedApiKey,
				} : {}),
				// todo: accept header
				// todo: caching headers
			},
			retry: {
				limit: 3,
			},
			// todo: keepalive
		})
		const feedEncoded = Buffer.from(await res.arrayBuffer())
		const fetchDurationMs = performance.now() - t0

		events.removeListener('abort', abortController.abort)

		logger.debug({
			...logCtx,
			fetchDurationMs,
		}, 'done fetching GTFS Realtime feed')
		// todo: add more metrics, e.g. no. of requests, status codes, retries – use ky's opt.hooks?
		fetchDurationSeconds.observe({feed_name: realtimeFeedName}, fetchDurationMs / 1000)

		// todo: expose last-modified header, fall back to Date.now()
		events.emit('update', {feedEncoded})

		return {
			fetchDurationMs,
		}
	}

	let keepFetching = true
	let waitTimer = null
	;(async () => {
		// If an import crashes the process, the latter will be restarted by the environment (e.g. Kubernetes) and attempt another import *right away*.
		// todo: use a proper task scheduler with a back-off logic, e.g. Kubernetes CronJob [1]
		// [1] https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/
		while (keepFetching) {
			let fetchDurationMs = 0
			try {
				const {
					fetchDurationMs: _fetchDurationMs,
				} = await fetchRealtimeFeed()
				fetchDurationMs = _fetchDurationMs
			} catch (err) {
				logger.warn({
					...logCtx,
					error: err,
				}, 'failed to fetch GTFS Realtime feed')
				events.emit('error', err)
			}

			// wait so that we pull every `FETCH_INTERVAL_MS`, but at least `FETCH_INTERVAL_MIN_MS`
			const _waitMs = Math.max(FETCH_INTERVAL_MS - fetchDurationMs, FETCH_INTERVAL_MIN_MS)
			await new Promise((resolve) => {
				waitTimer = setTimeout(resolve, _waitMs)
			})
		}
	})()
	.catch((err) => {
		logger.error({
			...logCtx,
			error: err,
		}, 'an unknown error occured GTFS Realtime feed fetching loop!')
	})

	const abortFetching = () => {
		events.emit('abort')
		keepFetching = false
		if (waitTimer !== null) {
			clearTimeout(waitTimer)
		}
	}

	return {
		events,
		abortFetching,
	}
}

export {
	startFetchingRealtimeFeed,
}
