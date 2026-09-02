#!/usr/bin/env bash
#
# El servidor Postgres de Autocolor.
#
# Autocolor corre su propio servidor, con su propio directorio de datos y su
# propio puerto — no comparte clúster con ningún otro proyecto de la máquina.
# Así, apagar, respaldar, actualizar o borrar la base de otro proyecto no toca
# la de Autocolor, y al revés.
#
#   ./server/pgserver.sh init     crea el clúster y la base (una sola vez)
#   ./server/pgserver.sh start    lo levanta
#   ./server/pgserver.sh stop     lo detiene
#   ./server/pgserver.sh status   dice si está corriendo
#   ./server/pgserver.sh psql     abre psql sobre la base autocolor
#   ./server/pgserver.sh schema   aplica server/schema.sql
#
# Todo es configurable por variables de entorno (ver abajo), por si el clúster
# tiene que vivir en otro lado o hablar por otro puerto.

set -euo pipefail

# Donde Postgres.app guarda los datos de sus servidores, para que este
# aparezca en su lista junto a los demás y pueda arrancarse y pararse tanto
# desde la app como desde aquí. Fuera del repositorio, además, para que un
# `git clean -xfd` no pueda borrar las solicitudes de los clientes.
PGDATA="${AUTOCOLOR_PGDATA:-$HOME/Library/Application Support/Postgres/autocolor}"

# Puerto propio: el 5432 es de sarTech y el 5433 de coursepostgreSQL.
PORT="${AUTOCOLOR_PGPORT:-5434}"

DBNAME="${AUTOCOLOR_PGDATABASE:-autocolor}"

# En esta máquina conviven los binarios de Postgres.app (18) y los de Homebrew
# (17), y no en el mismo orden en el PATH para todos los comandos: `psql`
# resuelve a uno y `initdb` al otro. Mezclarlos crea un clúster que después no
# se puede arrancar, así que aquí se fija un solo juego de binarios.
PG_BIN="${AUTOCOLOR_PG_BIN:-/Applications/Postgres.app/Contents/Versions/latest/bin}"

# El mismo nombre de log que usa Postgres.app, así los dos escriben en el
# mismo sitio y da igual quién haya arrancado el servidor.
LOGFILE="${AUTOCOLOR_PGLOG:-$PGDATA/postgresql.log}"
SCHEMA="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/schema.sql"

if [ ! -x "$PG_BIN/pg_ctl" ]; then
    echo "No encuentro los binarios de Postgres en: $PG_BIN" >&2
    echo "Instala Postgres.app o define AUTOCOLOR_PG_BIN con la carpeta bin correcta." >&2
    exit 1
fi

running() { "$PG_BIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; }

start_server() {
    if running; then
        echo "El servidor de Autocolor ya está corriendo (puerto $PORT)."
        return
    fi
    mkdir -p "$(dirname "$LOGFILE")"
    "$PG_BIN/pg_ctl" -D "$PGDATA" -l "$LOGFILE" -o "-p $PORT" -w start
    echo "Servidor de Autocolor en el puerto $PORT — datos en $PGDATA"
}

case "${1:-}" in
    init)
        if [ -d "$PGDATA/base" ]; then
            echo "Ya existe un clúster en $PGDATA — nada que inicializar."
        else
            echo "Creando el clúster de Autocolor en $PGDATA…"
            mkdir -p "$PGDATA"
            chmod 700 "$PGDATA"
            "$PG_BIN/initdb" -D "$PGDATA" --encoding=UTF8 --locale=en_US.UTF-8 >/dev/null
            # El puerto queda escrito en la configuración del clúster, para que
            # arrancarlo a mano sin -o "-p …" tampoco choque con el 5432.
            printf '\n# Autocolor: puerto propio, separado del Postgres general de la máquina.\nport = %s\n' "$PORT" >> "$PGDATA/postgresql.conf"
        fi
        start_server
        if ! "$PG_BIN/psql" -p "$PORT" -d postgres -tAc \
            "SELECT 1 FROM pg_database WHERE datname = '$DBNAME'" | grep -q 1; then
            "$PG_BIN/createdb" -p "$PORT" "$DBNAME"
            echo "Base \"$DBNAME\" creada."
        fi
        "$PG_BIN/psql" -v ON_ERROR_STOP=1 -q -p "$PORT" -d "$DBNAME" -f "$SCHEMA"
        echo "Listo: base \"$DBNAME\" en el puerto $PORT."
        ;;
    start)
        start_server
        ;;
    stop)
        if running; then
            "$PG_BIN/pg_ctl" -D "$PGDATA" -w stop
        else
            echo "El servidor de Autocolor no está corriendo."
        fi
        ;;
    status)
        if running; then
            echo "Corriendo — puerto $PORT, datos en $PGDATA"
        else
            echo "Detenido — datos en $PGDATA"
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
