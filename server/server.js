'use strict';

/* =============================================================================
   Servidor de Autocolor.

   Sirve el sitio estático y las dos rutas que necesita el asistente:

     POST /api/requests      guarda una solicitud y devuelve su código
     GET  /api/requests/:id  consulta una solicitud por código

   Sin framework a propósito: el sitio es HTML y JS a secas, y el servidor
   necesita dos rutas y archivos estáticos. La única dependencia es `pg`.

       npm install
       npm run db:init           # crea y levanta el Postgres propio (puerto 5433)
       npm start                 # http://localhost:3000

   PORT cambia el puerto del sitio. La base vive en su propio servidor
   Postgres, aparte del general de la máquina — ver server/pgserver.sh.
   ========================================================================== */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createRequest, findRequest, ping, pool } = require('./db');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(__dirname, '..');
const MAX_BODY_BYTES = 32 * 1024;

// Orígenes que pueden llamar a la API desde otro dominio, separados por comas:
//
//     ALLOWED_ORIGINS=https://gabrielesarria167-ai.github.io npm start
//
// Hace falta cuando el sitio se publica en un alojamiento estático (GitHub
// Pages y compañía) y la API corre en otro lado. Vacío por omisión: si el
// mismo servidor sirve el sitio y la API, no hay petición entre dominios que
// permitir, y una lista vacía es mejor que un comodín.
const ALLOWED_ORIGINS = new Set(
    (process.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
);

/* -----------------------------------------------------------------------------
   Validación

   El navegador ya valida el formulario, pero eso solo ayuda a quien lo usa
   como se espera: cualquiera puede llamar a la API directamente, así que lo
   que se guarda se revisa otra vez aquí. Los límites de largo son lo que
   impide que una solicitud llene la tabla de texto basura.
-------------------------------------------------------------------------- */

const VEHICLES = new Set(['van', 'wagon', 'pickup']);
const BODY_TYPES = new Set(['sedan', 'hatchback', 'coupe', 'wagon', 'suv', 'pickup', 'minivan', 'van']);
const PLATE_RE = /^[A-Z0-9]{3}-[A-Z0-9]{3}$/;
const YEAR_MIN = 1980;
const YEAR_MAX = new Date().getFullYear() + 1;
const MAX_MILEAGE = 2_000_000;
const QUALITIES = new Set(['standard', 'premium', 'custom']);
const PHONE_RE = /^\+51[0-9]{9}$/;
const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const PART_RE = /^[A-Za-z0-9_]{1,40}$/;
const MAX_PARTS = 40;

// Los campos se nombran en minúscula ('el año', 'la placa') porque casi
// siempre aparecen a mitad de frase; cuando abren una, suben la inicial.
function capitalize(field) {
    return field.charAt(0).toUpperCase() + field.slice(1);
}

function text(value, { max, required = false, field }) {
    if (value === undefined || value === null || value === '') {
        if (required) throw new BadRequest(`Falta ${field}.`);
        return null;
    }
    if (typeof value !== 'string') throw new BadRequest(`${capitalize(field)} no es válido.`);
    const trimmed = value.trim();
    if (required && trimmed === '') throw new BadRequest(`Falta ${field}.`);
    if (trimmed.length > max) throw new BadRequest(`${capitalize(field)} es demasiado largo.`);
    return trimmed === '' ? null : trimmed;
}

// Los números llegan del formulario como texto ('2020', ''). Se convierten
// aquí, con su rango, para que la base reciba enteros o NULL y nunca la
// cadena vacía.
function integer(value, { min, max, required = false, field }) {
    if (value === undefined || value === null || value === '' ) {
        if (required) throw new BadRequest(`Falta ${field}.`);
        return null;
    }
    const number = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isInteger(number) || number < min || number > max) {
        throw new BadRequest(`${capitalize(field)} no es válido.`);
    }
    return number;
}

