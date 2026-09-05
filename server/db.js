'use strict';

/* =============================================================================
   Acceso a la base `autocolor`: guardar una solicitud del asistente, buscar
   una por su código, y las dos que usa el panel del taller — listarlas y
   cambiarle el estado a una.
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
    createRequest, findRequest, listRequests, updateRequestStatus,
    ping, describe, pool, DATABASE_URL,
};
