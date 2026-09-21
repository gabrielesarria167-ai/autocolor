'use strict';

/* =============================================================================
   Acceso a la base `autocolor`: guardar una solicitud del asistente, buscar
   una por su código, y las que usa el panel del taller — listarlas, cambiarle
   el estado a una, ocuparla o soltarla, y ver cuáles tiene alguien tomadas.

   Also the boss's note on each worker (worker_notes), which is the one thing
   here that is not about a request.
   ========================================================================== */

const crypto = require('node:crypto');
const { Pool } = require('pg');

// Un servicio alojado entrega la base como una sola URL. Cuando DATABASE_URL
// está puesta manda entera —host, puerto, base, usuario, contraseña y TLS
// salen de ahí— y el bloque local de abajo no se toca.
//
// Son dos ramas y no una configuración mezclada a propósito:
// `new Pool({ connectionString, port: 5434 })` no combina las dos cosas. pg
// hace `Object.assign({}, config, parse(connectionString))`, así que la URL
// pisa lo que haya al lado, y el 5434 quedaría escrito sin significar nada.
const DATABASE_URL = process.env.DATABASE_URL || '';

const pool = new Pool(DATABASE_URL
    ? {
        connectionString: DATABASE_URL,
        max: 10,
        idleTimeoutMillis: 30_000,
        // Más holgado que en local: la base gestionada suspende el cómputo
        // cuando nadie la usa, y la primera conexión después de eso paga el
        // arranque además de la red y el TLS.
        connectionTimeoutMillis: 15_000,
    }
    : {
        // Autocolor tiene su propio servidor Postgres, en su propio puerto — no
        // comparte clúster con los demás proyectos de la máquina (ver
        // server/pgserver.sh). El puerto va escrito aquí y no se deja en manos de
        // libpq justamente por eso: sin él, el valor por omisión es el 5432 del
        // Postgres general, y la aplicación terminaría escribiendo en el clúster
        // compartido sin que nadie lo note.
        host: process.env.PGHOST || 'localhost',
        port: Number(process.env.PGPORT) || 5434,
        database: process.env.PGDATABASE || 'autocolor',
        user: process.env.PGUSER,          // por omisión, el usuario del sistema
        password: process.env.PGPASSWORD,
        max: 10,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
    });

// node-postgres emite 'error' en el pool cuando se cae una conexión que estaba
// ociosa —Postgres reiniciado, la red cortada, el servidor reciclándola—. En
// Node un 'error' de un EventEmitter sin escucha es una excepción no capturada,
// así que sin estas líneas basta un reinicio de la base para matar el proceso.
//
// No se relanza a propósito: la conexión rota ya la descarta el pool solo, y la
// siguiente consulta abrirá otra. Lo único que hace falta es que quede escrito.
//
// Contra una base gestionada esto deja de ser una precaución y pasa a ser el
// caso normal: suspende el cómputo cuando nadie la usa y corta las conexiones
// ociosas ella misma, así que la línea se ve en el registro cada tanto.
pool.on('error', (err) => {
    console.error('[db] conexión ociosa perdida:', err.message);
});

// Un código de exactamente 10 dígitos, sin cero inicial para que siempre se
// muestre con sus 10 cifras. Al azar y no correlativo: el código es la única
// credencial para consultar una solicitud, y uno correlativo dejaría leer los
// datos de otros clientes probando números vecinos. crypto.randomInt evita
// además que los códigos sean predecibles a partir de uno conocido.
function generateId() {
    return String(crypto.randomInt(1_000_000_000, 10_000_000_000));
}

const INSERT_REQUEST = `
    INSERT INTO requests (id, brand, model, body_type, model_year, plate, mileage, color_code,
                          vehicle, quality, parts, first_name, last_name,
                          department, province, phone, email, notes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    RETURNING id, status, created_at
`;

