#!/bin/bash

set -euo pipefail
cd "$(dirname "$(realpath "$0")")"
set -x

env | grep '^PG' || true
psql -c 'CREATE DATABASE mta_2024_03_18'
export PGDATABASE=mta_2024_03_18

mkdir -p mta-2024-03-18.gtfs
cd mta-2024-03-18.gtfs
tar -xk -f ../mta-2024-03-18.gtfs.tar.lzma
cd -

NODE_ENV=production npm exec -- gtfs-to-sql \
	-d --trips-without-shape-id --routes-without-agency-id -- \
	mta-2024-03-18.gtfs/*.txt \
	| sponge | psql -b

node --test *.js
