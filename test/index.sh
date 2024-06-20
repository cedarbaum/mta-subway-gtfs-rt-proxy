#!/bin/bash

set -euo pipefail
cd "$(dirname "$(realpath "$0")")"

postgis_gtfs_importer_bin="$(realpath ../postgis-gtfs-importer/node_modules/.bin)"
# make postgis-gtfs-importer's CLI dependencies callable, notably gtfs-via-postgres' gtfs-to-sql
export PATH="$postgis_gtfs_importer_bin:$PATH"

set -x

env | grep '^PG' || true

source 01-match-prepare.sh 'test_mta_2024_03_18'
env PGDATABASE=test_mta_2024_03_18 \
	node --test 01-match.js
psql -c 'DROP DATABASE "test_mta_2024_03_18"'

source 03-match-prepare.sh 'test_sample_gtfs_feed'
env PGDATABASE=test_sample_gtfs_feed TRIP_ID_SUFFIX_SEPARATOR='-' \
	node --test --test-only 03-match.js
psql -c 'DROP DATABASE "test_sample_gtfs_feed"'

# todo: rename to `10-service-end-to-end`?
source 02-service-prepare.sh
node --test 02-service.js
