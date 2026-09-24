'use strict';

/* =============================================================================
   Applies server/schema.sql to whichever database server/db.js points at:
   this machine's, or a hosted service's if DATABASE_URL is set.

       npm run db:migrate                                # the local database
       DATABASE_URL='postgresql://…' npm run db:migrate  # production

   It is the portable sibling of `npm run db:schema` (server/pgserver.sh),
   which calls psql with port 5434 written in and with the Postgres.app
   binaries: it works on this machine and no other. This one does not need
   psql installed, because it talks through the same pool as the application.

   The whole file goes in a single query with no parameters. That makes
   node-postgres use the simple protocol, which brings the two things that
   matter: Postgres accepts several statements in a row (no need to split the
   file on ';', which would break the plpgsql bodies between $$ at the end)
   and runs them inside a single implicit transaction, so a statement that
   fails does not leave half a migration applied.

   schema.sql is idempotent (CREATE ... IF NOT EXISTS, ADD COLUMN IF NOT
   EXISTS, CREATE OR REPLACE), so applying it again loses no data.
   ========================================================================== */

// As in server.js: the root .env before reading anything from the
// environment. Since env.js respects whatever is already set, a DATABASE_URL
// in front of the command beats the file, which is what makes pointing at
// production safe from a machine that has its own local database configured.
require('./env');

const fs = require('node:fs');
const path = require('node:path');
const { pool, describe, DATABASE_URL } = require('./db');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

async function main() {
    console.log(`Aplicando ${SCHEMA_PATH}`);
    console.log(`Base: ${describe()}`);
    await pool.query(fs.readFileSync(SCHEMA_PATH, 'utf8'));
    console.log('Listo.');
}

main()
    .then(() => pool.end())
    .catch(async (err) => {
        // When the database does not answer, Node groups one attempt per
        // address (::1 and 127.0.0.1) into an AggregateError whose own .message
        // is empty, and without this fallback the notice ended in «: » and it
        // looked like the SQL had failed. Same treatment as server.js at startup.
        const detail = err.message
            || (err.errors || []).map((e) => e.message).join('; ')
            || err.code
            || String(err);
        console.error(`\nNo se pudo aplicar el esquema: ${detail}`);
        // Postgres says at which character of the file it stumbled; without
        // this one has to guess which of the hundred and eighty lines it was.
        if (err.position) console.error(`  (carácter ${err.position} de schema.sql)`);
        // ECONNREFUSED is not a schema problem: the database is not up. If it
        // is the local one, there is a command to start it.
        const refused = err.code === 'ECONNREFUSED'
            || (err.errors || []).some((e) => e.code === 'ECONNREFUSED');
        if (refused && !DATABASE_URL) {
            console.error('\n  La base local no responde. Levántala primero:\n');
            console.error('      npm run db:start        # o  npm run db:init  la primera vez\n');
        }
        await pool.end().catch(() => {});
        process.exit(1);
    });
