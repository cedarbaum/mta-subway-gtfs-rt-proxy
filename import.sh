#!/bin/bash

set -euo pipefail
cd "$(dirname "$(realpath "$0")")"

env | grep '^PG' || true

set -x

mkdir -p gtfs

./curl-mirror --times \
	'http://web.mta.info/developers/data/nyct/subway/google_transit.zip' \
	gtfs/mta.gtfs.zip

# todo: consider using a dependency-based build system in order not to re-do all these operations again an again
# e.g. tup (https://gittup.org/tup/ex_a_first_tupfile.html)

set +x
for gtfs_zip in gtfs/*.gtfs.zip; do
	# extract GTFS
	gtfs_dir="$(dirname "$gtfs_zip")/$(basename "$gtfs_zip" '.zip')"
	rm -rf "$gtfs_dir"
	unzip -j -q -d "$gtfs_dir" "$gtfs_zip"
	du -ch "$gtfs_dir"/*
done
set -x

# import GTFS
NODE_ENV=production npm exec -- gtfs-to-sql \
	-d --trips-without-shape-id --routes-without-agency-id -- \
	"$gtfs_dir"/*.txt \
	| sponge | psql -b
