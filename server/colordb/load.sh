#!/usr/bin/env bash
#
# Build the colour subset locally. Nothing leaves the machine.
#
#     npm run colordb:load
#
# Loads the bundle into a throwaway database, runs sql/10-40 over it and
# leaves four CSVs in export/ for push.sh to send to Neon. Takes several
# minutes: the bundle is 424 MB and 1.4 million rows before the subset.
#
# The throwaway database is dropped and recreated on every run, so this is
# safe to repeat and there is nothing to clean up afterwards.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# The same pinning as server/pgserver.sh, and for the same reason: this machine
# has Postgres.app (18) and Homebrew (17) both on the PATH, in different orders
# for different commands, and mixing them creates a cluster that will not start.
PG_BIN="${AUTOCOLOR_PG_BIN:-/Applications/Postgres.app/Contents/Versions/latest/bin}"
PORT="${AUTOCOLOR_PGPORT:-5434}"
DBNAME="${AUTOCOLOR_COLORDB_BUILD:-colordb_src}"

if [ ! -x "$PG_BIN/psql" ]; then
    echo "No psql in: $PG_BIN" >&2
    echo "Install Postgres.app or set AUTOCOLOR_PG_BIN to the right bin folder." >&2
    exit 1
fi

if ! "$PG_BIN/pg_isready" -q -p "$PORT" 2>/dev/null; then
    echo "No Postgres answering on port $PORT. Start it with: npm run db:start" >&2
    exit 1
fi

psql_db() { "$PG_BIN/psql" -v ON_ERROR_STOP=1 -q -p "$PORT" -d "$DBNAME" "$@"; }

echo "==> recreating $DBNAME on port $PORT"
"$PG_BIN/psql" -q -p "$PORT" -d postgres -c "DROP DATABASE IF EXISTS $DBNAME"
"$PG_BIN/psql" -q -p "$PORT" -d postgres -c "CREATE DATABASE $DBNAME"

# The bundle's own scripts, unmodified. Its \copy paths are relative to the
# bundle directory, so run them from there.
cd "$HERE/bundle"
echo "==> 01_schema"; psql_db -f 01_schema.sql
echo "==> 02_load (several minutes)"; psql_db -f 02_load.sql
echo "==> 03_indexes"; psql_db -f 03_indexes.sql
echo "==> 04_verify"; "$PG_BIN/psql" -q -p "$PORT" -d "$DBNAME" -f 04_verify.sql

# Ours. 40_export writes into export/, relative to here.
cd "$HERE"
mkdir -p export
echo "==> 10_makes";  psql_db -f sql/10_makes.sql
echo "==> 20_subset"; psql_db -f sql/20_subset.sql
echo "==> 30_derive"; psql_db -f sql/30_derive.sql
echo "==> 35_hex (mixes a screen colour from each formula)"; psql_db -f sql/35_hex.sql
echo "==> 40_export"; "$PG_BIN/psql" -v ON_ERROR_STOP=1 -p "$PORT" -d "$DBNAME" -f sql/40_export.sql

echo ""
echo "==> reconcile-hex (turns a mixed colour back into the family its name states)"
node "$HERE/reconcile-hex.js"

echo ""
echo "==> src/colourIndex.js"
node "$HERE/build-index.js"

echo ""
echo "==> export/"
du -h export/*.csv
echo ""
echo "Next: npm run colordb:push"
