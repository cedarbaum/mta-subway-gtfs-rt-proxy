const MTA_API_ACCESS_KEY = process.env.MTA_API_ACCESS_KEY || null
// todo: MTA BusTime API key

const NYCT_SUBWAY_FEED_NAME = 'nyct_subway'
const NYCT_SUBWAY_SCHEDULE_FEED_URL = (
	process.env.NYCT_SUBWAY_SCHEDULE_FEED_URL ||
	'http://web.mta.info/developers/data/nyct/subway/google_transit.zip'
)

let NYCT_SUBWAY_1234567_REALTIME_FEED_URL = (
	process.env.NYCT_SUBWAY_1234567_REALTIME_FEED_URL ||
	'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs'
)
if (NYCT_SUBWAY_1234567_REALTIME_FEED_URL === '-') {
	NYCT_SUBWAY_1234567_REALTIME_FEED_URL = null
}
let NYCT_SUBWAY_ACE_REALTIME_FEED_URL = (
	process.env.NYCT_SUBWAY_ACE_REALTIME_FEED_URL ||
	'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace'
)
if (NYCT_SUBWAY_ACE_REALTIME_FEED_URL === '-') {
	NYCT_SUBWAY_ACE_REALTIME_FEED_URL = null
}

const NYCT_SUBWAY_FEED = {
	scheduleFeedName: NYCT_SUBWAY_FEED_NAME,
	scheduleFeedUrl: NYCT_SUBWAY_SCHEDULE_FEED_URL,
	realtimeFeeds: [
		{
			realtimeFeedName: 'nyct_subway_1234567',
			realtimeFeedUrl: NYCT_SUBWAY_1234567_REALTIME_FEED_URL,
			realtimeFeedApiKey: MTA_API_ACCESS_KEY,
		},
		{
			realtimeFeedName: 'nyct_subway_ace',
			realtimeFeedUrl: NYCT_SUBWAY_ACE_REALTIME_FEED_URL,
			realtimeFeedApiKey: MTA_API_ACCESS_KEY,
		},
		// todo: add the missing ones
	].filter(({realtimeFeedUrl}) => realtimeFeedUrl !== null),
}

const ALL_FEEDS = [
	NYCT_SUBWAY_FEED,
	// todo: bus, etc.
]

export {
	NYCT_SUBWAY_FEED,
	ALL_FEEDS,
}
