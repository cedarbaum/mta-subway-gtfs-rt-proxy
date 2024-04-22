import {Gauge} from 'prom-client'
import computeEtag from 'etag'
import serveBuffer from 'serve-buffer'
import gtfsRtBindings from './mta-gtfs-realtime.pb.js'
import {
	register as metricsRegister,
} from './metrics.js'

const {FeedMessage} = gtfsRtBindings.transit_realtime

const encodeFeedMessage = (feedMessage) => {
	// `Message.verify(message: Object): null|string`
	// verifies that a **plain JavaScript object** satisfies the requirements of a valid message and thus can be encoded without issues. Instead of throwing, it returns the error message as a string, if any.
	// `Message.encode(message: Message|Object [, writer: Writer]): Writer`
	// encodes a **message instance** or valid **plain JavaScript object**. This method does not implicitly verify the message and it's up to the user to make sure that the payload is a valid message.
	const errMsg = FeedMessage.verify(feedMessage)
	if (errMsg) {
		const err = new Error(errMsg)
		err.feedMessage = feedMessage
		throw err
	}
	const feedEncoded = FeedMessage.encode(feedMessage).finish()
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
	let feed = null
	let timeModified = new Date(0)
	let etag = null
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
		if (feed === null) {
			res.writeHead(404, 'feed not initialized yet').end()
			return;
		}
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
	encodeFeedMessage,
	serveFeed,
}