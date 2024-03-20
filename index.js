import {connectToPostgres} from './lib/db.js'
import {createLogger} from './lib/logger.js'
import {
	register as metricsRegister,
	createMetricsServer,
} from './lib/metrics.js'
import {createMatchTripUpdate} from './lib/match-trip-update.js'

// todo: get ride of this untestable singleton
const db = await connectToPostgres()

const metricsServer = createMetricsServer()
await metricsServer.start()

const {matchTripUpdate} = createMatchTripUpdate({
	db,
	logger: createLogger('match-trip-update', process.env.LOG_LEVEL_MATCHING || 'error'),
	metricsRegister,
})

const stopMatching = async () => {
	await db.end()
	metricsServer.close()
}

export {
	matchTripUpdate,
	stopMatching, // todo: design a better API
}
