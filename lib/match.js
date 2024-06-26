import {ok, strictEqual} from 'node:assert'
import {Summary} from 'prom-client'
import gtfsRtBindings from './mta-gtfs-realtime.pb.js'
import {connectToPostgres} from './db.js'
import {createLogger} from './logger.js'
import {
	register as metricsRegister,
} from './metrics.js'
import {createMatchTripUpdate} from './match-trip-update.js'
import {createMatchVehiclePosition} from './match-vehicle-position.js'
import {createMatchAlert} from './match-alert.js'
import {createStoreAndRestoreStopTimeUpdatesFromDb} from './restore-stoptimeupdates.js'
import {createApplyTripReplacementPeriods} from './apply-trip-replacement-periods.js'

const MATCHING_LOG_LEVEL = process.env.LOG_LEVEL_MATCHING || 'warn'

const parseEncodedFeed = (feedEncoded) => {
	// decode feed, validate NyctFeedHeader
	const feedMessage = gtfsRtBindings.transit_realtime.FeedMessage.decode(feedEncoded)

	const nyctFeedHeader = feedMessage.header['.nyct_feed_header']
	if (nyctFeedHeader) {
		ok(nyctFeedHeader, 'missing FeedMessage.header[".nyct_feed_header"]')

		const nyctSubwayVersion = nyctFeedHeader.nyct_subway_version
		strictEqual(nyctSubwayVersion, '1.0', 'unsupported NyctFeedHeader.nyct_subway_version')
	}

	return feedMessage
}

const _matchingTimeSeconds = new Summary({
	name: 'feedmessage_matching_time_seconds',
	help: 'time needed to match an entire FeedMessage with the GTFS Schedule data',
	registers: [metricsRegister],
	labelNames: [
		'schedule_feed_digest',
	],
})

const createParseAndProcessFeed = (cfg) => {
	const {
		scheduleDatabaseName,
		scheduleFeedDigest, scheduleFeedDigestSlice,
		// todo: expect realtimeFeedName, pass through to matching fns
	} = cfg
	ok(scheduleDatabaseName, 'scheduleDatabaseName must not be empty')
	ok(scheduleFeedDigest, 'scheduleFeedDigest must not be empty')
	ok(scheduleFeedDigestSlice, 'scheduleFeedDigestSlice must not be empty')
	const db = connectToPostgres({
		database: scheduleDatabaseName,
	})

	const {matchTripUpdate} = createMatchTripUpdate({
		scheduleFeedDigest, scheduleFeedDigestSlice,
		db,
		logger: createLogger('match-trip-update', MATCHING_LOG_LEVEL),
		metricsRegister,
	})
	const {matchVehiclePosition} = createMatchVehiclePosition({
		scheduleFeedDigest, scheduleFeedDigestSlice,
		db,
		logger: createLogger('match-vehicle-position', MATCHING_LOG_LEVEL),
		metricsRegister,
	})
	const {matchAlert} = createMatchAlert({
		scheduleFeedDigest, scheduleFeedDigestSlice,
		db,
		logger: createLogger('match-alert', MATCHING_LOG_LEVEL),
		metricsRegister,
	})

	const _logger = createLogger('match-feed-message', MATCHING_LOG_LEVEL)
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
			scheduleFeedDigest,
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
		_matchingTimeSeconds.observe({
			'schedule_feed_digest': scheduleFeedDigestSlice,
		}, matchingTime)
		_logger.debug({
			...logCtx,
			matchingTime,
		}, 'matched FeedMessage')
	}

	const {
		storeStopTimeUpdatesInDb,
		restoreStopTimeUpdatesFromDb,
		storeAndRestoreStopTimeUpdatesFromDb,
		startCleaningOldStoredStopTimeUpdates,
	} = createStoreAndRestoreStopTimeUpdatesFromDb({
		scheduleFeedDigest, scheduleFeedDigestSlice,
		db,
		logger: createLogger('store-stoptimeupdates', MATCHING_LOG_LEVEL),
		metricsRegister,
	})

	const applyTripReplacementPeriods = createApplyTripReplacementPeriods({
		scheduleFeedDigest, scheduleFeedDigestSlice,
		db,
		logger: createLogger('trip-replacement-periods', MATCHING_LOG_LEVEL),
		metricsRegister,
	})

	const parseAndProcessFeed = async (feedBuf) => {
		const feedMessage = parseEncodedFeed(feedBuf)

		await storeAndRestoreStopTimeUpdatesFromDb(feedMessage)
		await matchFeedMessage(feedMessage)
		await applyTripReplacementPeriods(feedMessage)

		return feedMessage
	}

	// todo: allow disabling this
	const stopCleaningOldStopTimeUpdatesTimer = startCleaningOldStoredStopTimeUpdates()

	const stop = async () => {
		await db.end()
		stopCleaningOldStopTimeUpdatesTimer()
	}

	return {
		parseAndProcessFeed,
		stop,
		matchTripUpdate,
		matchVehiclePosition,
		matchAlert,
		matchFeedMessage,
		storeStopTimeUpdatesInDb,
		restoreStopTimeUpdatesFromDb,
		storeAndRestoreStopTimeUpdatesFromDb,
		applyTripReplacementPeriods,
		startCleaningOldStoredStopTimeUpdates,
	}
}

export {
	parseEncodedFeed,
	createParseAndProcessFeed,
}