function validateRequest(body) {
    if (!body || typeof body !== 'object') throw new BadRequest('Cuerpo inválido.');

    if (!VEHICLES.has(body.vehicle)) throw new BadRequest('Tipo de vehículo no válido.');
    if (!BODY_TYPES.has(body.bodyType)) throw new BadRequest('Carrocería no válida.');
    // El catálogo de marcas y modelos vive en el navegador (src/carModels.js),
    // así que aquí no hay contra qué contrastarlos: se comprueba que vengan y
    // que sean texto corto, igual que con las piezas del visor 3D.
    const plate = text(body.plate, { max: 7, required: true, field: 'la placa' }).toUpperCase();
    if (!PLATE_RE.test(plate)) throw new BadRequest('La placa no es válida.');
    if (!QUALITIES.has(body.quality)) throw new BadRequest('Nivel de acabado no válido.');

    const parts = Array.isArray(body.parts) ? body.parts : null;
    if (!parts || parts.length === 0) throw new BadRequest('Selecciona al menos una pieza.');
    if (parts.length > MAX_PARTS) throw new BadRequest('Demasiadas piezas.');
    // Los ids de pieza salen del GLB de cada modelo ('hood', 'rear_door_left',
    // 'Object_26', …), así que se valida la forma y no una lista cerrada:
    // agregar un modelo nuevo no debería obligar a tocar el servidor.
    for (const part of parts) {
        if (typeof part !== 'string' || !PART_RE.test(part)) {
            throw new BadRequest('Pieza no válida.');
        }
    }

    const phone = text(body.phone, { max: 20, required: true, field: 'el teléfono' });
    if (!PHONE_RE.test(phone)) throw new BadRequest('El teléfono debe tener 9 dígitos.');

    const email = text(body.email, { max: 254, field: 'el email' });
    if (email && !EMAIL_RE.test(email)) throw new BadRequest('El email no es válido.');

    return {
        brand: text(body.brand, { max: 40, required: true, field: 'la marca' }),
        model: text(body.model, { max: 60, required: true, field: 'el modelo' }),
        bodyType: body.bodyType,
        year: integer(body.year, { min: YEAR_MIN, max: YEAR_MAX, required: true, field: 'el año' }),
        plate,
        mileage: integer(body.mileage, { min: 0, max: MAX_MILEAGE, field: 'el kilometraje' }),
        colorCode: text(body.colorCode, { max: 20, field: 'el código de color' }),
        vehicle: body.vehicle,
        quality: body.quality,
        parts: [...new Set(parts)],
        firstName: text(body.firstName, { max: 80, required: true, field: 'el nombre' }),
        lastName: text(body.lastName, { max: 80, required: true, field: 'el apellido' }),
        department: text(body.department, { max: 80, field: 'el departamento' }),
        province: text(body.province, { max: 80, field: 'la provincia' }),
        phone,
        email,
        notes: text(body.notes, { max: 2000, field: 'las notas' }),
    };
}

class BadRequest extends Error {
    constructor(message) {
        super(message);
        this.status = 400;
    }
}

/* -----------------------------------------------------------------------------
   Límite de peticiones

   Una ventana fija por IP, en memoria. No pretende frenar un ataque serio —
   para eso hace falta algo delante del proceso — pero sí que un script pueda
   recorrer códigos de 10 dígitos a toda velocidad buscando nombres de
   clientes, que es el único dato personal que expone la consulta.
-------------------------------------------------------------------------- */

const WINDOW_MS = 60_000;
const buckets = new Map(); // clave -> { count, resetAt }

function rateLimit(key, limit) {
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || now > bucket.resetAt) {
        buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
        return true;
    }
    bucket.count += 1;
    return bucket.count <= limit;
}

// Las ventanas vencidas se acumularían para siempre si nadie las quita.
setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
        if (now > bucket.resetAt) buckets.delete(key);
    }
}, WINDOW_MS).unref();

/* -----------------------------------------------------------------------------
   Utilidades HTTP
-------------------------------------------------------------------------- */

function sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
    });
    res.end(body);
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new BadRequest('El formulario es demasiado grande.'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
            } catch {
                reject(new BadRequest('JSON inválido.'));
            }
        });
        req.on('error', reject);
    });
}

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.glb': 'model/gltf-binary',
    '.woff2': 'font/woff2',
};

async function serveStatic(req, res, pathname) {
    const decoded = decodeURIComponent(pathname);
    const filePath = path.join(ROOT, decoded === '/' ? 'index.html' : decoded);

    // path.join ya resuelve los '..', pero un '..' de más saldría de la carpeta
    // del proyecto y serviría cualquier archivo del disco: hay que comprobarlo.
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
        res.writeHead(403).end('Prohibido');
        return;
    }

    let stat;
    try {
        stat = await fsp.stat(filePath);
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado');
        return;
    }
    if (stat.isDirectory()) {
        res.writeHead(403).end('Prohibido');
        return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': stat.size,
        // Los modelos 3D pesan decenas de MB y no cambian; el resto se
        // revalida en cada carga para no servir código viejo mientras se
        // trabaja en el sitio.
        'Cache-Control': decoded.startsWith('/imgs/') ? 'public, max-age=86400' : 'no-cache',
    });
    if (req.method === 'HEAD') {
        res.end();
        return;
    }
    fs.createReadStream(filePath).on('error', () => res.destroy()).pipe(res);
}

