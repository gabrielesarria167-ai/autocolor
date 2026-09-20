#!/usr/bin/env bash
#
# Publish the export to Neon and harden it.
#
#     npm run colordb:push
#
# Needs two things in the environment, neither of which belongs in render.yaml:
#
#   AUTOCOLOR_COLORDB_ADMIN_URL   the owner role. Creates schemas, loads rows,
#                                 owns the functions. Used from this machine
#                                 only; the server never sees it.
#   AUTOCOLOR_COLORDB_APP_PASSWORD  the password for colordb_app, the read-only
#                                 role the server connects as.
#
# Read from the environment and not from arguments on purpose: an argument is
# visible to anyone who can run ps while this is going.
#
# Run npm run colordb:load first. This sends export/, nothing else — the
# formulas stay on this machine.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

PG_BIN="${AUTOCOLOR_PG_BIN:-/Applications/Postgres.app/Contents/Versions/latest/bin}"
PSQL="$PG_BIN/psql"

: "${AUTOCOLOR_COLORDB_ADMIN_URL:?set it to the owner connection string}"
: "${AUTOCOLOR_COLORDB_APP_PASSWORD:?set it to the password for colordb_app}"

if [ ! -x "$PSQL" ]; then
    echo "No psql in: $PG_BIN" >&2
    exit 1
fi

for f in make model colour vehicle_colour meta; do
    if [ ! -f "export/$f.csv" ]; then
        echo "export/$f.csv is missing. Run: npm run colordb:load" >&2
        exit 1
    fi
done

# The admin URL must be as well protected as the application's. It carries more.
case "$AUTOCOLOR_COLORDB_ADMIN_URL" in
    *sslmode=verify-full*) ;;
    *localhost*|*127.0.0.1*) echo "note: loopback admin URL, TLS not required" ;;
    *) echo "AUTOCOLOR_COLORDB_ADMIN_URL must carry sslmode=verify-full" >&2; exit 1 ;;
esac

run() { "$PSQL" -v ON_ERROR_STOP=1 "$AUTOCOLOR_COLORDB_ADMIN_URL" "$@"; }

echo "==> 50_neon_schema  (drops and recreates colour)"
run -q -f sql/50_neon_schema.sql
echo "==> 60_neon_load    (693,636 links; a few minutes over the network)"
run -f sql/60_neon_load.sql
echo "==> 70_neon_api     (the six functions)"
run -q -f sql/70_neon_api.sql
echo "==> 80_neon_grants  (the role, the revokes, the grants)"
run -v app_pw="$AUTOCOLOR_COLORDB_APP_PASSWORD" -f sql/80_neon_grants.sql

echo ""
echo "Now prove it is boxed in, as the application role:"
echo "    npm run colordb:verify"
