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

const FETCH_INTERVAL_MS = 60 * 1000 // 1 minute
const FETCH_INTERVAL_MIN_MS = 30 * 1000 // 30 seconds

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
	} = cfg
	ok(realtimeFeedName, 'missing/empty cfg.realtimeFeedName')
	ok(realtimeFeedUrl, 'missing/empty cfg.realtimeFeedUrl')

	const logCtx = {
		realtimeFeedName,
	}

	const events = new EventEmitter()

	const abortController = new AbortController()
	const {signal} = abortController

	const fetchRealtimeFeed = async () => {
		logger.trace(logCtx, 'fetching GTFS Realtime feed')

		const t0 = performance.now()
		const res = await ky(realtimeFeedUrl, {
			signal,
			redirect: 'follow',
			headers: {
				'user-agent': USER_AGENT,
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

		logger.debug({
			...logCtx,
			fetchDurationMs,
		}, 'done fetching GTFS Realtime feed')
		// todo: add more metrics, e.g. nr of requests, status codes, retries – use ky's opt.hooks?
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
			const {
				fetchDurationMs,
			} = await fetchRealtimeFeed()

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
		}, 'failed to fetch GTFS Realtime feed')
		events.emit('error', err)
	})

	const abortFetching = () => {
		abortController.abort()
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