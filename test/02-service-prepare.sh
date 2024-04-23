set -euo pipefail

path_to_sample_gtfs_feed="$(dirname "$(node -p 'require.resolve("sample-gtfs-feed/gtfs/trips.txt")')")"

create_gtfs_feed_with_trip_ids () {
	dir="$(mktemp -d)"
	cp "$path_to_sample_gtfs_feed"/*.txt "$dir/"
	rm "$dir/translations.txt" # translations.txt is hard to patch, so we just remove it
	qsv replace -Q \
		-s trip_id '^' "$2" \
		<"$dir/trips.txt" | sponge "$dir/trips.txt"
	qsv replace -Q \
		-s trip_id '^' "$2" \
		<"$dir/stop_times.txt" | sponge "$dir/stop_times.txt"
	qsv replace -Q \
		-s trip_id '^' "$2" \
		<"$dir/frequencies.txt" | sponge "$dir/frequencies.txt"
	zip -r -D -j -9 "$1.gtfs.zip" "$dir"
}

set -x

create_gtfs_feed_with_trip_ids foo 'FoO_'
create_gtfs_feed_with_trip_ids bar 'bAr_'
