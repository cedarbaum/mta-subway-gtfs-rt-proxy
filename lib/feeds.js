const MTA_API_ACCESS_KEY = process.env.MTA_API_ACCESS_KEY || null
// todo: MTA BusTime API key

// Note: We use the "supplemented" instead of the "regular" GTFS feed.
// > Every day, the feed will contain a seven-day lookahead, so in principle a developer can download that and use it for the next seven days, then refresh the feed to get the next seven days – but we recommend updating more frequently (ideally daily) to get the latest updates and have valid data for the next seven days.
// – https://groups.google.com/g/mtadeveloperresources/c/14d8DV4hnj4/m/vSpVGSgdAwAJ
// > Outside of the seven-day window, the new supplemented feed will contain the same information as the existing static GTFS feed.
// – https://groups.google.com/g/mtadeveloperresources/c/14d8DV4hnj4/m/cL0njuZdAwAJ
const NYCT_SUBWAY_FEED_NAME = 'nyct_subway'
const NYCT_SUBWAY_SCHEDULE_FEED_URL = (
	process.env.NYCT_SUBWAY_SCHEDULE_FEED_URL ||
	'http://web.mta.info/developers/files/google_transit_supplemented.zip'
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
