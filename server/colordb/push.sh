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

# Both come from the repository's .env when they are not already exported, the
# same file and the same precedence server/env.js uses: the real environment
# wins, the file fills the gaps.
#
# Reading them from a file rather than typing them is the point. A secret typed
# on a command line lands in the shell's history and is visible to anyone who
# can run ps while this is going, and the `read -p` that would avoid that is
# spelled differently in bash and zsh -- which is its own way to leak one.
ENV_FILE="$HERE/../../.env"
if [ -f "$ENV_FILE" ]; then
    for key in AUTOCOLOR_COLORDB_ADMIN_URL AUTOCOLOR_COLORDB_APP_PASSWORD; do
        eval "current=\${$key-}"
        [ -n "$current" ] && continue
        # The last assignment wins, comments and blank lines are skipped, and a
        # matching pair of surrounding quotes is stripped.
        value="$(sed -n "s/^[[:space:]]*$key[[:space:]]*=//p" "$ENV_FILE" | tail -n 1)"
        [ -z "$value" ] && continue
        case "$value" in
            \"*\") value="${value#\"}"; value="${value%\"}" ;;
            \'*\') value="${value#\'}"; value="${value%\'}" ;;
        esac
        export "$key=$value"
    done
fi

if [ -z "${AUTOCOLOR_COLORDB_ADMIN_URL:-}" ] || [ -z "${AUTOCOLOR_COLORDB_APP_PASSWORD:-}" ]; then
    echo "Missing credentials. Put these two in $(cd "$HERE/../.." && pwd)/.env:" >&2
    echo "" >&2
    echo "    AUTOCOLOR_COLORDB_ADMIN_URL=postgresql://owner:pass@host/colordb?sslmode=verify-full" >&2
    echo "    AUTOCOLOR_COLORDB_APP_PASSWORD=a-fresh-password-for-colordb_app" >&2
    echo "" >&2
    echo ".env is gitignored. Neither belongs on a command line." >&2
    exit 1
fi

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
