import {fileURLToPath} from 'node:url'
import {readFileSync} from 'node:fs'
import {inspect} from 'node:util'
import {
	createParseAndProcessFeed,
} from '../index.js'

const pathToFeed = (
	process.env.FEED ||
	fileURLToPath(new URL(
		'./mta-nyct-2024-02-28T18:15:26+01:00.gtfs-rt.pbf',
		import.meta.url,
	))
)
console.debug('reading', pathToFeed)

const feedEncoded = readFileSync(pathToFeed)
console.trace('encoded', feedEncoded)

const {
	parseAndProcessFeed,
	closeConnections,
} = await createParseAndProcessFeed()

const feedMessage = await parseAndProcessFeed(feedEncoded)
console.log(inspect(feedMessage, {depth: null, colors: true}))

await new Promise(r => setTimeout(r, 3_000))
await closeConnections()
