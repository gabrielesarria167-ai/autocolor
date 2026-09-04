'use strict';

/* =============================================================================
   Servidor de Autocolor.

   Sirve el sitio estático y las dos rutas que necesita el asistente:

     POST /api/requests      guarda una solicitud y devuelve su código
     GET  /api/requests/:id  consulta una solicitud por código

   Y las del panel del taller (pgs/taller.html), todas detrás de la contraseña
   compartida que se configura en server/auth.js:

     POST  /api/staff/login        abre sesión
     POST  /api/staff/logout       la cierra
     GET   /api/staff/requests     lista la cola de trabajo
     PATCH /api/staff/requests/:id cambia el estado de una solicitud

   Sin framework a propósito: el sitio es HTML y JS a secas, y el servidor
   necesita un puñado de rutas y archivos estáticos. La única dependencia es `pg`.

       npm install
       npm run db:init           # crea y levanta el Postgres propio (puerto 5434)
       npm start                 # http://localhost:3000

   PORT cambia el puerto del sitio. La base vive en su propio servidor
   Postgres, aparte del general de la máquina — ver server/pgserver.sh.
   ========================================================================== */

// El .env de la raíz, antes de leer cualquier variable de entorno (PORT,
// PGDATABASE, ALLOWED_ORIGINS y la contraseña del panel salen de ahí si están).
require('./env');

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createRequest, findRequest, listRequests, updateRequestStatus, ping, pool } = require('./db');
const auth = require('./auth');

const PORT = Number(process.env.PORT) || 3000;

// Loopback por omisión: detrás de /api/staff hay teléfonos de clientes, y no
// corresponde que aparezcan solos en la red del local por estar el servidor
// encendido. HOST=0.0.0.0 lo abre a la red a propósito (probar desde el móvil).
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = path.join(__dirname, '..');
const MAX_BODY_BYTES = 32 * 1024;

// Lo que este servidor no sirve nunca, pase lo que pase.
//
// ROOT es la raíz del repositorio, así que sin esta lista `GET /.env` devuelve
// el archivo con la contraseña del taller dentro, y `/server/auth.js` o
// `/.git/config` se leen igual de fácil. Que hoy no se note es solo porque se
// escucha en 127.0.0.1 (ver HOST arriba) — y el README recomienda 0.0.0.0 para
// probar desde el móvil, que es justo cuando dejaría de no notarse.
//
// Es el equivalente para este servidor de lo que _config.yml hace para GitHub
// Pages; ninguno de los dos sustituye al otro.
const DENY_PREFIXES = [
    '/.env',
    '/.git/',
    '/.gitignore',
    '/.claude/',
    '/server/',
    '/node_modules/',
    '/package.json',
    '/package-lock.json',
    '/_config.yml',
];

// De ruta absoluta en disco a ruta dentro del repositorio, siempre con '/'
// aunque el sistema use otro separador.
function repoPath(filePath) {
    return '/' + path.relative(ROOT, filePath).split(path.sep).join('/');
}

// 404 y no 403: un 403 confirma que el archivo está ahí, que es justo lo que no
// hace falta decirle a quien va probando nombres.
function isDenied(pathname) {
    return DENY_PREFIXES.some((prefix) => (
        prefix.endsWith('/') ? pathname.startsWith(prefix) : pathname === prefix
    ));
}

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

const VEHICLES = new Set(['van', 'wagon', 'pickup', 'suv']);
const BODY_TYPES = new Set(['sedan', 'hatchback', 'coupe', 'wagon', 'suv', 'pickup', 'minivan', 'van']);
const PLATE_RE = /^[A-Z0-9]{3}-[A-Z0-9]{3}$/;
const YEAR_MIN = 1980;
const YEAR_MAX = new Date().getFullYear() + 1;
const MAX_MILEAGE = 2_000_000;
const QUALITIES = new Set(['standard', 'premium', 'custom']);
// Los estados por los que el taller mueve una solicitud.
//
// Hay tres copias de esta lista y ninguna puede leer a las otras: esta, la de
// src/statuses.js (lo que ve el cliente) y el CHECK de `status` en
// server/schema.sql, que es la última palabra. Agregar un estado son los tres
// sitios más la migración que amplíe el CHECK sobre la base existente.
const STATUSES = new Set(['recibido', 'presupuestado', 'en_taller', 'listo', 'entregado', 'cancelado']);
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

// Errores que sí se le cuentan al cliente, con su código. Cualquier otro se
// convierte en un 500 genérico (ver el catch del servidor).
class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

class BadRequest extends HttpError {
    constructor(message) {
        super(400, message);
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

// JSON.parse('null'), 'true' o '3' son JSON válido pero no un objeto, y leerles
// una propiedad lanza TypeError: un 500 donde el cliente mandó algo mal. Es el
// mismo guardia que validateRequest ya hace para el formulario público.
function requireObject(body) {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        throw new BadRequest('El cuerpo de la petición no es válido.');
    }
    return body;
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
    // Un porcentaje suelto ('/%', '/%zz') hace que decodeURIComponent lance
    // URIError. Sin esto sube hasta el catch general y sale un 500 con su
    // rastro en el registro, cuando lo que hubo fue una dirección mal escrita.
    let decoded;
    try {
        decoded = decodeURIComponent(pathname);
    } catch {
        throw new BadRequest('La dirección no es válida.');
    }

    const filePath = path.join(ROOT, decoded === '/' ? 'index.html' : decoded);

    // path.join ya resuelve los '..', pero un '..' de más saldría de la carpeta
    // del proyecto y serviría cualquier archivo del disco: hay que comprobarlo.
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
        res.writeHead(403).end('Prohibido');
        return;
    }

