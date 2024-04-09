const NYCT_SUBWAY_FEED_NAME = 'nyct_subway'
const NYCT_SUBWAY_SCHEDULE_FEED_URL = (
	process.env.NYCT_SUBWAY_SCHEDULE_FEED_URL ||
	'http://web.mta.info/developers/data/nyct/subway/google_transit.zip'
)

const NYCT_SUBWAY_1234567_REALTIME_FEED_URL = (
	process.env.NYCT_SUBWAY_1234567_REALTIME_FEED_URL ||
	'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs'
)
const NYCT_SUBWAY_ACE_REALTIME_FEED_URL = (
	process.env.NYCT_SUBWAY_ACE_REALTIME_FEED_URL ||
	'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace'
)

const NYCT_SUBWAY_FEED = {
	scheduleFeedName: NYCT_SUBWAY_FEED_NAME,
	scheduleFeedUrl: NYCT_SUBWAY_SCHEDULE_FEED_URL,
	realtimeFeeds: [
		{
			realtimeFeedName: 'nyct_subway_1234567',
			realtimeFeedUrl: NYCT_SUBWAY_1234567_REALTIME_FEED_URL,
		},
		{
			realtimeFeedName: 'nyct_subway_ace',
			realtimeFeedUrl: NYCT_SUBWAY_ACE_REALTIME_FEED_URL,
		},
		// todo: add the missing ones
	],
}

const ALL_FEEDS = [
	NYCT_SUBWAY_FEED,
	// todo: bus, etc.
]

export {
	NYCT_SUBWAY_FEED,
	ALL_FEEDS,
}
