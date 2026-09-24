#!/usr/bin/env bash
#
# The Autocolor Postgres server.
#
# Autocolor runs its own server, with its own data directory and its own
# port; it shares no cluster with any other project on the machine. That
# way, stopping, backing up, upgrading or deleting another project's database
# does not touch Autocolor's, and vice versa.
#
#   ./server/pgserver.sh init     creates the cluster and the database (once)
#   ./server/pgserver.sh start    starts it
#   ./server/pgserver.sh stop     stops it
#   ./server/pgserver.sh status   says whether it is running
#   ./server/pgserver.sh psql     opens psql on the autocolor database
#   ./server/pgserver.sh schema   applies server/schema.sql
#
# Everything is configurable through environment variables (see below), in
# case the cluster has to live elsewhere or talk on another port.

set -euo pipefail

# Where Postgres.app keeps its servers' data, so this one shows in its list
# next to the others and can be started and stopped both from the app and
# from here. Outside the repository too, so a `git clean -xfd` cannot delete
# the customers' requests.
PGDATA="${AUTOCOLOR_PGDATA:-$HOME/Library/Application Support/Postgres/autocolor}"

# Its own port: 5432 belongs to sarTech and 5433 to coursepostgreSQL.
PORT="${AUTOCOLOR_PGPORT:-5434}"

DBNAME="${AUTOCOLOR_PGDATABASE:-autocolor}"

# This machine has both the Postgres.app binaries (18) and Homebrew's (17),
# and not in the same PATH order for every command: `psql` resolves to one
# and `initdb` to the other. Mixing them creates a cluster that then cannot
# be started, so a single set of binaries is pinned here.
PG_BIN="${AUTOCOLOR_PG_BIN:-/Applications/Postgres.app/Contents/Versions/latest/bin}"

# The same log name Postgres.app uses, so both write to the same place and it
# does not matter who started the server.
LOGFILE="${AUTOCOLOR_PGLOG:-$PGDATA/postgresql.log}"
SCHEMA="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/schema.sql"

if [ ! -x "$PG_BIN/pg_ctl" ]; then
    echo "Cannot find the Postgres binaries in: $PG_BIN" >&2
    echo "Install Postgres.app or set AUTOCOLOR_PG_BIN to the right bin folder." >&2
    exit 1
fi

running() { "$PG_BIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; }

start_server() {
    if running; then
        echo "The Autocolor server is already running (port $PORT)."
        return
    fi
    mkdir -p "$(dirname "$LOGFILE")"
    "$PG_BIN/pg_ctl" -D "$PGDATA" -l "$LOGFILE" -o "-p $PORT" -w start
    echo "Autocolor server on port $PORT, data in $PGDATA"
}

case "${1:-}" in
    init)
        if [ -d "$PGDATA/base" ]; then
            echo "A cluster already exists in $PGDATA, nothing to initialise."
        else
            echo "Creating the Autocolor cluster in $PGDATA..."
            mkdir -p "$PGDATA"
            chmod 700 "$PGDATA"
            "$PG_BIN/initdb" -D "$PGDATA" --encoding=UTF8 --locale=en_US.UTF-8 >/dev/null
            # The port is written into the cluster's configuration, so starting
            # it by hand without -o "-p …" does not clash with 5432 either.
            printf '\n# Autocolor: its own port, separate from the machine'"'"'s general Postgres.\nport = %s\n' "$PORT" >> "$PGDATA/postgresql.conf"
        fi
        start_server
        if ! "$PG_BIN/psql" -p "$PORT" -d postgres -tAc \
            "SELECT 1 FROM pg_database WHERE datname = '$DBNAME'" | grep -q 1; then
            "$PG_BIN/createdb" -p "$PORT" "$DBNAME"
            echo "Database \"$DBNAME\" created."
        fi
        "$PG_BIN/psql" -v ON_ERROR_STOP=1 -q -p "$PORT" -d "$DBNAME" -f "$SCHEMA"
        echo "Done: database \"$DBNAME\" on port $PORT."
        ;;
    start)
        start_server
        ;;
    stop)
        if running; then
            "$PG_BIN/pg_ctl" -D "$PGDATA" -w stop
        else
            echo "The Autocolor server is not running."
        fi
        ;;
    status)
        if running; then
            echo "Running: port $PORT, data in $PGDATA"
        else
            echo "Stopped: data in $PGDATA"
            exit 1
        fi
        ;;
    psql)
        shift
        exec "$PG_BIN/psql" -p "$PORT" -d "$DBNAME" "$@"
        ;;
    schema)
        exec "$PG_BIN/psql" -v ON_ERROR_STOP=1 -p "$PORT" -d "$DBNAME" -f "$SCHEMA"
        ;;
    *)
        sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
        exit 1
        ;;
esac