/* La base gestionada se duerme, y despertarla tarda más que conectarse.
 *
 * Neon suspende el cómputo cuando nadie le pregunta nada —que para el sitio de
 * un taller es casi todo el día— y la primera conexión después de eso paga el
 * arranque entera. ping() ya lo sabía y reintentaba cuatro veces AL ARRANCAR;
 * las consultas de después no reintentaban ninguna. Así que el primer cliente
 * de la mañana pulsaba «Confirmar pedido», la conexión se agotaba mientras la
 * base despertaba, y la excepción salía por el catch general como un 500
 * genérico: «No pudimos procesar la solicitud». El pedido no se guardaba y no
 * quedaba dicho en ninguna parte que la culpa fuera de la base.
 *
 * Lo que se reintenta es SOLO conseguir la conexión, nunca la consulta. Esa
 * distinción es la que hace que esto sea seguro para un INSERT: si
 * pool.connect() falla, no se envió nada, y volver a pedir conexión no puede
 * duplicar un pedido. Si la conexión se cae con la consulta ya enviada, no se
 * reintenta: más vale un error que dos pedidos iguales con dos códigos
 * distintos, porque el segundo lo prepara el taller y lo paga alguien.
 */
const UNREACHABLE_CODES = new Set([
    'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED',
    'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE',
    // La base se apagó, se está apagando, o todavía está arrancando.
    '57P01', '57P02', '57P03',
]);

function unreachable(err) {
    const code = err && err.code ? String(err.code) : '';
    if (UNREACHABLE_CODES.has(code)) return true;
    // Clase 08: toda la familia de «connection exception» de Postgres.
    if (code.startsWith('08')) return true;
    // pg y pg-pool dan estas como Error pelado, sin code.
    // Tres redacciones distintas para lo mismo, y hay que nombrar las tres:
    // pg-pool dice "timeout exceeded when trying to connect" cuando se agota
    // esperando una conexión libre —que es justo lo que pasa con la base
    // dormida—, el Client de pg dice "timeout expired", y "Connection
    // terminated due to connection timeout" viene de un tercer sitio. Ninguna
    // trae code. Lo que NO puede entrar aquí es "timeout" a secas: eso también
    // dice "canceling statement due to statement timeout" (57014), que es una
    // consulta lenta o un error nuestro, no una base que no está.
    return /timeout exceeded|timeout expired|connection timeout|connection terminated|socket hang up/i
        .test(err && err.message ? err.message : '');
}

const CONNECT_ATTEMPTS = 3;

/* Conseguir una conexión, esperando a que la base despierte si hace falta.
 * Las esperas suben —400ms, 800ms— porque lo que se espera es un arranque, no
 * un paquete perdido, y sumadas al connectionTimeoutMillis de arriba dan al
 * cómputo bastante más de medio minuto para levantarse. */
async function connect() {
    for (let attempt = 1; ; attempt++) {
        try {
            return await pool.connect();
        } catch (err) {
            if (!unreachable(err) || attempt >= CONNECT_ATTEMPTS) throw err;
            console.warn(`[db] ${err.code || 'sin conexión'} al conectar`
                + ` (intento ${attempt} de ${CONNECT_ATTEMPTS}); la base puede estar despertando`);
            await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
        }
    }
}

/* El reemplazo de pool.query() en todo este archivo: consigue la conexión con
 * reintentos y lanza la consulta una sola vez. */
async function query(text, values) {
    const client = await connect();
    try {
        return await client.query(text, values);
    } finally {
        client.release();
    }
}

const UNIQUE_VIOLATION = '23505';
const ID_ATTEMPTS = 5;

/**
 * Guarda una solicitud y devuelve el código asignado.
 *
 * El código se sortea aquí y no en la base, así que puede chocar con uno ya
 * usado. Con 9 000 millones de códigos posibles eso es rarísimo, pero la
 * clave primaria lo convierte en un error limpio (23505) en vez de un
 * sobrescribir silencioso, y basta con volver a sortear.
 */
async function createRequest(data) {
    for (let attempt = 1; attempt <= ID_ATTEMPTS; attempt++) {
        const id = generateId();
        try {
            const { rows } = await query(INSERT_REQUEST, [
                id,
                data.brand,
                data.model,
                data.bodyType,
                data.year,
                data.plate,
                data.mileage,
                data.colorCode,
                data.vehicle,
                data.quality,
                data.parts,
                data.firstName,
                data.lastName,
                data.department,
                data.province,
                data.phone,
                data.email,
                data.notes,
            ]);
            return { id: rows[0].id.trim(), status: rows[0].status, createdAt: rows[0].created_at };
        } catch (err) {
            if (err.code !== UNIQUE_VIOLATION || attempt === ID_ATTEMPTS) throw err;
        }
    }
    throw new Error('No se pudo generar un código libre'); // inalcanzable: el bucle lanza antes
}

