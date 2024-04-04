import {Gauge} from 'prom-client'
import computeEtag from 'etag'
import serveBuffer from 'serve-buffer'
import gtfsRtBindings from './mta-gtfs-realtime.pb.js'
import {
	register as metricsRegister,
} from './metrics.js'

const encodeFeedMessage = (feedMessage) => {
	const feedEncoded = gtfsRtBindings.transit_realtime.FeedMessage.decode(feedMessage)
	return feedEncoded
}

const encodedFeedSizeBytes = new Gauge({
	name: 'encoded_feed_size_bytes',
	help: 'size of the Protocol-Buffers-encoded GTFS-Realtime feed',
	registers: [metricsRegister],
	labelNames: [
		'schedule_feed_digest',
	],
})

const serveFeed = (cfg) => {
	const {
		scheduleFeedDigestSlice,
	} = cfg

	// modeled after https://github.com/derhuerst/hafas-gtfs-rt-feed/blob/8.2.3/lib/serve.js#L144-L152
	let feed = Buffer.alloc(0)
	let timeModified = new Date(0)
	let etag = computeEtag(feed)
	const setFeed = (feedMessage) => {
		// todo: debug-log
		feed = encodeFeedMessage(feedMessage)
		timeModified = new Date()
		encodedFeedSizeBytes.set({
			schedule_feed_digest: scheduleFeedDigestSlice,
		}, feed.length)
		etag = computeEtag(feed)
	}

	// modeled after https://github.com/derhuerst/hafas-gtfs-rt-feed/blob/8.2.3/lib/serve.js#L172-L177
	const onRequest = (req, res) => {
		serveBuffer(req, res, feed, {
			timeModified,
			etag,
			// serve-buffer readme:
			// > If you *never mutate* the buffer(s) that you pass into `serveBuffer`, you can tell it to *cache* each buffer's compressed version as long as the instance exists […].
			unmutatedBuffers: true,
		})
	}

	return {
		setFeed,
		onRequest,
	}
}

export {
	serveFeed,
}