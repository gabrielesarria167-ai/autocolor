'use strict';

/* =============================================================================
   Access to the `autocolor` database: storing a request from the wizard,
   finding one by its code, and the ones the workshop panel uses: listing
   them, changing one's status, taking or releasing it, and seeing which ones
   somebody holds.

   Also the boss's note on each worker (worker_notes), which is the one thing
   here that is not about a request.
   ========================================================================== */

const crypto = require('node:crypto');
const { Pool } = require('pg');

// A hosted service hands the database over as a single URL. When DATABASE_URL
// is set it rules entirely (host, port, database, user, password and TLS all
// come from it) and the local block below is left alone.
//
// Two branches and not a mixed configuration on purpose:
// `new Pool({ connectionString, port: 5434 })` does not combine the two. pg
// does `Object.assign({}, config, parse(connectionString))`, so the URL
// overrides whatever sits beside it, and the 5434 would be written there
// meaning nothing.
const DATABASE_URL = process.env.DATABASE_URL || '';

const pool = new Pool(DATABASE_URL
    ? {
        connectionString: DATABASE_URL,
        max: 10,
        idleTimeoutMillis: 30_000,
        // More generous than locally: the managed database suspends compute
        // when nobody uses it, and the first connection after that pays for
        // the startup on top of the network and TLS.
        connectionTimeoutMillis: 15_000,
    }
    : {
        // Autocolor has its own Postgres server, on its own port; it does not
        // share a cluster with the machine's other projects (see
        // server/pgserver.sh). The port is written here and not left to libpq
        // precisely for that reason: without it, the default is the general
        // Postgres's 5432, and the application would end up writing to the
        // shared cluster without anyone noticing.
        host: process.env.PGHOST || 'localhost',
        port: Number(process.env.PGPORT) || 5434,
        database: process.env.PGDATABASE || 'autocolor',
        user: process.env.PGUSER,          // defaults to the system user
        password: process.env.PGPASSWORD,
        max: 10,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
    });

// node-postgres emits 'error' on the pool when an idle connection drops
// (Postgres restarted, the network cut, the server recycling it). In Node an
// 'error' from an EventEmitter with no listener is an uncaught exception, so
// without these lines a database restart is enough to kill the process.
//
// Not rethrown on purpose: the pool already discards the broken connection
// on its own, and the next query will open another. All that is needed is
// for it to be logged.
//
// Against a managed database this stops being a precaution and becomes the
// normal case: it suspends compute when nobody uses it and cuts idle
// connections itself, so the line shows up in the log now and then.
pool.on('error', (err) => {
    console.error('[db] conexión ociosa perdida:', err.message);
});

// A code of exactly 10 digits, with no leading zero so it always shows with
// its 10 figures. Random and not sequential: the code is the only credential
// for looking up a request, and a sequential one would let other customers'
// data be read by trying neighbouring numbers. crypto.randomInt also keeps
// codes from being predictable from a known one.
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

/* The managed database sleeps, and waking it takes longer than connecting.
 *
 * Neon suspends compute when nobody asks it anything (which for a workshop's
 * site is nearly all day) and the first connection after that pays the whole
 * startup. ping() already knew and retried four times AT STARTUP; the queries
 * after that retried none. So the first customer of the morning pressed
 * «Confirmar pedido», the connection timed out while the database woke, and
 * the exception went out through the general catch as a generic 500: «No
 * pudimos procesar la solicitud». The order was not stored and nothing said
 * anywhere that the database was to blame.
 *
 * What is retried is ONLY getting the connection, never the query. That
 * distinction is what makes this safe for an INSERT: if pool.connect()
 * fails, nothing was sent, and asking for a connection again cannot duplicate
 * an order. If the connection drops with the query already sent, it is not
 * retried: an error beats two identical orders with two different codes,
 * because the workshop prepares the second one and somebody pays for it.
 */
const UNREACHABLE_CODES = new Set([
    'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED',
    'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE',
    // The database shut down, is shutting down, or is still starting.
    '57P01', '57P02', '57P03',
]);

function unreachable(err) {
    const code = err && err.code ? String(err.code) : '';
    if (UNREACHABLE_CODES.has(code)) return true;
    // Class 08: Postgres's whole «connection exception» family.
    if (code.startsWith('08')) return true;
    // pg and pg-pool report these as plain Errors, with no code.
    // Three different wordings for the same thing, and all three have to be
    // named: pg-pool says "timeout exceeded when trying to connect" when it
    // times out waiting for a free connection (exactly what happens with the
    // database asleep), pg's Client says "timeout expired", and "Connection
    // terminated due to connection timeout" comes from a third place. None
    // carries a code. What must NOT go in here is a bare "timeout": that also
    // matches "canceling statement due to statement timeout" (57014), which is
    // a slow query or our own bug, not a database that is not there.
    return /timeout exceeded|timeout expired|connection timeout|connection terminated|socket hang up/i
        .test(err && err.message ? err.message : '');
}

