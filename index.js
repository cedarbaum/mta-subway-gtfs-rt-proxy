import {connectToPostgres} from './lib/db.js'
import {createLogger} from './lib/logger.js'
import {
	register as metricsRegister,
	createMetricsServer,
} from './lib/metrics.js'
import {createMatchTripUpdate} from './lib/match-trip-update.js'
import {createMatchVehiclePosition} from './lib/match-vehicle-position.js'
import {createMatchAlert} from './lib/match-alert.js'

const MATCHING_LOG_LEVEL = process.env.LOG_LEVEL_MATCHING || 'error'

// todo: get ride of this untestable singleton
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
const matchFeedMessage = async (feedMessage) => {
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
			await matchTripUpdate(feedEntity.trip_update)
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

const stopMatching = async () => {
	await db.end()
	metricsServer.close()
}

export {
	matchTripUpdate,
	matchVehiclePosition,
	matchAlert,
	matchFeedMessage,
	applyTripReplacementPeriods,
	stopMatching, // todo: design a better API
}
