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

const stopMatching = async () => {
	await db.end()
	metricsServer.close()
}

export {
	matchTripUpdate,
	matchVehiclePosition,
	matchAlert,
	stopMatching, // todo: design a better API
}