const CONNECT_ATTEMPTS = 3;

/* Getting a connection, waiting for the database to wake if needed. The
 * waits grow (400ms, 800ms) because what is awaited is a startup, not a lost
 * packet, and added to the connectionTimeoutMillis above they give compute
 * well over half a minute to come up. */
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

/* The replacement for pool.query() throughout this file: gets the connection
 * with retries and sends the query exactly once. */
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
 * Stores a request and returns the assigned code.
 *
 * The code is drawn here and not in the database, so it can clash with one
 * already used. With 9,000 million possible codes that is very rare, but the
 * primary key turns it into a clean error (23505) instead of a silent
 * overwrite, and drawing again is enough.
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
                data.hex || null,
            ]);
            return { id: rows[0].id.trim(), status: rows[0].status, createdAt: rows[0].created_at };
        } catch (err) {
            if (err.code !== UNIQUE_VIOLATION || attempt === ID_ATTEMPTS) throw err;
        }
    }
    throw new Error('No se pudo generar un código libre'); // unreachable: the loop throws first
}

/**
 * Finds a request by its code. Returns only what is shown to whoever looks it
 * up, never the phone, the email or the notes: the code travels in messages
 * and on paper, and should not be enough to pull anyone's contact details.
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
        // Make and model are what the customer recognises as «their»
        // vehicle; `vehicle` (the 3D silhouette) remains for requests from
        // before the wizard asked for them.
        brand: row.brand,
        model: row.model,
        vehicle: row.vehicle,
        firstName: row.first_name,
        lastName: row.last_name,
        status: row.status,
    };
}

/* -----------------------------------------------------------------------------
   paint_orders: the matizado orders from pgs/paintings.html

   A table apart from `requests` because it is another business: nobody
   leaves a vehicle here. All they share is the shape of the code, drawn with
   the same generateId() and for the same reason.
-------------------------------------------------------------------------- */

const INSERT_PAINT_ORDER = `
    INSERT INTO paint_orders (id, method, brand, color_code, color_name, sw_code, finish,
                              reading_l, reading_a, reading_b,
                              size, units, price,
                              company, ruc, first_name, last_name,
                              department, province, phone, email, notes, hex)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
            $17, $18, $19, $20, $21, $22, $23)
    RETURNING id, status, created_at
`;

/**
 * Stores a matizado order and returns the assigned code.
 *
 * Same code draw and same retry on a clash as createRequest(): both codes
 * come from the same 10-digit space, even though they live in different
 * tables.
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
                data.hex || null,
            ]);
            return { id: rows[0].id.trim(), status: rows[0].status, createdAt: rows[0].created_at };
        } catch (err) {
            if (err.code !== UNIQUE_VIOLATION || attempt === ID_ATTEMPTS) throw err;
        }
    }
    throw new Error('No se pudo generar un código libre'); // unreachable: the loop throws first
}

const PAINT_ORDER_COLUMNS = `
    id, created_at, method, brand, color_code, color_name, finish, hex,
    size, units, price, company, first_name, last_name, phone, notes, status`;

function mapPaintOrder(row) {
    return {
        id: row.id.trim(),
        createdAt: row.created_at,
        method: row.method,
        brand: row.brand,
        colorCode: row.color_code,
        colorName: row.color_name,
        finish: row.finish,
        hex: row.hex,
        size: row.size,
        units: row.units,
        price: row.price,
        company: row.company,
        firstName: row.first_name,
        lastName: row.last_name,
        phone: row.phone,
        notes: row.notes,
        status: row.status,
    };
}

/**
 * The counter's queue of matizado orders for the workshop table, newest first,
 * optionally by status. Same ceiling as listRequests and for the same reason:
 * every order still open comes back whatever its age, and only the finished
 * ones (the part that grows without end) are capped at the 200 newest.
 *
 * No email, RUC, zone or reading: the table does not show them, and data that
 * does not need showing does not need fetching.
 */
async function listPaintOrders(options) {
    const status = (options || {}).status || null;
    const { rows } = await query(
        `SELECT ${PAINT_ORDER_COLUMNS}
           FROM paint_orders
          WHERE ($1::text IS NULL OR status = $1)
            AND (status <> ALL($2::text[]) OR id IN (
                    SELECT id FROM paint_orders
                     WHERE status = ANY($2::text[])
                       AND ($1::text IS NULL OR status = $1)
                     ORDER BY created_at DESC
                     LIMIT 200))
          ORDER BY created_at DESC`,
        [status, FINISHED]
    );
    return rows.map(mapPaintOrder);
}

/**
 * Moves a matizado order along. Nobody holds a paint order the way they hold a
 * vehicle (it is one tin mixed at the counter), so there is no «who may»
 * inside the statement: whoever is working the shift moves it. Returns the
 * order, or null when the code does not exist.
 */
async function updatePaintOrderStatus(id, status) {
    const { rows } = await query(
        `UPDATE paint_orders SET status = $2 WHERE id = $1
          RETURNING ${PAINT_ORDER_COLUMNS}`,
        [id, status]
    );
    return rows.length ? mapPaintOrder(rows[0]) : null;
}