/**
 * Busca una solicitud por su código. Devuelve solo lo que se le muestra a
 * quien consulta — nunca el teléfono, el correo ni las notas: el código viaja
 * en mensajes y papeles, y no debería alcanzar para sacar los datos de
 * contacto de nadie.
 */
async function findRequest(id) {
    const { rows } = await query(
        `SELECT id, brand, model, vehicle, first_name, last_name, status
           FROM requests
          WHERE id = $1`,
        [id]
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
        id: row.id.trim(),
        // La marca y el modelo son lo que el cliente reconoce como «su»
        // vehículo; `vehicle` (la silueta 3D) queda para las solicitudes
        // anteriores a que el asistente los pidiera.
        brand: row.brand,
        model: row.model,
        vehicle: row.vehicle,
        firstName: row.first_name,
        lastName: row.last_name,
        status: row.status,
    };
}

/* -----------------------------------------------------------------------------
   paint_orders — los pedidos de matizado de pgs/paintings.html

   Una tabla aparte de `requests` porque es otro negocio: aquí nadie deja un
   vehículo. Lo único que comparten es la forma del código, que se sortea con
   el mismo generateId() y por la misma razón.
-------------------------------------------------------------------------- */

const INSERT_PAINT_ORDER = `
    INSERT INTO paint_orders (id, method, brand, color_code, color_name, sw_code, finish,
                              reading_l, reading_a, reading_b,
                              size, units, price,
                              company, ruc, first_name, last_name,
                              department, province, phone, email, notes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
            $17, $18, $19, $20, $21, $22)
    RETURNING id, status, created_at
`;

/**
 * Guarda un pedido de matizado y devuelve el código asignado.
 *
 * Mismo sorteo del código y mismo reintento ante un choque que
 * createRequest(): los dos códigos salen del mismo espacio de 10 dígitos,
 * aunque vivan en tablas distintas.
 */
async function createPaintOrder(data) {
    for (let attempt = 1; attempt <= ID_ATTEMPTS; attempt++) {
        const id = generateId();
        try {
            const { rows } = await query(INSERT_PAINT_ORDER, [
                id,
                data.method,
                data.brand,
                data.colorCode,
                data.colorName,
                data.swCode,
                data.finish,
                data.reading ? data.reading.L : null,
                data.reading ? data.reading.a : null,
                data.reading ? data.reading.b : null,
                data.size,
                data.units,
                data.price,
                data.company,
                data.ruc,
                data.firstName,
                data.lastName,
                data.department,
                data.province,
                data.phone,
                data.email,
                data.notes,
            ]);
            return { id: rows[0].id.trim(), status: rows[0].status, createdAt: rows[0].created_at };
        } catch (err) {
            if (err.code !== UNIQUE_VIOLATION || attempt === ID_ATTEMPTS) throw err;
        }
    }
    throw new Error('No se pudo generar un código libre'); // inalcanzable: el bucle lanza antes
}


/**
 * La cola de trabajo del taller: las solicitudes, la más reciente primero,
 * opcionalmente filtradas por estado.
 *
 * Trae el teléfono, que `findRequest` esconde a propósito. Aquí sí: quien lee
 * esto ya pasó por la contraseña del taller y llamar al cliente es justamente
 * el trabajo. El correo y las notas siguen fuera hasta que haga falta.
 *
 * The ceiling applies to finished jobs only. Every request still in the shop
 * comes back whatever its age: the panel searches and filters «Mis vehículos»
 * in the browser over exactly these rows, and with a flat LIMIT 200 a car that
 * arrived before the 200 newest requests vanished from both while it was still
 * being painted. Finished ones (entregado, cancelado) are capped at the 200
 * newest, which is the part of the table that grows without end.
 */
const FINISHED = ['entregado', 'cancelado'];