    // La lista se comprueba sobre la ruta ya resuelta y no sobre la que llegó:
    // '/server/../.env' no empieza por '/.env', pero apunta ahí igual.
    if (isDenied(repoPath(filePath))) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado');
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
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
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

const STAFF_PATH = /^\/api\/staff\/requests\/([0-9]{10})$/;

// Todas las rutas del panel pasan por aquí. Sin contraseña configurada no hay
// panel: responder 503 y no 401 distingue «este servidor no lo tiene» de «tu
// sesión venció», que es lo que necesita saber quien lo está montando.
function requireStaff(req) {
    if (!auth.isConfigured()) {
        throw new HttpError(503, 'El panel del taller no está configurado en este servidor.');
    }
    if (!auth.readSession(req)) {
        throw new HttpError(401, 'Inicia sesión para ver el panel.');
    }
}

async function handleStaff(req, res, pathname, ip) {
    if (pathname === '/api/staff/login' && req.method === 'POST') {
        if (!auth.isConfigured()) {
            return sendJson(res, 503, { error: 'El panel del taller no está configurado en este servidor.' });
        }
        // Cinco intentos por minuto: con una sola contraseña compartida, el
        // límite es lo que hace inviable probarlas a ciegas.
        if (!rateLimit(`login:${ip}`, 5)) {
            return sendJson(res, 429, { error: 'Demasiados intentos. Espera un minuto.' });
        }
        const body = requireObject(await readJsonBody(req));
        if (!auth.verifyPassword(body.password)) {
            console.warn(`[taller] intento fallido desde ${ip}`);
            return sendJson(res, 401, { error: 'Contraseña incorrecta.' });
        }
        res.setHeader('Set-Cookie', auth.cookieHeader(auth.createSession()));
        return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/staff/logout' && req.method === 'POST') {
        auth.destroySession(auth.readToken(req));
        res.setHeader('Set-Cookie', auth.clearCookieHeader());
        return res.writeHead(204).end();
    }

    if (pathname === '/api/staff/requests' && req.method === 'GET') {
        requireStaff(req);
        const wanted = new URL(req.url, 'http://localhost').searchParams.get('status');
        if (wanted && !STATUSES.has(wanted)) throw new BadRequest('El estado no es válido.');
        return sendJson(res, 200, { requests: await listRequests({ status: wanted }) });
    }

    if (req.method === 'PATCH') {
        const match = STAFF_PATH.exec(pathname);
        if (match) {
            requireStaff(req);
            const body = requireObject(await readJsonBody(req));
            if (!STATUSES.has(body.status)) throw new BadRequest('El estado no es válido.');
            const updated = await updateRequestStatus(match[1], body.status);
            if (!updated) {
                return sendJson(res, 404, { error: 'No encontramos ninguna solicitud con ese código.' });
            }
            console.log(`[taller] ${updated.id} -> ${updated.status}`);
            return sendJson(res, 200, updated);
        }
    }

    return sendJson(res, 404, { error: 'Ruta no encontrada.' });
}

async function handleApi(req, res, pathname) {
    const ip = req.socket.remoteAddress || 'desconocida';
    if (applyCors(req, res)) return;

    if (pathname.startsWith('/api/staff/')) {
        return handleStaff(req, res, pathname, ip);
    }

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
        if (err instanceof HttpError) {
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
    // El puerto ocupado es el tropiezo más común al arrancar, y sin esto sale
    // como excepción no capturada con su rastro entero. Mismo trato que se le da
    // más arriba a la base que no responde.
    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`\nEl puerto ${PORT} ya está ocupado por otro proceso.`);
            console.error('\nPara ver cuál es y liberarlo:\n');
            console.error(`    lsof -nP -iTCP:${PORT} -sTCP:LISTEN`);
            console.error('    kill <PID>\n');
            console.error(`O arranca en otro puerto:  PORT=3001 npm start\n`);
        } else {
            console.error(`\nNo se pudo abrir el servidor: ${err.message}\n`);
        }
        process.exit(1);
    });

    server.listen(PORT, HOST, () => {
        console.log(`Autocolor en http://localhost:${PORT}`);
        console.log(`Base de datos: ${process.env.PGDATABASE || 'autocolor'}`);
        if (auth.isConfigured()) {
            console.log(`Panel del taller: http://localhost:${PORT}/pgs/taller.html`);
        } else {
            // El panel apagado se ve desde dentro como un 503 y desde fuera
            // como una página rota, así que aquí se dice qué falta y dónde.
            console.log('Panel del taller: apagado — falta AUTOCOLOR_STAFF_PASSWORD.');
            console.log('  Escríbela en el .env de la raíz (hay un .env.example al lado).');
        }
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