/**
 * The boss defines an order the customer brought to be read at the counter:
 * the colour the spectrophotometer found, the container, and the price he
 * closes. Only those orders: one whose colour the customer chose on the page
 * was quoted on screen, and rewriting it here would change what they agreed to.
 * The method stays 'in_person', which is still how the colour was found.
 *
 * Returns { ok: true, order }, or { ok: false, reason }: 'not_found', or
 * 'not_in_person' when the order came with its colour already chosen.
 */
async function definePaintOrder(id, data) {
    const { rows } = await query(
        `WITH cur AS (
             SELECT id, method FROM paint_orders WHERE id = $1 FOR UPDATE
         ), upd AS (
             UPDATE paint_orders p
                SET brand = $2, color_code = $3, color_name = $4, finish = $5,
                    hex = $6, size = $7, units = $8, price = $9
               FROM cur
              WHERE p.id = cur.id AND cur.method = 'in_person'
          RETURNING p.*
         )
         SELECT cur.method AS current_method, upd.*
           FROM cur LEFT JOIN upd ON true`,
        [id, data.brand, data.colorCode, data.colorName, data.finish,
         data.hex, data.size, data.units, data.price]
    );
    if (rows.length === 0) return { ok: false, reason: 'not_found' };
    if (!rows[0].id) return { ok: false, reason: 'not_in_person' };
    return { ok: true, order: mapPaintOrder(rows[0]) };
}


/**
 * The workshop's work queue: the requests, newest first, optionally filtered
 * by status.
 *
 * It brings the phone, which `findRequest` hides on purpose. Here it does:
 * whoever reads this has already passed the workshop password, and calling
 * the customer is precisely the job. Email and notes stay out until needed.
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
 * available one is not touched (it has to be taken first) and neither is one
 * held by other people. The test goes in the WHERE itself so that the check and
 * the change are a single step, with no gap between "I looked at who holds it"
 * and "I changed it".
 *
 * Returns { ok: true, ... } with the row; or { ok: false, reason }: 'not_found'
 * when the code does not exist, 'forbidden' when the caller is not one of its
 * holders (with `occupiedBy`, the array of who is holding it, empty when it was
 * free), so that server.js answers 404 or 403. `updated_at` is the trigger's.
 *
 * `viewerId` is the session's code (see server/auth.js); it never arrives in
 * the request body, so it cannot be faked to touch somebody else's vehicle.
 */
//
// Either holder moves the work along: the two of them are on the same vehicle
// and asking which one of the pair may touch the status would only mean the
// other one waiting for them.
//
// Moving a job to a finished status also releases the vehicle, from both
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
 * refusal comes from; the CHECK is what makes the rule true even if a query
 * here were to get it wrong.
 */
const MAX_HOLDERS = 2;

/**
 * Takes a request on a worker's behalf, if there is room left. The WHERE counts
 * who already holds it inside the very statement that adds, so two people
 * asking at once do not tread on each other: the second one sees it with one
 * place fewer and, if that was the last, changes no row and is told it is full.
 *
 * Returns { ok: true, occupiedBy } (the whole array, not just whoever has come
 * in) on success; { ok: false, reason } otherwise ('not_found' or 'full', the
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
    // If this same worker already held it, it is not an error: taking what
    // one already holds is idempotent and answers success.
    if (holders.indexOf(workerId) !== -1) return { ok: true, occupiedBy: holders };
    return { ok: false, reason: 'full', occupiedBy: holders };
}

/**
 * Drops a request on a worker's behalf. Each one drops their own: the WHERE
 * demands that their code be in `occupied_by`, and array_remove takes theirs
 * out and leaves the other person where they were.
 *
 * Returns { ok: true, occupiedBy } (who is still holding it) on releasing it
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
   worker_notes: what the boss has told each worker

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
 * to the INSERT half: an ON CONFLICT update would otherwise keep the date of
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
 * Called at startup, to fail with a clear message if the database is not up
 * instead of on the first customer to send the form.
 *
 * `attempts` exists for managed databases, which suspend compute when nobody
 * uses them: the first attempt after that times out while the database
 * wakes. Without a retry, starting against a sleeping database kills the
 * process before the port opens, and the host marks the deploy as failed.
 *
 * By default a single attempt, which is right locally: there a database that
 * does not answer is a database that is off, and waiting will not turn it on.
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
 * Which database it connected to, for the startup messages.
 *
 * Never the password: DATABASE_URL carries it inside, and these lines end up
 * in the host's log, which is exactly where it must not be written.
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
    createPaintOrder, listPaintOrders, updatePaintOrderStatus, definePaintOrder,
    occupyRequest, releaseRequest,
    listWorkerNotes, findWorkerNote, setWorkerNote, clearWorkerNote,
    ping, describe, pool, DATABASE_URL, unreachable,
};