async function listRequests(options) {
    const status = (options || {}).status || null;
    const { rows } = await query(
        `SELECT id, created_at, first_name, last_name, phone, brand, model,
                plate, quality, status, occupied_by, vehicle, parts
           FROM requests
          WHERE ($1::text IS NULL OR status = $1)
            AND (status <> ALL($2::text[]) OR id IN (
                    SELECT id FROM requests
                     WHERE status = ANY($2::text[])
                       AND ($1::text IS NULL OR status = $1)
                     ORDER BY created_at DESC
                     LIMIT 200))
          ORDER BY created_at DESC`,
        [status, FINISHED]
    );
    return rows.map((row) => ({
        id: row.id.trim(),
        createdAt: row.created_at,
        firstName: row.first_name,
        lastName: row.last_name,
        phone: row.phone,
        brand: row.brand,
        model: row.model,
        plate: row.plate,
        quality: row.quality,
        status: row.status,
        // The codes of the workers holding it, empty when it is available. The
        // readable names are put on by server.js with server/names.js; the
        // codes are what decides who may touch the row.
        occupiedBy: row.occupied_by || [],
        // The silhouette and its panels, which is what the panel's «Piezas»
        // column needs to draw the vehicle with the chosen parts lit up. The
        // count comes off the same array rather than out of a second
        // `cardinality(parts)`: two numbers that could disagree over one list.
        vehicle: row.vehicle,
        parts: row.parts || [],
        partCount: (row.parts || []).length,
    }));
}

/**
 * The requests somebody is currently holding, for the boss's monitor (see
 * GET /api/staff/workers in server/server.js).
 *
 * No phone and no customer name: the monitor answers "who is on what", and the
 * usual listing covers the rest. Data that does not need showing does not need
 * fetching either.
 *
 * A row comes back once however many people hold it; the caller deals it onto
 * each of its holders (see GET /api/staff/workers), so the newest-first order
 * here is the order each worker's own list ends up in. The LIMIT, as in
 * listRequests, is a ceiling and not pagination: today the occupied ones are a
 * handful, but a vehicle nobody releases stays occupied forever and the count
 * only goes up.
 */
async function listOccupied() {
    const { rows } = await query(
        `SELECT id, created_at, brand, model, plate, status, occupied_by
           FROM requests
          WHERE cardinality(occupied_by) > 0
          ORDER BY created_at DESC
          LIMIT 500`
    );
    return rows.map((row) => ({
        id: row.id.trim(),
        createdAt: row.created_at,
        brand: row.brand,
        model: row.model,
        plate: row.plate,
        status: row.status,
        occupiedBy: row.occupied_by || [],
    }));
}

/**
 * Changes a request's status, but only for somebody who is holding it: a
 * worker moves along the vehicles they are working on and no others. An
 * available one is not touched — it has to be taken first — and neither is one
 * held by other people. The test goes in the WHERE itself so that the check and
 * the change are a single step, with no gap between "I looked at who holds it"
 * and "I changed it".
 *
 * Returns { ok: true, ... } with the row; or { ok: false, reason } — 'not_found'
 * when the code does not exist, 'forbidden' when the caller is not one of its
 * holders (with `occupiedBy`: the array of who is holding it, empty when it was
 * free) — so that server.js answers 404 or 403. `updated_at` is the trigger's.
 *
 * `viewerId` is the session's code (see server/auth.js); it never arrives in
 * the request body, so it cannot be faked to touch somebody else's vehicle.
 */
//
// Either holder moves the work along: the two of them are on the same vehicle
// and asking which one of the pair may touch the status would only mean the
// other one waiting for them.
//
// Moving a job to a finished status also releases the vehicle — from both
// holders at once. A delivered or cancelled car is in nobody's hands, and
// leaving it occupied kept it on the boss's monitor as «held» forever.
//
// One statement with the check, the change and the reason for a refusal:
// `cur` locks the row and reports who held it at that moment, so a refusal
// can no longer blame a holder read by a second query after someone else had
// already changed it.
async function updateRequestStatus(id, status, viewerId) {
    const { rows } = await query(
        `WITH cur AS (
             SELECT id, occupied_by FROM requests WHERE id = $1 FOR UPDATE
         ), upd AS (
             UPDATE requests r
                SET status = $2,
                    occupied_by = CASE WHEN $2 = ANY($4::text[]) THEN '{}'::text[]
                                       ELSE r.occupied_by END
               FROM cur
              WHERE r.id = cur.id AND cur.occupied_by @> ARRAY[$3::text]
          RETURNING r.id, r.status, r.occupied_by, r.updated_at
         )
         SELECT cur.occupied_by AS holders, upd.id, upd.status, upd.occupied_by, upd.updated_at
           FROM cur LEFT JOIN upd ON true`,
        [id, status, viewerId, FINISHED]
    );
    if (rows.length === 0) return { ok: false, reason: 'not_found' };
    const row = rows[0];
    if (!row.id) return { ok: false, reason: 'forbidden', occupiedBy: row.holders || [] };
    return {
        ok: true,
        id: row.id.trim(),
        status: row.status,
        occupiedBy: row.occupied_by || [],
        updatedAt: row.updated_at,
    };
}

