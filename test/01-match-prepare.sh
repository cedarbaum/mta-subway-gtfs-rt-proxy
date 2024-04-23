set -euo pipefail

db_name="${1:?'missing 1st argument: DB name'}"

postgis_gtfs_importer_bin="$(realpath ../postgis-gtfs-importer/node_modules/.bin)"
# make postgis-gtfs-importer's CLI dependencies callable, notably gtfs-via-postgres' gtfs-to-sql
export PATH="$postgis_gtfs_importer_bin:$PATH"

set -x

psql -c "CREATE DATABASE \"$db_name\""

mkdir -p mta-2024-03-18.gtfs
cd mta-2024-03-18.gtfs
tar -xk -f ../mta-2024-03-18.gtfs.tar.lzma
# todo: remove shapes.txt?
cd -

NODE_ENV=production gtfs-to-sql \
	-d -s \
	--trips-without-shape-id --routes-without-agency-id -- \
	mta-2024-03-18.gtfs/*.txt \
	| sponge | env "PGDATABASE=$db_name" psql -b
