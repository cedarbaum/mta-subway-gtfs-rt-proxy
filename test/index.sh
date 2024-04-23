#!/bin/bash

set -euo pipefail
cd "$(dirname "$(realpath "$0")")"

set -x

env | grep '^PG' || true

source 01-match-prepare.sh 'test_mta_2024_03_18'
env PGDATABASE=test_mta_2024_03_18 \
	node --test 01-match.js
psql -c 'DROP DATABASE "test_mta_2024_03_18"'

source 02-service-prepare.sh
node --test 02-service.js