/**
 * How many people can hold one vehicle at the same time. A car is painted by a
 * pair at most: a third pair of hands on the same body is somebody standing
 * around, and the panel would have nowhere left to say who is doing what.
 *
 * The column CHECKs the same number (see server/schema.sql). This is where the
 * refusal comes from — the CHECK is what makes the rule true even if a query
 * here were to get it wrong.
 */
const MAX_HOLDERS = 2;

/**
 * Takes a request on a worker's behalf, if there is room left. The WHERE counts
 * who already holds it inside the very statement that adds, so two people
 * asking at once do not tread on each other: the second one sees it with one
 * place fewer and, if that was the last, changes no row and is told it is full.
 *
 * Returns { ok: true, occupiedBy } — the whole array, not just whoever has come
 * in — on success; { ok: false, reason } otherwise ('not_found' or 'full', the
 * latter with the codes of the people holding it).
 */
async function occupyRequest(id, workerId) {
    // Same single-statement shape as updateRequestStatus, for the same reason.
    const { rows } = await query(
        `WITH cur AS (
             SELECT id, occupied_by FROM requests WHERE id = $1 FOR UPDATE
         ), upd AS (
             UPDATE requests r SET occupied_by = r.occupied_by || $2::text
               FROM cur
              WHERE r.id = cur.id
                AND NOT (cur.occupied_by @> ARRAY[$2::text])
                AND cardinality(cur.occupied_by) < $3
          RETURNING r.id, r.occupied_by
         )
         SELECT cur.occupied_by AS holders, upd.id, upd.occupied_by AS taken
           FROM cur LEFT JOIN upd ON true`,
        [id, workerId, MAX_HOLDERS]
    );
    if (rows.length === 0) return { ok: false, reason: 'not_found' };
    const row = rows[0];
    if (row.id) return { ok: true, occupiedBy: row.taken || [] };
    const holders = row.holders || [];
    // Si ya la tenía este mismo trabajador, no es un error: ocupar lo que uno ya
    // ocupa es idempotente y se responde éxito.
    if (holders.indexOf(workerId) !== -1) return { ok: true, occupiedBy: holders };
    return { ok: false, reason: 'full', occupiedBy: holders };
}

/**
 * Drops a request on a worker's behalf. Each one drops their own: the WHERE
 * demands that their code be in `occupied_by`, and array_remove takes theirs
 * out and leaves the other person where they were.
 *
 * Returns { ok: true, occupiedBy } — who is still holding it — on releasing it
 * or when it was already free (idempotent); { ok: false, reason } otherwise
 * ('not_found', or 'forbidden' with the codes of the people holding it).
 */
async function releaseRequest(id, workerId) {
    const { rows } = await query(
        `WITH cur AS (
             SELECT id, occupied_by FROM requests WHERE id = $1 FOR UPDATE
         ), upd AS (
             UPDATE requests r SET occupied_by = array_remove(r.occupied_by, $2::text)
               FROM cur
              WHERE r.id = cur.id AND cur.occupied_by @> ARRAY[$2::text]
          RETURNING r.id, r.occupied_by
         )
         SELECT cur.occupied_by AS holders, upd.id, upd.occupied_by AS left_with
           FROM cur LEFT JOIN upd ON true`,
        [id, workerId]
    );
    if (rows.length === 0) return { ok: false, reason: 'not_found' };
    const row = rows[0];
    if (row.id) return { ok: true, occupiedBy: row.left_with || [] };
    const holders = row.holders || [];
    if (holders.length === 0) return { ok: true, occupiedBy: [] };
    return { ok: false, reason: 'forbidden', occupiedBy: holders };
}

