#!/bin/bash

set -euo pipefail
cd "$(dirname "$(realpath "$0")")"

postgis_gtfs_importer_bin="$(realpath ../postgis-gtfs-importer/node_modules/.bin)"
# make postgis-gtfs-importer's CLI dependencies callable, notably gtfs-via-postgres' gtfs-to-sql
export PATH="$postgis_gtfs_importer_bin:$PATH"

set -x

env | grep '^PG' || true
psql -c 'CREATE DATABASE mta_2024_03_18'
export PGDATABASE=mta_2024_03_18

mkdir -p mta-2024-03-18.gtfs
cd mta-2024-03-18.gtfs
tar -xk -f ../mta-2024-03-18.gtfs.tar.lzma
cd -

NODE_ENV=production gtfs-to-sql \
	-d --trips-without-shape-id --routes-without-agency-id -- \
	mta-2024-03-18.gtfs/*.txt \
	| sponge | psql -b

node --test 01-match.js

export PGDATABASE=test
./02-service-prepare.sh
node --test 02-service.js
