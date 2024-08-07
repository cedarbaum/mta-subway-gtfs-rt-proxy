# MTA GTFS-RT consolidation & normalization service

**An HTTP service that consolidates and normalizes the [MTA (NYCT)](https://en.wikipedia.org/wiki/New_York_City_Transit_Authority) [GTFS-Realtime (GTFS-RT)](https://gtfs.org/realtime/) [feeds](https://api.mta.info/).**


## How it works

### Problems with the MTA feeds

[MTA](https://en.wikipedia.org/wiki/Metropolitan_Transportation_Authority)/[NYCT](https://en.wikipedia.org/wiki/New_York_City_Transit_Authority) offers both a set of [GTFS Schedule](https://gtfs.org/schedule/) [feeds](https://new.mta.info/developers) (that express the lines' schedule as planned in advance) and a set of [GTFS Realtime (GTFS-RT)](https://gtfs.org/realtime) feeds (that each contain all deviations from the respective Schedule feed).

However, they deviate from the spec in two significant ways:
1. The **Realtime feeds do not (re-)use the trip IDs from the Schedule feed** but only the last part of them (or arbitrary ones in some cases). This means that consumers cannot easily determine *which* scheduled trains are canceled, delayed, etc. – The *Matching* section below describes this service's approach to this.
2. The **Realtime feeds use a [proprietary extension](https://web.archive.org/web/20240220224602/https://api.mta.info/GTFS.pdf)** that considers *all* trains within a time frame canceled whose status is not *explicitly* specified otherwise. This means that consumers that do not support this extension will interpret the Realtime feed in a way that is at least very misleading to commuters, not showing these trips as canceled even though effectively they are. – The *Trip replacement periods* section below describes how this service transforms the MTA-proprietary format into a spec-compliant one.

This service fetches the GTFS Realtime feed periodically and processes it as described below in detail, so that **consumers (e.g. [OpenTripPlanner](https://opentripplanner.org)) can process the resulting transformed feed as-is**, without MTA-specific customizations.

### 0. Restoring of past `StopTimeUpdate`s

MTA's GTFS Realtime API omits a `StopTimeUpdate` from a `TripUpdate` as soon as it is in the past (as in: the train/"run" has left the stop). While the specification allows this – it says that "it is possible, although inconsequential, to also provide updates for preceding stops" –, such behavior requires consumers that want to show the entire trip's state to the user to store the latest known realtime data for each `StopTimeUpdate`.

On behalf of the consumers, **this service "restores" previously seen (usually past) `StopTimeUpdate`s** by, whenever the Realtime feed is processed, simultaneously:
- writing all current `StopTimeUpdate`s into a database table, along with the `stop_id` and their `TripUpdate`'s `trip_id` & `start_date`, to be used in a later.
- querying previously stored ("seen") `StopTimeUpdate`s that match the feed (again using `stop_id`, `trip_id` & `start_date`), and adding filling in the `TripUpdate`'s `StopTimeUpdate`s, so that includes even those in the past.

### 1. Matching

While the Realtime feed's `trip_id`s do not match with those in the Schedule feed, together with the `route_id` and `start_date`, we can uniquely identify the train/"run" of the trip in the Schedule data in almost all cases.

Or put in another way: **As soon as `(realtime trip_id, route_id, start_date)` uniquely identifies a train/"run" within the Schedule data, we consider this a "match" and assign the Schedule's `trip_id` to the respective realtime entity**. This process, which we call "matching", is repeated for each realtime entity (`TripUpdate`, `VehiclePosition` or `Alert`) whenever the upstream Realtime feed is fetched from MTA (periodically).

This service first imports it into a [PostgreSQL](https://www.postgresql.org) database using [`postgis-gtfs-importer`](https://github.com/mobidata-bw/postgis-gtfs-importer) and [`gtfs-via-postgres`](https://github.com/public-transport/gtfs-via-postgres), and later queries the database while *matching* the realtime data.

### 2. Trip replacement periods

After the *matching* process (see above), this service also normalizes the Realtime feed's proprietary `TripReplacementPeriod`s by:
1. for each `TripReplacementPeriod`, querying all trains/"runs" within its `[replacement_period.start, replacement_period.end]` time frame;
2. for each train/"run", generating a `TripUpdate` with `trip.schedule_relationship: CANCELED`, except if the train/"run" already has an entity (usually a `TripUpdate`) in the upstream Realtime feed that explicit specifies it's status.

Just like the *matching*, this process – which we call "applying the trip replacement periods" – happens whenever we fetch the upstream Realtime feed.

### Multiple Realtime feeds per Schedule feed

With some MTA/NYCT subsystems, there are multiple Realtime feeds per Schedule Feed; For example, the Subway Schedule feed covers all lines (`A`-`G`, `J`, `L`, `M`, `N`, `Q`, `R`, `W`, `Z`, `1`-`7`, as well as `SIR`), while the Realtime feeds are split into groups (`A`/`C`/`E`, `B`/`D`/`F`/`M`, etc.).

This is why the **processing steps described above happen for *each* Realtime feed**.

> [!NOTE]
> This service currently only handles the `1` Subway Schedule feed (and its corresponding `r` Realtime feeds). It *does not* process MTA's other `s` Schedule feeds (Manhattan buses, Long Island Rail Road, etc.). So there are only `1 * r` instead of `s * r` Realtime/Schedule pairs.
> [PR #1 adds support for >1 Schedule feeds](https://github.com/cedarbaum/mta-subway-gtfs-rt-proxy/pull/1).

### Multiple feed versions

MTA/NYCT publish a new "version" of each Schedule feed from time to time, with a timing that we have no control over.

Because we also *cannot* coordinate when both this service *and its consumers* switch to the latest *version*, **a period of time occurs during which this service still has the previous/old *version* while the consumer already has the latest**, or vice versa. Some consumers might also deploy their systems in a [blue-green fashion](https://en.wikipedia.org/wiki/Blue–green_deployment), in which case they would require *matched* Realtime feeds for >1 Schedule feed *versions* simultaneously.

However, **a Realtime feed is only ever compatible with *one* Schedule feed *version***, because the agency/route/trip IDs need to match. This is why we also **support multiple *versions* of the Schedule feed simultaneously**, allowing each consumer's instance to request the Realtime feed it can process.

With `sv` being the number of imported Schedule feed *versions*, we end up with `1 * sv * r` Realtime feeds. In practice, we keep at most 4 *versions* imported.

By letting consumers send the *digest* (a.k.a. [hash](https://en.wikipedia.org/wiki/Hash_function)) of the Schedule feed *version* they're using (as a query parameter, see the *API* section), we respond to them with the corresponding *matched* Realtime feed. This opens a large period of time where consumers can switch (the) Schedule feed *version(s)* according to their operational requirements.


## Installation

```shell
git clone https://github.com/cedarbaum/mta-subway-gtfs-rt-proxy.git
cd mta-subway-gtfs-rt-proxy
npm install
npm run build
```


## Usage

> [!IMPORTANT]
> By accessing the MTA feeds, you agree to [their terms and conditions](https://new.mta.info/developers/terms-and-conditions).

### database access

Using [`postgis-gtfs-importer`](https://github.com/mobidata-bw/postgis-gtfs-importer), the service imports the GTFS Schedule data into [PostgreSQL](https://www.postgresql.org) databases. Next to a "bookkeeping" database, one database is used for each version of the GTFS Schedule feed.

You can configure database access using the [libpq environment variables](https://www.postgresql.org/docs/14/libpq-envars.html). The PostgreSQL role/user used by the service will need the `CREATEDB` privilege/permission (see [`CREATE ROLE`'s docs](https://www.postgresql.org/docs/14/sql-createrole.html)).

Refer to [`postgis-gtfs-importer`'s docs](https://github.com/mobidata-bw/postgis-gtfs-importer/blob/v4/README.md) for more information.

### running

```shell
./start.js
```

If you want to see the logs in a human-readable format, pipe them through `pino-pretty`:

```shell
./start.js | ./node_modules/.bin/pino-pretty
```

By default, `mta-subway-gtfs-rt-proxy` obtains MTA's Realtime feeds (1/2/3/4/5/6/7 and A/C/E) every 60 seconds and matches them against the Schedule feed. You can customize this behaviour, as well as many others, [using environment variables](docs/config.md).


## Related

- [`nyct_gtfs` Python library](https://github.com/Andrew-Dickinson/nyct-gtfs) – Real-time NYC subway data parsing for humans