/* -----------------------------------------------------------------------------
   Rutas
-------------------------------------------------------------------------- */

const LOOKUP_PATH = /^\/api\/requests\/([0-9]{10})$/;

// Devuelve true si la petición ya quedó contestada (un preflight OPTIONS).
function applyCors(req, res) {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.has(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        // El origen permitido depende de la cabecera Origin, así que las
        // cachés intermedias tienen que saber que la respuesta varía con ella.
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Max-Age', '86400');
    }
    if (req.method === 'OPTIONS') {
        // Sin cabeceras CORS arriba, el navegador rechazará el preflight por su
        // cuenta; responder 204 igualmente evita dejar la petición colgando.
        res.writeHead(204).end();
        return true;
    }
    return false;
}

async function handleApi(req, res, pathname) {
    const ip = req.socket.remoteAddress || 'desconocida';
    if (applyCors(req, res)) return;

    if (req.method === 'POST' && pathname === '/api/requests') {
        if (!rateLimit(`post:${ip}`, 10)) {
            return sendJson(res, 429, { error: 'Demasiadas solicitudes. Espera un minuto.' });
        }
        const data = validateRequest(await readJsonBody(req));
        const created = await createRequest(data);
        console.log(`[requests] nueva solicitud ${created.id} (${data.vehicle}, ${data.parts.length} piezas)`);
        return sendJson(res, 201, created);
    }

    if (req.method === 'GET') {
        const match = LOOKUP_PATH.exec(pathname);
        if (match) {
            if (!rateLimit(`get:${ip}`, 30)) {
                return sendJson(res, 429, { error: 'Demasiadas consultas. Espera un minuto.' });
            }
            const request = await findRequest(match[1]);
            if (!request) {
                return sendJson(res, 404, { error: 'No encontramos ninguna solicitud con ese código.' });
            }
            return sendJson(res, 200, request);
        }
        // Un código con un largo distinto no llega a la base: se responde lo
        // mismo que a uno inexistente para no delatar qué forma es la válida.
        if (pathname.startsWith('/api/requests/')) {
            return sendJson(res, 404, { error: 'No encontramos ninguna solicitud con ese código.' });
        }
    }

    return sendJson(res, 404, { error: 'Ruta no encontrada.' });
}

const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;

    try {
        if (pathname.startsWith('/api/')) {
            await handleApi(req, res, pathname);
            return;
        }
        if (req.method === 'GET' || req.method === 'HEAD') {
            await serveStatic(req, res, pathname);
            return;
        }
        sendJson(res, 405, { error: 'Método no permitido.' });
    } catch (err) {
        if (err instanceof BadRequest) {
            sendJson(res, err.status, { error: err.message });
            return;
        }
        // El detalle queda en el log del servidor; al cliente solo le llega que
        // falló, para no filtrar la estructura de la base en un mensaje de error.
        console.error('[error]', err);
        if (!res.headersSent) {
            sendJson(res, 500, { error: 'No pudimos procesar la solicitud. Inténtalo nuevamente.' });
        }
    }
});

async function start() {
    try {
        await ping();
    } catch (err) {
        // Al no haber nadie escuchando en el puerto, Node agrupa un intento por
        // dirección (::1 y 127.0.0.1) en un AggregateError cuyo propio .message
        // viene vacío; sin esto el aviso terminaría en dos puntos y nada.
        const detail = err.message || (err.errors || []).map((e) => e.message).join('; ') || err.code || err;
        console.error(`\nNo se pudo conectar a la base "${process.env.PGDATABASE || 'autocolor'}": ${detail}`);
        console.error('\nAutocolor usa su propio servidor Postgres, aparte del general de la');
        console.error('máquina. Para levantarlo (o crearlo, la primera vez):\n');
        console.error('    npm run db:start        # o  npm run db:init  la primera vez\n');
        process.exit(1);
    }
    server.listen(PORT, () => {
        console.log(`Autocolor en http://localhost:${PORT}`);
        console.log(`Base de datos: ${process.env.PGDATABASE || 'autocolor'}`);
        if (ALLOWED_ORIGINS.size > 0) {
            console.log(`Orígenes permitidos: ${[...ALLOWED_ORIGINS].join(', ')}`);
        }
    });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
        server.close(() => pool.end().then(() => process.exit(0)));
    });
}

start();