/* -----------------------------------------------------------------------------
   worker_notes — what the boss has told each worker

   One row per worker (see server/schema.sql), so writing replaces rather than
   piles up. Only the boss writes; the worker reads their own on their profile.
-------------------------------------------------------------------------- */

/** Every note, for the boss's monitor. A handful of rows: no LIMIT needed. */
async function listWorkerNotes() {
    const { rows } = await query(
        'SELECT worker_id, note, written_by, updated_at FROM worker_notes'
    );
    return rows.map(mapNote);
}

/** One worker's note, or null. This is what rides along to their own profile. */
async function findWorkerNote(workerId) {
    const { rows } = await query(
        `SELECT worker_id, note, written_by, updated_at
           FROM worker_notes
          WHERE worker_id = $1`,
        [workerId]
    );
    return rows.length > 0 ? mapNote(rows[0]) : null;
}

/**
 * Writes the note, replacing whatever was there. Writing and replacing are the
 * same statement: with one row per worker there is no case where both a new
 * note and an old one exist, so there is nothing to decide between.
 *
 * `updated_at` is set here and not defaulted, because the DEFAULT only applies
 * to the INSERT half — an ON CONFLICT update would otherwise keep the date of
 * the first note forever, and the profile shows that date.
 */
async function setWorkerNote(workerId, note, writtenBy) {
    const { rows } = await query(
        `INSERT INTO worker_notes (worker_id, note, written_by)
              VALUES ($1, $2, $3)
         ON CONFLICT (worker_id) DO UPDATE
                 SET note = EXCLUDED.note,
                     written_by = EXCLUDED.written_by,
                     updated_at = now()
           RETURNING worker_id, note, written_by, updated_at`,
        [workerId, note, writtenBy]
    );
    return mapNote(rows[0]);
}

/** Takes the note away. Deleting one that is not there is not an error. */
async function clearWorkerNote(workerId) {
    await query('DELETE FROM worker_notes WHERE worker_id = $1', [workerId]);
}

function mapNote(row) {
    return {
        workerId: row.worker_id,
        note: row.note,
        writtenBy: row.written_by,
        updatedAt: row.updated_at,
    };
}

/**
 * Se llama al arrancar, para fallar con un mensaje claro si la base no está
 * levantada en vez de al primer cliente que envíe el formulario.
 *
 * `attempts` existe por las bases gestionadas, que suspenden el cómputo cuando
 * nadie las usa: el primer intento después de eso se agota mientras la base
 * despierta. Sin reintento, arrancar contra una base dormida mata el proceso
 * antes de abrir el puerto, y el alojamiento da el despliegue por fallido.
 *
 * Por omisión un solo intento, que es lo que corresponde en local: allí una
 * base que no responde es una base apagada, y esperar no la va a encender.
 */
async function ping(options) {
    const attempts = (options || {}).attempts || 1;
    for (let attempt = 1; ; attempt++) {
        try {
            await pool.query('SELECT 1');
            return;
        } catch (err) {
            if (attempt >= attempts) throw err;
            await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
        }
    }
}

/**
 * A qué base se conectó, para los mensajes de arranque.
 *
 * Nunca la contraseña: DATABASE_URL la lleva dentro, y estas líneas terminan
 * en el registro del alojamiento, que es justo donde no debe quedar escrita.
 */
function describe() {
    if (!DATABASE_URL) {
        return `${process.env.PGDATABASE || 'autocolor'} en localhost:${Number(process.env.PGPORT) || 5434}`;
    }
    try {
        const url = new URL(DATABASE_URL);
        return `${url.pathname.slice(1) || '(sin nombre)'} en ${url.host}`;
    } catch {
        return '(DATABASE_URL no se pudo leer)';
    }
}

module.exports = {
    createRequest, findRequest, listRequests, listOccupied, updateRequestStatus,
    createPaintOrder,
    occupyRequest, releaseRequest,
    listWorkerNotes, findWorkerNote, setWorkerNote, clearWorkerNote,
    ping, describe, pool, DATABASE_URL, unreachable,
};
