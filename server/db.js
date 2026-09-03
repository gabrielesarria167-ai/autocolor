'use strict';

/* =============================================================================
   Acceso a la base `autocolor`: guardar una solicitud del asistente, buscar
   una por su código, y las dos que usa el panel del taller — listarlas y
   cambiarle el estado a una.
   ========================================================================== */

const crypto = require('node:crypto');
const { Pool } = require('pg');

// Autocolor tiene su propio servidor Postgres, en su propio puerto — no
// comparte clúster con los demás proyectos de la máquina (ver
// server/pgserver.sh). El puerto va escrito aquí y no se deja en manos de
// libpq justamente por eso: sin él, el valor por omisión es el 5432 del
// Postgres general, y la aplicación terminaría escribiendo en el clúster
// compartido sin que nadie lo note.
const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT) || 5434,
    database: process.env.PGDATABASE || 'autocolor',
    user: process.env.PGUSER,          // por omisión, el usuario del sistema
    password: process.env.PGPASSWORD,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
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
            const { rows } = await pool.query(INSERT_REQUEST, [
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
    const { rows } = await pool.query(
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

/**
 * La cola de trabajo del taller: las solicitudes, la más reciente primero,
 * opcionalmente filtradas por estado.
 *
 * Trae el teléfono, que `findRequest` esconde a propósito. Aquí sí: quien lee
 * esto ya pasó por la contraseña del taller y llamar al cliente es justamente
 * el trabajo. El correo y las notas siguen fuera hasta que haga falta.
 *
 * El LIMIT no es paginación, es un tope: sin él, el día que la tabla tenga
 * miles de filas el panel las pediría todas de una vez.
 */
async function listRequests(options) {
    const status = (options || {}).status || null;
    const { rows } = await pool.query(
        `SELECT id, created_at, first_name, last_name, phone, brand, model,
                plate, quality, status, cardinality(parts) AS part_count
           FROM requests
          WHERE $1::text IS NULL OR status = $1
          ORDER BY created_at DESC
          LIMIT 200`,
        [status]
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
        partCount: Number(row.part_count),
    }));
}

/**
 * Cambia el estado de una solicitud. Devuelve null si el código no existe,
 * para poder responder 404 en vez de un éxito que no cambió nada.
 *
 * `updated_at` lo pone el trigger de la base (ver server/schema.sql), así que
 * no hay forma de actualizar una fila y dejar la fecha vieja.
 */
async function updateRequestStatus(id, status) {
    const { rows } = await pool.query(
        `UPDATE requests SET status = $2
          WHERE id = $1
      RETURNING id, status, updated_at`,
        [id, status]
    );
    if (rows.length === 0) return null;
    return { id: rows[0].id.trim(), status: rows[0].status, updatedAt: rows[0].updated_at };
}

// Se llama al arrancar, para fallar con un mensaje claro si la base no está
// levantada en vez de al primer cliente que envíe el formulario.
async function ping() {
    await pool.query('SELECT 1');
}

module.exports = { createRequest, findRequest, listRequests, updateRequestStatus, ping, pool };
