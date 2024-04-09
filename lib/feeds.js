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
const NYCT_SUBWAY_BDFM_REALTIME_FEED_URL = (
	process.env.NYCT_SUBWAY_BDFM_REALTIME_FEED_URL ||
	'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm'
)
const NYCT_SUBWAY_G_REALTIME_FEED_URL = (
	process.env.NYCT_SUBWAY_G_REALTIME_FEED_URL ||
	'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g'
)
const NYCT_SUBWAY_JZ_REALTIME_FEED_URL = (
	process.env.NYCT_SUBWAY_JZ_REALTIME_FEED_URL ||
	'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-jz'
)
const NYCT_SUBWAY_NQRW_REALTIME_FEED_URL = (
	process.env.NYCT_SUBWAY_NQRW_REALTIME_FEED_URL ||
	'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw'
)
const NYCT_SUBWAY_L_REALTIME_FEED_URL = (
	process.env.NYCT_SUBWAY_L_REALTIME_FEED_URL ||
	'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l'
)
const NYCT_SUBWAY_SIR_REALTIME_FEED_URL = (
	process.env.NYCT_SUBWAY_SIR_REALTIME_FEED_URL ||
	'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-si'
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
		// {
		// 	realtimeFeedName: 'nyct_subway_bdfm',
		// 	realtimeFeedUrl: NYCT_SUBWAY_BDFM_REALTIME_FEED_URL,
		// },
		// {
		// 	realtimeFeedName: 'nyct_subway_g',
		// 	realtimeFeedUrl: NYCT_SUBWAY_G_REALTIME_FEED_URL,
		// },
		// {
		// 	realtimeFeedName: 'nyct_subway_jz',
		// 	realtimeFeedUrl: NYCT_SUBWAY_JZ_REALTIME_FEED_URL,
		// },
		// {
		// 	realtimeFeedName: 'nyct_subway_nqrw',
		// 	realtimeFeedUrl: NYCT_SUBWAY_NQRW_REALTIME_FEED_URL,
		// },
		// {
		// 	realtimeFeedName: 'nyct_subway_l',
		// 	realtimeFeedUrl: NYCT_SUBWAY_L_REALTIME_FEED_URL,
		// },
		// {
		// 	realtimeFeedName: 'nyct_subway_sir',
		// 	realtimeFeedUrl: NYCT_SUBWAY_SIR_REALTIME_FEED_URL,
		// },
	],
}

const MTA_LIRR_FEED_NAME = 'mta_lirr'
const MTA_LIRR_SCHEDULE_FEED_URL = (
	process.env.MTA_LIRR_SCHEDULE_FEED_URL ||
	'https://rrgtfsfeeds.s3.amazonaws.com/google_transit.zip'
)

const MTA_LIRR_REALTIME_FEED_URL = (
	process.env.MTA_LIRR_REALTIME_FEED_URL ||
	'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/lirr%2Fgtfs-lirr'
)

const MTA_LIRR_FEED = {
	scheduleFeedName: MTA_LIRR_FEED_NAME,
	scheduleFeedUrl: MTA_LIRR_SCHEDULE_FEED_URL,
	realtimeFeeds: [
		{
			realtimeFeedName: 'mta_lirr_rt',
			realtimeFeedUrl: MTA_LIRR_REALTIME_FEED_URL,
		},
	],
}

const MTA_MNR_FEED_NAME = 'mta_mnr'
const MTA_MNR_SCHEDULE_FEED_URL = (
	process.env.MTA_MNR_SCHEDULE_FEED_URL ||
	'http://web.mta.info/developers/data/mnr/google_transit.zip'
)

const MTA_MNR_REALTIME_FEED_URL = (
	process.env.MTA_MNR_REALTIME_FEED_URL ||
	'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/mnr%2Fgtfs-mnr'
)

const MTA_MNR_FEED = {
	scheduleFeedName: MTA_MNR_FEED_NAME,
	scheduleFeedUrl: MTA_MNR_SCHEDULE_FEED_URL,
	realtimeFeeds: [
		{
			realtimeFeedName: 'mta_mnr_rt',
			realtimeFeedUrl: MTA_MNR_REALTIME_FEED_URL,
		},
	],
}

const MTA_RBO_BRONX_FEED_NAME = 'mta_rbo_bronx'
const MTA_RBO_BRONX_SCHEDULE_FEED_URL = (
	process.env.MTA_RBO_BRONX_SCHEDULE_FEED_URL ||
	'http://web.mta.info/developers/data/nyct/bus/google_transit_bronx.zip'
)

const MTA_RBO_BRONX_REALTIME_FEED_URL = (
	process.env.MTA_RBO_BRONX_REALTIME_FEED_URL ||
	'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fbus-alerts'
)

const MTA_RBO_BRONX_FEED = {
	scheduleFeedName: MTA_RBO_BRONX_FEED_NAME,
	scheduleFeedUrl: MTA_RBO_BRONX_SCHEDULE_FEED_URL,
	realtimeFeeds: [
		{
			realtimeFeedName: 'mta_rbo_bronx_rt',
			realtimeFeedUrl: MTA_RBO_BRONX_REALTIME_FEED_URL,
		},
	],
}

const ALL_FEEDS = [
	NYCT_SUBWAY_FEED,
	MTA_LIRR_FEED,
	MTA_MNR_FEED,
	MTA_RBO_BRONX_FEED,
	// todo: buses brooklyn
	// todo: buses manhattan
	// todo: buses queens
	// todo: buses staten island
	// todo: buses bus company
]

export {
	NYCT_SUBWAY_FEED,
	MTA_LIRR_FEED,
	MTA_MNR_FEED,
	MTA_RBO_BRONX_FEED,
	ALL_FEEDS,
}
