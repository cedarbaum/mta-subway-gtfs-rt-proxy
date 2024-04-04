import {createServer as createHttpServer} from 'node:http'
import {createLogger} from './logger.js'
import {
	parseEncodedFeed,
	createParseAndProcessFeed,
} from './lib/match.js'
import {
	startRefreshingNyctSubwayScheduleFeed,
} from './lib/refresh-schedule-feeds.js'
import {serveFeed} from './lib/serve-gtfs-rt.js'

const SERVICE_LOG_LEVEL = process.env.LOG_LEVEL_SERVICE || 'info'

const createService = (opt = {}) => {
	const {
		port,
	} = {
		port: parseInt(process.env.PORT || '3000'),
		...opt,
	}

	const logger = createLogger('service', SERVICE_LOG_LEVEL)

	// todo: fetch feed, match feed

	const {
		setFeed,
		serveFeedOnRequest,
	} = serveFeed()

	// modeled after https://github.com/derhuerst/hafas-gtfs-rt-feed/blob/8.2.3/lib/serve.js#L156-L217
	const onRequest = (req, res) => {
		logger.trace({
			httpVersion: req.httpVersion,
			method: req.method,
			url: req.url,
			headers: req.headers,
		}, 'processing HTTP request')

		const path = new URL(req.url, 'http://localhost').pathname
		if (path === '/feed') {
			serveFeedOnRequest(req, res)
		} else {
			// todo: add health check endpoint
			res.statusCode = 404
			res.end('not found')
		}
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
