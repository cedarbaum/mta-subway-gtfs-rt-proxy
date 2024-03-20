import pino from 'pino'

const DEFAULT_LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase()

const createLogger = (name, level = DEFAULT_LOG_LEVEL) => {
	return pino({
		name,
		level,
		base: {pid: process.pid},
	})
}

export {
	createLogger,
}
