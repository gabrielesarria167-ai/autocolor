'use strict';

/* =============================================================================
   Aplica server/schema.sql a la base a la que apunte server/db.js — la de esta
   máquina, o la de un servicio alojado si hay DATABASE_URL.

       npm run db:migrate                                # la base local
       DATABASE_URL='postgresql://…' npm run db:migrate  # la de producción

   Es el hermano portátil de `npm run db:schema` (server/pgserver.sh), que llama
   a psql con el puerto 5434 escrito y con los binarios de Postgres.app: sirve
   en esta máquina y en ninguna otra. Este no necesita psql instalado, porque
   habla por el mismo pool que la aplicación.

   El archivo entero va en una sola consulta y sin parámetros. Eso hace que
   node-postgres use el protocolo simple, y de ahí salen las dos cosas que
   importan: Postgres acepta varias sentencias seguidas —no hay que partir el
   archivo por ';', que rompería los cuerpos plpgsql entre $$ del final— y las
   ejecuta dentro de una única transacción implícita, así que una sentencia que
   falle no deja media migración aplicada.

   schema.sql es idempotente (CREATE ... IF NOT EXISTS, ADD COLUMN IF NOT
   EXISTS, CREATE OR REPLACE), así que volver a aplicarlo no pierde datos.
   ========================================================================== */

// Igual que en server.js: el .env de la raíz antes de leer nada del entorno.
// Como env.js respeta lo que ya venga puesto, una DATABASE_URL delante del
// comando le gana al archivo — que es lo que hace seguro apuntar a producción
// desde una máquina que tiene su propia base local configurada.
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
        // Cuando la base no responde, Node agrupa un intento por dirección (::1
        // y 127.0.0.1) en un AggregateError cuyo propio .message viene vacío, y
        // sin este respaldo el aviso terminaba en «: » y parecía que el SQL
        // falló. Mismo trato que en server.js al arrancar.
        const detail = err.message
            || (err.errors || []).map((e) => e.message).join('; ')
            || err.code
            || String(err);
        console.error(`\nNo se pudo aplicar el esquema: ${detail}`);
        // Postgres dice en qué carácter del archivo tropezó; sin esto hay que
        // adivinar cuál de las ciento ochenta líneas fue.
        if (err.position) console.error(`  (carácter ${err.position} de schema.sql)`);
        // ECONNREFUSED no es un problema del esquema: es que la base no está
        // levantada. Si es la local, hay un comando para encenderla.
        const refused = err.code === 'ECONNREFUSED'
            || (err.errors || []).some((e) => e.code === 'ECONNREFUSED');
        if (refused && !DATABASE_URL) {
            console.error('\n  La base local no responde. Levántala primero:\n');
            console.error('      npm run db:start        # o  npm run db:init  la primera vez\n');
        }
        await pool.end().catch(() => {});
        process.exit(1);
    });
