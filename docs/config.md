# Configuring the MTA GTFS-RT normalization service

environment variable | default | unit | description
-|-|-|-
`$PORT` | `3000`| | Which port to serve the API on.
`$METRICS_SERVER_PORT` | *any available high-numbered port* | Which port to serve the Prometheus metrics on.
`$LOG_LEVEL_SERVICE` | `info`| | How many general logs to print.

## Schedule feed imports

environment variable | default | unit | description
-|-|-|-
`$LOG_LEVEL_SCHEDULE_DATA` | `info`| | How many logs to print regarding Schedule data imports.
`$LOG_LEVEL_POSTGIS_GTFS_IMPORTER` | `warn`| | How many logs to let `postgis-gtfs-importer` print, which are quite verbose.
`$SCHEDULE_FEED_REFRESH_INTERVAL` | `30 * 60 * 1000`| ms | How often to check if MTA's Schedule feed has changed, minus the duration it took last time to check.
`$SCHEDULE_FEED_REFRESH_MIN_INTERVAL` | `5 * 60 * 1000`| ms | Minimum time to wait between attempts to check if MTA's Schedule feed has changed. Effectively a lower bound for `$SCHEDULE_FEED_REFRESH_INTERVAL`.
`$GTFS_TMP_DIR` | `/tmp/gtfs`| | Where to cache MTA's Schedule feed. Note that this directory *does not* get cleared automatically!
`$SCHEDULE_FEED_DB_NAME_PREFIX` | `gtfs_`| | Prefix to add to the PostgreSQL database name(s) when importing the Schedule feed (versions). Note that databases with this prefix may get deleted automatically! See also `postgis-gtfs-importer`'s docs for details.

### database access

Access to the PostgreSQL database(s) can be configured using the [libpq environment variables](https://www.postgresql.org/docs/14/libpq-envars.html).

In addition, the `$PG_POOL_SIZE` environment variable determines how many simultaneous connections to the database will be kept open in the connection pool.


## Realtime feed processing

environment variable | default | unit | description
-|-|-|-
`$LOG_LEVEL_REALTIME_FETCHING` | `info`| | How many logs to print regarding Realtime data fetching.
`$REALTIME_FEED_FETCH_INTERVAL` | `60 * 1000`| ms | How often to fetch MTA's Realtime feeds, minus the duration it took last time.
`$REALTIME_FEED_FETCH_MIN_INTERVAL` | `30 * 1000`| ms | Minimum time to wait between fetches of each MTA Realtime feed. Effectively a lower bound for `$REALTIME_FEED_REFRESH_INTERVAL`.
`$REALTIME_FETCHING_USER_AGENT` | `mta-subway-gtfs-rt-proxy v${version}` | | [HTTP `User-Agent`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/User-Agent#specifications) to use while fetching the Realtime feeds from MTA.
`$MTA_API_ACCESS_KEY` | *none* | | API key to use when fetching the Realtime feeds from MTA's API.
`$LOG_LEVEL_MATCHING` | `warn`| | How many logs to print regarding the matching of Realtime data against Schedule data.
`$MATCH_CONCURRENCY` | `os.cpus().length * 2`| | The number of `FeedEntity`s to match concurrently. Note that this limit is applied *per Realtime feed*. Also note that the matching throughput is also limited by `$PG_POOL_SIZE` as well as the PostgreSQL server's number of CPU cores.

## `StopTimeUpdate`s storing & restoring

environment variable | default | unit | description
-|-|-|-
`$STOP_TIME_UPDATES_MAX_AGE_SECONDS` | `3 * 60 * 60`| s | | How long to store previous `StopTimeUpdate`s in the database for.
`$STOP_TIME_UPDATES_CLEAN_INTERVAL_SECONDS` | `60 * 60`| s | | How often to purge old `StopTimeUpdate`s from the database.
