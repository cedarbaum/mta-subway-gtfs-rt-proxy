import {ok, strictEqual} from 'node:assert'
import {Summary} from 'prom-client'
import gtfsRtBindings from './mta-gtfs-realtime.pb.js'
import {connectToPostgres} from './db.js'
import {createLogger} from './logger.js'
import {
	register as metricsRegister,
	createMetricsServer,
} from './metrics.js'
import {createMatchTripUpdate} from './match-trip-update.js'
import {createMatchVehiclePosition} from './match-vehicle-position.js'
import {createMatchAlert} from './match-alert.js'
import {createApplyTripReplacementPeriods} from './apply-trip-replacement-periods.js'

const MATCHING_LOG_LEVEL = process.env.LOG_LEVEL_MATCHING || 'error'

const parseEncodedFeed = (feedEncoded) => {
	// decode feed, validate NyctFeedHeader
	const feedMessage = gtfsRtBindings.transit_realtime.FeedMessage.decode(feedEncoded)
	// console.trace('decoded FeedHeader', feedMessage.header)

	const nyctFeedHeader = feedMessage.header['.nyct_feed_header']
	if (nyctFeedHeader) {
		ok(nyctFeedHeader, 'missing FeedMessage.header[".nyct_feed_header"]')

		const nyctSubwayVersion = nyctFeedHeader.nyct_subway_version
		strictEqual(nyctSubwayVersion, '1.0', 'unsupported NyctFeedHeader.nyct_subway_version')
	}

	return feedMessage
}

const createParseAndProcessFeed = async () => {
	const db = await connectToPostgres()

	const metricsServer = createMetricsServer()
	await metricsServer.start()

	const {matchTripUpdate} = createMatchTripUpdate({
		db,
		logger: createLogger('match-trip-update', MATCHING_LOG_LEVEL),
		metricsRegister,
	})
	const {matchVehiclePosition} = createMatchVehiclePosition({
		db,
		logger: createLogger('match-vehicle-position', MATCHING_LOG_LEVEL),
		metricsRegister,
	})
	const {matchAlert} = createMatchAlert({
		db,
		logger: createLogger('match-alert', MATCHING_LOG_LEVEL),
		metricsRegister,
	})

	const _logger = createLogger('match-feed-message', MATCHING_LOG_LEVEL)
	const _matchingTimeSeconds = new Summary({
		name: 'feedmessage_matching_time_seconds',
		help: 'time needed to match an entire FeedMessage with the GTFS Schedule data',
		registers: [metricsRegister],
		labelNames: [],
	})
	const matchFeedMessage = async (feedMessage, opt = {}) => {
		const {
			now,
		} = {
			now: Date.now(),
			...opt,
		}

		const {
			header: feedHeader,
		} = feedMessage
		const logCtx = {
			feedHeader,
		}

		const t0 = performance.now()
		// todo: match feed entities in parallel?
		for (let feedEntitiesIdx = 0; feedEntitiesIdx < feedMessage.entity.length; feedEntitiesIdx++) {
			const feedEntity = feedMessage.entity[feedEntitiesIdx]
			const _logCtx = {
				...logCtx,
				feedEntityId: feedEntity.id,
			}
			_logger.trace({
				..._logCtx,
				feedEntitiesIdx,
				feedEntity,
			}, 'matching FeedEntity')

			if (feedEntity.trip_update) {
				await matchTripUpdate(feedEntity.trip_update, {now})
			}
			if (feedEntity.vehicle) {
				await matchVehiclePosition(feedEntity.vehicle)
			}
			if (feedEntity.alert) {
				await matchAlert(feedEntity.alert)
			}
		}
		const matchingTime = (performance.now() - t0) / 1000
		_matchingTimeSeconds.observe(matchingTime)
		_logger.debug({
			...logCtx,
			matchingTime,
		}, 'matched FeedMessage')
	}

	const applyTripReplacementPeriods = createApplyTripReplacementPeriods({
		db,
		logger: createLogger('trip-replacement-periods', MATCHING_LOG_LEVEL),
		metricsRegister,
	})

	const parseAndProcessFeed = async (feedBuf) => {
		const feedMessage = parseEncodedFeed(feedBuf)

		await matchFeedMessage(feedMessage)
		await applyTripReplacementPeriods(feedMessage)

		return feedMessage
	}

	const closeConnections = async () => {
		await db.end()
		metricsServer.close()
	}

	return {
		parseAndProcessFeed,
		closeConnections,
		matchTripUpdate,
		matchVehiclePosition,
		matchAlert,
		matchFeedMessage,
		applyTripReplacementPeriods,
	}
}

export {
	parseEncodedFeed,
	createParseAndProcessFeed,
}
