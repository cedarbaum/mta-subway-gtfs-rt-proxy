set -euo pipefail

db_name="${1:?'missing 1st argument: DB name'}"

sample_gtfs_feed_dir="$(realpath ../node_modules/sample-gtfs-feed/gtfs)"

set -x

psql -c "CREATE DATABASE \"$db_name\""

NODE_ENV=production gtfs-to-sql \
	-d -s \
	--trips-without-shape-id \
	-- "$sample_gtfs_feed_dir"/*.txt \
	| sponge | env "PGDATABASE=$db_name" psql -b

for file in ../lib/postprocessing.d/*; do
	env "PGDATABASE=$db_name" psql -b -1 -v 'ON_ERROR_STOP=1' -f "$file"
done
