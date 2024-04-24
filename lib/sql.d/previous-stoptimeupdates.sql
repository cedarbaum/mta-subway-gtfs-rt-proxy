-- Stores previously seen StopTimeUpdates (STUs), so that they can be queried when a later TripUpdate lacks some of them because they're in the past.
CREATE TABLE previous_stoptimeupdates (
	-- fields to uniquely identify a StopTimeUpdate
	trip_id TEXT NOT NULL,
	start_date TIMESTAMP WITHOUT TIME ZONE NOT NULL,
	stop_id TEXT NOT NULL,
	-- todo: this does not work if a trip visits one stop more than once!
	-- > Either stop_sequence or stop_id must be provided within a StopTimeUpdate - both fields cannot be empty. stop_sequence is required for trips that visit the same stop_id more than once (e.g., a loop) to disambiguate which stop the prediction is for.
	CONSTRAINT previous_stoptimeupdates_unique UNIQUE(trip_id, start_date, stop_id),

	-- timestamp when the STU used to keep the *latest* version of a STU
	"timestamp" INT NOT NULL, -- UNIX timestamp

	-- "payload" fields
	arrival_time INT, -- UNIX timestamp
	arrival_delay INT, -- in seconds
	departure_time INT, -- UNIX timestamp
	departure_delay INT -- in seconds
);

CREATE INDEX previous_stoptimeupdates_lookup ON previous_stoptimeupdates (trip_id, start_date, stop_id);

-- todo: clean up old values!
-- see https://dba.stackexchange.com/a/106836/289704 & https://stackoverflow.com/a/61508930/1072129
