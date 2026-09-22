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
     GET   /api/staff/requests             lista la cola de trabajo
     POST  /api/staff/requests             registers a walk-in vehicle (boss only)
     GET   /api/staff/workers              who holds which vehicle (boss only)
     PUT   /api/staff/workers/:code/note   the boss's note on one worker
     PATCH /api/staff/requests/:id           cambia el estado de una solicitud
     PATCH /api/staff/requests/:id/occupancy ocupa o libera un vehículo

   Sin framework a propósito: el sitio es HTML y JS a secas, y el servidor
   necesita un puñado de rutas y archivos estáticos. La dependencia es una,
   `pg`: los avisos por correo salen por HTTPS y no necesitan biblioteca.

       npm install
       npm run db:init           # crea y levanta el Postgres propio (puerto 5434)
       npm start                 # http://localhost:3000

   PORT cambia el puerto del sitio. La base vive en su propio servidor
   Postgres, aparte del general de la máquina — ver server/pgserver.sh.
   ========================================================================== */

// El .env de la raíz, antes de leer cualquier variable de entorno (PORT,
// PGDATABASE, ALLOWED_ORIGINS y la contraseña del panel salen de ahí si están).
require('./env');

const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { promisify } = require('node:util');
const zlib = require('node:zlib');

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);
const {
    createRequest, findRequest, listRequests, listOccupied, updateRequestStatus,
    occupyRequest, releaseRequest, createPaintOrder,
    listWorkerNotes, findWorkerNote, setWorkerNote, clearWorkerNote,
    ping, describe, pool, DATABASE_URL, unreachable,
} = require('./db');
const auth = require('./auth');
const colordb = require('./colordb');
const names = require('./names');
const mail = require('./mail');
const netcheck = require('./netcheck');

const PORT = Number(process.env.PORT) || 3000;

// Loopback por omisión: detrás de /api/staff hay teléfonos de clientes, y no
// corresponde que aparezcan solos en la red del local por estar el servidor
// encendido. HOST=0.0.0.0 lo abre a la red a propósito (probar desde el móvil).
const HOST = process.env.HOST || '127.0.0.1';

// Cuántos proxies de confianza hay delante de este proceso. 0 —lo normal en
// esta máquina— significa que nadie lo intermedia y que la dirección del socket
// es la del cliente. Behind a proxy it is the number of hops that append to
// X-Forwarded-For: 3 on Render (see render.yaml), 1 behind a single nginx.
// clientIp() below is the only thing that uses it.
const TRUST_PROXY = Number(process.env.TRUST_PROXY) || 0;

const ROOT = path.join(__dirname, '..');
const MAX_BODY_BYTES = 32 * 1024;

// What this server serves: the files the site is made of, and nothing else.
//
// ROOT is the repository root, which also holds `.env` (the shop password),
// `server/`, `.git/`, the working notes (README.md, NEXT-STEPS.md, the
// gitignored LAUNCH-CHECKLIST.md), the design canvas and, on the work machine,
// hundreds of MB of .blend sources. A denylist had to name every one of those
// and quietly served whatever it forgot; an allowlist fails closed, so a file
// added at the root later is private until someone lists it here.
//
// A file is public when it sits under one of PUBLIC_DIRS (or is one of
// PUBLIC_FILES), has an extension in MIME, and no segment of its path is a
// dotfile or a `src/` source folder inside imgs/ (where the uncompressed GLBs
// live next to the served ones).
const PUBLIC_FILES = new Set(['/index.html', '/styles.css']);
const PUBLIC_DIRS = ['/pgs/', '/src/', '/imgs/', '/vendor/'];

// From an absolute path on disk to a path inside the repository, always with
// '/' whatever separator the system uses.
function repoPath(filePath) {
    return '/' + path.relative(ROOT, filePath).split(path.sep).join('/');
}

// Compared in lower case because the work machine's file system (APFS) is case
// insensitive: `GET /SERVER/auth.js` opens the same file as `/server/auth.js`,
// and has to be refused the same way.
function isPublic(pathname) {
    const lower = pathname.toLowerCase();
    if (!MIME[path.posix.extname(lower)]) return false;
    const segments = lower.split('/');
    if (segments.some((segment) => segment.startsWith('.'))) return false;
    if (lower.startsWith('/imgs/') && segments.includes('src')) return false;
    return PUBLIC_FILES.has(lower) || PUBLIC_DIRS.some((dir) => lower.startsWith(dir));
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
// Se calcula en cada solicitud y no una vez al cargar el módulo: el formulario
// (src/repair.js) lo calcula al abrir la página, así que un proceso que sigue
// vivo al pasar de año aceptaría en pantalla un año que después rechaza al
// enviar, con el formulario ya completo y sin manera de seguir.
function yearMax() {
    return new Date().getFullYear() + 1;
}
const MAX_MILEAGE = 2_000_000;
const QUALITIES = new Set(['standard', 'premium', 'custom']);
// Los estados por los que el taller mueve una solicitud.
//
// Hay tres copias de esta lista y ninguna puede leer a las otras: esta, la de
// src/statuses.js (lo que ve el cliente) y el CHECK de `status` en
// server/schema.sql, que es la última palabra. Agregar un estado son los tres
// sitios más la migración que amplíe el CHECK sobre la base existente.
const STATUSES = new Set([
    'recibido',
    'planchado', 'desmontaje_montaje', 'pintura', 'preparacion',
    'cuadrada', 'cristales', 'finitura',
    'listo', 'entregado', 'cancelado'
]);
const PHONE_RE = /^\+51[0-9]{9}$/;
const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const PART_RE = /^[A-Za-z0-9_]{1,40}$/;
const MAX_PARTS = 40;

// Los campos se nombran en minúscula ('el año', 'la placa') porque casi
// siempre aparecen a mitad de frase; cuando abren una, suben la inicial.
function capitalize(field) {
    return field.charAt(0).toUpperCase() + field.slice(1);
}

// El adjetivo concuerda con el nombre del campo, que es un sintagma con su
// género y su número: 'la placa' pide «válida», 'las notas' piden «largas» y
// además el verbo en plural. Con una sola plantilla en masculino singular
// salían «La placa no es válido.» y «Las notas es demasiado largo.», y estos
// mensajes se le muestran tal cual al cliente.
//
// `agree` va en cada campo que no sea masculino singular, que es lo de por
// omisión: 'f' femenino singular, 'fp' femenino plural.
const INVALID = { m: 'no es válido', f: 'no es válida', fp: 'no son válidas' };
const TOO_LONG = { m: 'es demasiado largo', f: 'es demasiado larga', fp: 'son demasiado largas' };

function text(value, { max, required = false, field, agree = 'm' }) {
    if (value === undefined || value === null || value === '') {
        if (required) throw new BadRequest(`Falta ${field}.`);
        return null;
    }
    if (typeof value !== 'string') throw new BadRequest(`${capitalize(field)} ${INVALID[agree]}.`);
    const trimmed = value.trim();
    if (required && trimmed === '') throw new BadRequest(`Falta ${field}.`);
    if (trimmed.length > max) throw new BadRequest(`${capitalize(field)} ${TOO_LONG[agree]}.`);
    return trimmed === '' ? null : trimmed;
}

// Los números llegan del formulario como texto ('2020', ''). Se convierten
// aquí, con su rango, para que la base reciba enteros o NULL y nunca la
// cadena vacía.
function integer(value, { min, max, required = false, field, agree = 'm' }) {
    if (value === undefined || value === null || value === '' ) {
        if (required) throw new BadRequest(`Falta ${field}.`);
        return null;
    }
    const number = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isInteger(number) || number < min || number > max) {
        throw new BadRequest(`${capitalize(field)} ${INVALID[agree]}.`);
    }
    return number;
}

// Which fields the public wizard demands. Everything the form asks for, which
// is everything the row can hold except the three it marks optional.
const WIZARD_REQUIRED = new Set([
    'vehicle', 'bodyType', 'plate', 'quality', 'parts', 'phone', 'email',
    'brand', 'model', 'year', 'firstName', 'lastName', 'department', 'province',
]);

// What the boss has to type for a vehicle driven straight to the shop. Less
// than the website asks, but not much: the customer is standing at the
// counter, which is the one moment the car itself can be looked at and the
// plate read off it. Everything that describes the vehicle and the job is
// wanted now — marca, modelo, placa and the panels to paint — because a row
// that arrives without them is one somebody has to chase the customer for
// later, and by then the car has been in the shop for a week.
//
// `notes` is the only thing left out, and it is the only one that can be:
// there is nothing to write down when the customer had nothing to say.
//
// What the website still asks for and this does not — `year`, `department`,
// `province`, `bodyType` — is not a judgement call, it is that the counter
// has no reason to ask. The body type arrives anyway, derived from the model
// (see intakePayload in src/staff.js).
//
// Anything outside the set is still checked when it arrives: a malformed plate
// is refused here exactly as it is on the website. Optional means it may be
// missing, not that it may be wrong.
const WALK_IN_REQUIRED = new Set([
    'vehicle', 'quality', 'phone', 'email', 'firstName', 'lastName',
    'brand', 'model', 'plate', 'parts',
]);

/**
 * Turns a request body into the row db.createRequest() writes, or throws a
 * BadRequest naming the first thing wrong with it.
 *
 * `required` is what separates the two callers. The website passes
 * WIZARD_REQUIRED and gets exactly the validation it has always had; the walk-in
 * form passes WALK_IN_REQUIRED. The rules themselves are shared, which is the
 * point: two validators would drift, and the one that drifted would be the one
 * nobody was looking at.
 */
function validateRequest(body, required) {
    if (!body || typeof body !== 'object') throw new BadRequest('Cuerpo inválido.');
    const need = (field) => required.has(field);

    if (!VEHICLES.has(body.vehicle)) throw new BadRequest('Tipo de vehículo no válido.');
    if (need('bodyType') || body.bodyType) {
        if (!BODY_TYPES.has(body.bodyType)) throw new BadRequest('Carrocería no válida.');
    }
    // El catálogo de marcas y modelos vive en el navegador (src/carModels.js),
    // así que aquí no hay contra qué contrastarlos: se comprueba que vengan y
    // que sean texto corto, igual que con las piezas del visor 3D.
    const plate = text(body.plate, { max: 7, required: need('plate'), field: 'la placa', agree: 'f' });
    if (plate && !PLATE_RE.test(plate.toUpperCase())) throw new BadRequest('La placa no es válida.');
    if (!QUALITIES.has(body.quality)) throw new BadRequest('Nivel de acabado no válido.');

    // Los dos formularios piden piezas, así que en la práctica el arreglo
    // vacío ya no llega de ninguno. Se sigue aceptando la ausencia como un
    // arreglo vacío —que es lo que la columna trae por omisión— y es
    // `required` quien lo rechaza abajo: así el error dice qué falta en vez
    // de «cuerpo inválido».
    const parts = Array.isArray(body.parts) ? body.parts : (body.parts == null ? [] : null);
    if (!parts) throw new BadRequest('Selecciona al menos una pieza.');
    if (need('parts') && parts.length === 0) throw new BadRequest('Selecciona al menos una pieza.');
    if (parts.length > MAX_PARTS) throw new BadRequest('Demasiadas piezas.');
    // Los ids de pieza salen del GLB de cada modelo ('hood', 'rear_door_left',
    // 'Object_26', …), así que se valida la forma y no una lista cerrada:
    // agregar un modelo nuevo no debería obligar a tocar el servidor.
    for (const part of parts) {
        if (typeof part !== 'string' || !PART_RE.test(part)) {
            throw new BadRequest('Pieza no válida.');
        }
    }

    const phone = text(body.phone, { max: 20, required: need('phone'), field: 'el teléfono' });
    if (phone && !PHONE_RE.test(phone)) throw new BadRequest('El teléfono debe tener 9 dígitos.');

    // El correo es obligatorio en los dos formularios: es por donde sale la
    // confirmación con el código de seguimiento (server/mail.js), así que una
    // solicitud sin él deja al cliente sin más forma de recuperarlo que llamar
    // al taller.
    const email = text(body.email, { max: 254, required: need('email'), field: 'el email' });
    if (email && !EMAIL_RE.test(email)) throw new BadRequest('El email no es válido.');

    return {
        brand: text(body.brand, { max: 40, required: need('brand'), field: 'la marca', agree: 'f' }),
        model: text(body.model, { max: 60, required: need('model'), field: 'el modelo' }),
        bodyType: body.bodyType || null,
        year: integer(body.year, { min: YEAR_MIN, max: yearMax(), required: need('year'), field: 'el año' }),
        plate: plate ? plate.toUpperCase() : null,
        mileage: integer(body.mileage, { min: 0, max: MAX_MILEAGE, field: 'el kilometraje' }),
        colorCode: text(body.colorCode, { max: 20, field: 'el código de color' }),
        vehicle: body.vehicle,
        quality: body.quality,
        parts: [...new Set(parts)],
        firstName: text(body.firstName, { max: 80, required: need('firstName'), field: 'el nombre' }),
        lastName: text(body.lastName, { max: 80, required: need('lastName'), field: 'el apellido' }),
        department: text(body.department, { max: 80, required: need('department'), field: 'el departamento' }),
        province: text(body.province, { max: 80, required: need('province'), field: 'la provincia', agree: 'f' }),
        phone,
        email,
        notes: text(body.notes, { max: 2000, field: 'las notas', agree: 'fp' }),
    };
}

/* -----------------------------------------------------------------------------
   Pedidos de matizado (pgs/paintings.html)

   Otro formulario y otra tabla, así que otra validación — pero los mismos
   ayudantes de arriba (text, integer) y los mismos mensajes en español, que es
   lo que hace que los dos formularios fallen igual.

   La regla que no se ve a simple vista: un pedido 'in_person' llega SIN color
   y SIN envase, y eso es correcto. El cliente va a traer el vehículo para que
   se lo midan, así que la fórmula no existe todavía y no hay nada que cotizar.
   Los otros dos caminos sí traen las dos cosas, y se exigen.
-------------------------------------------------------------------------- */

const PAINT_METHODS = new Set(['code', 'model', 'reading', 'in_person']);
const PAINT_FINISHES = new Set(['solido', 'metalico', 'perlado', 'tricapa']);
// Las seis fracciones de galón que vende el taller. La lista está también en
// SIZES (src/paints.js), que es la que dibuja las tarjetas, y en el CHECK de
// `size` (server/schema.sql), que es la última palabra.
const PAINT_SIZES = new Set(['1_32', '1_16', '1_8', '1_4', '1_2', '1_1']);
const MAX_UNITS = 20;
// El techo del precio guardado. No es una tarifa: es lo que impide que alguien
// mande un número absurdo al campo que el mostrador va a leer como «esto se le
// prometió en pantalla».
const MAX_PAINT_PRICE = 100_000;

/** Un valor de la lectura CIELAB, o null si el pedido no trae medición. */
function labValue(value, { min, max, field }) {
    if (value === undefined || value === null || value === '') return null;
    const number = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isFinite(number) || number < min || number > max) {
        throw new BadRequest(`${capitalize(field)} no es válido.`);
    }
    // Dos decimales, que es lo que entrega un espectrofotómetro y lo que
    // acepta la columna.
    return Math.round(number * 100) / 100;
}

function validatePaintOrder(body) {
    if (!body || typeof body !== 'object') throw new BadRequest('Cuerpo inválido.');
    if (!PAINT_METHODS.has(body.method)) throw new BadRequest('Forma de identificar el color no válida.');

    const inPerson = body.method === 'in_person';

    // El color. Se exige en los dos caminos que lo resuelven en pantalla, y se
    // acepta vacío en el que lo resuelve el taller.
    const colorCode = text(body.colorCode, { max: 20, required: !inPerson, field: 'el código de color' });
    // Opcional: sale de la base de colores, y un pedido resuelto con el
    // catálogo local o en el taller no lo trae. Se comprueba la forma, no que
    // exista: de eso se encarga la base, un paso más abajo.
    const swCode = text(body.swCode, { max: 12, field: 'el código Sherwin' });
    if (swCode && !/^[0-9A-Za-z-]{1,12}$/.test(swCode)) {
        throw new BadRequest('El código de color no es válido.');
    }
    const colorName = text(body.colorName, { max: 80, required: !inPerson, field: 'el nombre del color' });
    const brand = text(body.brand, { max: 40, required: !inPerson, field: 'la marca', agree: 'f' });
    if (body.finish || !inPerson) {
        if (!PAINT_FINISHES.has(body.finish)) throw new BadRequest('Acabado no válido.');
    }

    // La lectura digital: o vienen los tres valores o no viene ninguno. Dos de
    // tres no describen ningún color, y guardarlos sería guardar un dato falso.
    const reading = body.reading && typeof body.reading === 'object' ? {
        L: labValue(body.reading.L, { min: 0, max: 100, field: 'el valor L*' }),
        a: labValue(body.reading.a, { min: -128, max: 128, field: 'el valor a*' }),
        b: labValue(body.reading.b, { min: -128, max: 128, field: 'el valor b*' }),
    } : null;
    if (reading && (reading.L === null || reading.a === null || reading.b === null)) {
        throw new BadRequest('La lectura necesita los tres valores: L*, a* y b*.');
    }

    // El envase. Los tres campos del pedido —envase, unidades y precio— van
    // juntos: o están los tres o no está ninguno. Un pedido 'in_person' que
    // trajera unidades sin envase dejaría en la base un «3» de nada, así que
    // aquí se descartan en vez de guardarse a medias.
    if (!inPerson && !PAINT_SIZES.has(body.size)) throw new BadRequest('Envase no válido.');
    if (inPerson && body.size) throw new BadRequest('Un pedido con lectura en el taller no lleva envase.');

    const units = inPerson ? null
        : integer(body.units, { min: 1, max: MAX_UNITS, required: true, field: 'la cantidad', agree: 'f' });
    const price = inPerson ? null
        : integer(body.price, { min: 0, max: MAX_PAINT_PRICE, field: 'el precio' });

    const phone = text(body.phone, { max: 20, required: true, field: 'el teléfono' });
    if (!PHONE_RE.test(phone)) throw new BadRequest('El teléfono debe tener 9 dígitos.');

    // Opcional: si lo dejan, ahí mandamos el código del pedido; si no, el
    // taller se lo entrega por WhatsApp con el teléfono, que sí es obligatorio.
    const email = text(body.email, { max: 254, field: 'el email' });
    if (email && !EMAIL_RE.test(email)) throw new BadRequest('El email no es válido.');

    return {
        method: body.method,
        brand,
        colorCode,
        colorName,
        swCode: swCode || null,
        finish: body.finish || null,
        reading,
        size: inPerson ? null : body.size,
        units,
        price,
        company: text(body.company, { max: 120, required: true, field: 'el nombre del taller' }),
        ruc: null,
        firstName: text(body.firstName, { max: 80, required: true, field: 'el nombre' }),
        lastName: text(body.lastName, { max: 80, required: true, field: 'el apellido' }),
        department: null,
        province: null,
        phone,
        email: email || null,
        notes: text(body.notes, { max: 2000, field: 'las notas', agree: 'fp' }),
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

// '203.0.113.7:53411' y '[2001:db8::1]:443' -> la dirección sola. Algunos
// proxies añaden el puerto de origen; la mayoría, no.
function bareIp(value) {
    const trimmed = value.trim();
    const bracketed = /^\[(.+)\](?::\d+)?$/.exec(trimmed);
    if (bracketed) return bracketed[1];
    // Un solo ':' es 'IPv4:puerto'. Varios, una IPv6 escrita sin corchetes,
    // que hay que dejar entera.
    const first = trimmed.indexOf(':');
    if (first !== -1 && first === trimmed.lastIndexOf(':')) return trimmed.slice(0, first);
    return trimmed;
}

/**
 * La dirección del cliente: la clave de los tres límites por IP y lo que se
 * escribe en el registro de un intento fallido de contraseña.
 *
 * Sin proxy delante es la del socket y no hay más que hablar. Con proxy, la del
 * socket es la del proxy —la misma para todo el mundo—, y usarla funde los tres
 * cubos en uno solo: cinco contraseñas erradas de cualquier visitante y el
 * taller no puede entrar durante un minuto. Por eso hay que leer la cabecera.
 *
 * X-Forwarded-For se construye por AÑADIDO: cada proxy pega al final la
 * dirección de quien le habló. Si el cliente manda una inventada,
 *
 *     X-Forwarded-For: 9.9.9.9
 *
 * el proxy no la borra, añade la de verdad detrás:
 *
 *     X-Forwarded-For: 9.9.9.9, 200.1.2.3
 *                      ^inventada  ^la que escribió nuestro proxy
 *
 * Por eso se lee desde la DERECHA. Tomar el primer elemento —el error clásico,
 * y lo que recomienda la mitad de los tutoriales— le regala el límite a quien
 * ataca: cambia la dirección inventada en cada petición y el tope de cinco
 * intentos por minuto deja de existir; peor todavía, puede escribir la de otra
 * persona y dejarla fuera a ella.
 *
 * Con n proxies de confianza, los n últimos elementos son los que escribieron
 * ellos, y el cliente es el primero de esos n: list[list.length - n]. Leer
 * desde la izquierda se lo regala a quien inventa la cabecera; desde la
 * derecha, no, y sigue acertando aunque le pongan elementos de más delante.
 *
 * Lo que NO cubre: un proxy que REEMPLACE la cabecera en vez de añadir. Con
 * TRUST_PROXY=3 la lista quedaría con un solo elemento, la comprobación de
 * largo de más abajo salta y todos los visitantes vuelven a compartir la
 * dirección del socket —y con ella un único cubo de límite—, que es justo lo
 * que esto existe para evitar. Falla del lado seguro, pero en silencio: por eso
 * el aviso, que se escribe una vez y no en cada petición.
 */
let warnedShortChain = false;
function clientIp(req) {
    const socketIp = req.socket.remoteAddress || 'desconocida';
    if (TRUST_PROXY <= 0) return socketIp;

    const forwarded = String(req.headers['x-forwarded-for'] || '')
        .split(',')
        .map(bareIp)
        .filter(Boolean);

    // Menos saltos de los declarados: la petición no pasó por los proxies que
    // se esperaban —una comprobación de salud interna, o alguien hablándole al
    // contenedor directamente—. La del socket no la escribe nadie de fuera.
    if (forwarded.length < TRUST_PROXY) {
        // Si esto sale con una cabecera puesta, la topología dejó de ser la que
        // dice TRUST_PROXY y el límite por IP está contando a todos como uno.
        // Comprobarlo con /api/staff/whoami y ajustar el número.
        if (forwarded.length > 0 && !warnedShortChain) {
            warnedShortChain = true;
            console.warn(`\nAviso: x-forwarded-for trae ${forwarded.length} salto(s) y TRUST_PROXY=${TRUST_PROXY}.`);
            console.warn('El límite de peticiones cuenta a todos los visitantes como uno solo. Revísalo con /api/staff/whoami.\n');
        }
        return socketIp;
    }

    const candidate = forwarded[forwarded.length - TRUST_PROXY];

    // Que sea una dirección de verdad, y no solo por higiene: la RFC 7239
    // admite valores como 'unknown' o identificadores opacos, y esto termina de
    // clave en el Map de `buckets`. Sin la comprobación, quien llama elige
    // cadenas de cualquier largo que viven un minuto cada una.
    if (net.isIP(candidate) === 0) return socketIp;

    // '::ffff:200.1.2.3' y '200.1.2.3' son el mismo cliente; sin esto tendría
    // dos cubos y el doble de intentos.
    return candidate.startsWith('::ffff:') ? candidate.slice(7) : candidate;
}

// The rate-limit key for an address. IPv4 as is; IPv6 cut down to its /64,
// because one IPv6 client usually controls the whole /64 and could otherwise
// give every request a fresh address and a fresh bucket.
function rateKey(ip) {
    if (net.isIPv6(ip) !== true) return ip;
    const [head, tail = ''] = ip.split('::');
    const left = head ? head.split(':') : [];
    const right = tail ? tail.split(':') : [];
    const missing = ip.includes('::') ? 8 - left.length - right.length : 0;
    const groups = [...left, ...Array(Math.max(missing, 0)).fill('0'), ...right];
    return groups.slice(0, 4).map((group) => group.toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

// Whether a browser request comes from this site. Browsers send Origin on
// every POST, same-origin ones included, so a missing header means a client
// that is not a browser (the rate limit and the mail cap cover those). A
// present one has to be this site: otherwise any page on the internet could
// make its visitors submit the form, each from their own address, and send
// the shop's confirmation email wherever it liked.
//
// Several names count as "this site" because Render's Host is the one the
// visitor typed, the custom domain will add another, and ALLOWED_ORIGINS
// keeps working for a site hosted apart from the API.
function isOwnOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    if (ALLOWED_ORIGINS.has(origin)) return true;
    let host;
    try {
        host = new URL(origin).host;
    } catch {
        return false;
    }
    const own = [req.headers.host, req.headers['x-forwarded-host'], process.env.RENDER_EXTERNAL_URL, process.env.AUTOCOLOR_SITE_URL]
        .filter(Boolean)
        .map((value) => {
            try {
                return /^https?:\/\//.test(value) ? new URL(value).host : String(value).split(',')[0].trim();
            } catch {
                return '';
            }
        });
    return own.includes(host);
}

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

// A minute-long window bounds a burst. It does not bound patience: twenty
// requests a minute, kept up politely, is 28,800 a day. The colour catalogue is
// the one thing here worth copying wholesale, so it gets two counters a burst
// limit cannot give.
const DAY_MS = 24 * 60 * 60 * 1000;
const COLOUR_DAILY_PER_IP = Number(process.env.AUTOCOLOR_COLORDB_DAILY_IP) || 2_000;
const COLOUR_DAILY_TOTAL = Number(process.env.AUTOCOLOR_COLORDB_DAILY_TOTAL) || 60_000;

const colourDaily = new Map(); // clave -> { count, resetAt }
let colourTotal = { count: 0, resetAt: Date.now() + DAY_MS };
let colourCeilingLogged = false;

// Devuelve '' si la petición pasa, o el motivo por el que no.
function colourBudget(key) {
    const now = Date.now();

    if (now > colourTotal.resetAt) {
        colourTotal = { count: 0, resetAt: now + DAY_MS };
        colourCeilingLogged = false;
    }
    colourTotal.count += 1;
    if (colourTotal.count > COLOUR_DAILY_TOTAL) {
        // El renglón sale una vez al día y no una por petición: es una
        // anomalía que hay que mirar, no un renglón de tráfico.
        if (!colourCeilingLogged) {
            colourCeilingLogged = true;
            console.warn(`[colordb] techo diario alcanzado (${COLOUR_DAILY_TOTAL}).`
                + ' El buscador de colores queda apagado hasta mañana.');
        }
        return 'ceiling';
    }

    const seen = colourDaily.get(key);
    if (!seen || now > seen.resetAt) {
        colourDaily.set(key, { count: 1, resetAt: now + DAY_MS });
        return '';
    }
    seen.count += 1;
    return seen.count > COLOUR_DAILY_PER_IP ? 'ip' : '';
}

setInterval(() => {
    const now = Date.now();
    for (const [key, seen] of colourDaily) {
        if (now > seen.resetAt) colourDaily.delete(key);
    }
}, 60 * 60 * 1000).unref();

/* -----------------------------------------------------------------------------
   Utilidades HTTP
-------------------------------------------------------------------------- */

// `cache` is optional and defaults to no-store, which is what every existing
// call site wants: a quote, a request, a panel row. Only the colour catalogue
// passes anything else, because only it is the same for everyone and does not
// change between deploys.
function sendJson(res, status, payload, cache) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': cache || 'no-store',
    });
    res.end(body);
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        const onData = (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                // Stop buffering, but do not destroy the request: that tore the
                // socket down before the 400 below could be written, and the
                // browser reported a network failure instead of the reason.
                // Node closes the connection itself once the response ends with
                // the rest of the body unread.
                req.off('data', onData);
                req.pause();
                reject(new BadRequest('El formulario es demasiado grande.'));
                return;
            }
            chunks.push(chunk);
        };
        req.on('data', onData);
        req.on('end', () => {
            if (size > MAX_BODY_BYTES) return;
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
    // The photo credits in imgs/assets/stock-models/ stay reachable: the
    // licences of those photos ask for attribution.
    '.md': 'text/markdown; charset=utf-8',
};

// Worth compressing: text, and the GLBs, which are meshopt-encoded but still
// shrink by a quarter under brotli (meshopt is designed to be followed by a
// general-purpose compressor). PNG, JPEG, WebP and WOFF2 are already compressed.
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.glb', '.md']);

// Content hashes and compressed bodies, keyed by path, size and mtime so an
// edited file is never served from a stale entry. Each is computed once per
// process. Only compressible files keep their bytes in memory (about 40 MB
// raw plus 30 MB compressed, almost all of it the four models); photos keep
// just their hash and are streamed from disk.
const fileCache = new Map(); // key -> Promise<{ etag, buffer }> or Promise<Buffer>

function cacheKey(filePath, stat) {
    return `${filePath}:${stat.size}:${stat.mtimeMs}`;
}

function fileInfo(filePath, stat) {
    const key = cacheKey(filePath, stat);
    let entry = fileCache.get(key);
    if (!entry) {
        const keep = COMPRESSIBLE.has(path.extname(filePath).toLowerCase());
        entry = fsp.readFile(filePath).then((buffer) => ({
            // A hash of the content and not the mtime: every deploy checks the
            // repository out afresh, so an mtime-based validator would make each
            // visitor download every unchanged 10 MB model again after a deploy.
            etag: `"${crypto.createHash('sha1').update(buffer).digest('base64url')}"`,
            buffer: keep ? buffer : null,
        }));
        fileCache.set(key, entry);
        // Whatever failed (the file vanished between stat and read) is not kept.
        entry.catch(() => fileCache.delete(key));
    }
    return entry;
}

function compressed(filePath, stat, info, encoding) {
    const key = `${cacheKey(filePath, stat)}:${encoding}`;
    let entry = fileCache.get(key);
    if (!entry) {
        // Quality 5 for anything big: on the 12.6 MB pickup it takes 0.3 s and
        // lands within 1 % of quality 9, which takes 5.7 s.
        const quality = info.buffer.length > 1024 * 1024 ? 5 : 9;
        entry = encoding === 'br'
            ? brotli(info.buffer, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: quality } })
            : gzip(info.buffer, { level: 6 });
        fileCache.set(key, entry);
        entry.catch(() => fileCache.delete(key));
    }
    return entry;
}

function pickEncoding(req, ext) {
    if (!COMPRESSIBLE.has(ext)) return null;
    const accepted = String(req.headers['accept-encoding'] || '');
    if (/\bbr\b/.test(accepted)) return 'br';
    if (/\bgzip\b/.test(accepted)) return 'gzip';
    return null;
}

// Evicts the entries of older versions of a file that changed on disk, so
// editing styles.css all day does not keep every past version in memory.
function pruneFileCache(filePath, currentKey) {
    for (const key of fileCache.keys()) {
        if (key.startsWith(`${filePath}:`) && !key.startsWith(currentKey)) fileCache.delete(key);
    }
}

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

    // Checked against the resolved path and not the one that arrived:
    // '/pgs/../.env' starts with '/pgs/' but points somewhere else. A 404 and
    // not a 403, so probing names does not confirm which files exist.
    if (!isPublic(repoPath(filePath))) {
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
    // Everything is revalidated on every load, models included. File names
    // carry no version, and the pieces depend on each other: part ids in
    // src/carVisual.js are node names inside the GLB, and the hero's paint mask
    // has to match its photo pixel for pixel. A day of max-age on the models
    // alone meant a returning visitor could get today's script with yesterday's
    // model after a re-export. With a content-hash ETag the revalidation is a
    // 304 of a few hundred bytes whenever nothing changed.
    const cacheControl = 'no-cache';

    const info = await fileInfo(filePath, stat);
    pruneFileCache(filePath, cacheKey(filePath, stat));
    const encoding = pickEncoding(req, ext);
    const headers = {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': cacheControl,
        ETag: info.etag,
    };
    if (COMPRESSIBLE.has(ext)) headers.Vary = 'Accept-Encoding';

    const ifNoneMatch = String(req.headers['if-none-match'] || '');
    if (ifNoneMatch.split(',').some((tag) => tag.trim().replace(/^W\//, '') === info.etag)) {
        res.writeHead(304, headers).end();
        return;
    }

    if (!info.buffer) {
        headers['Content-Length'] = stat.size;
        res.writeHead(200, headers);
        if (req.method === 'HEAD') {
            res.end();
            return;
        }
        fs.createReadStream(filePath).on('error', () => res.destroy()).pipe(res);
        return;
    }

    const body = encoding ? await compressed(filePath, stat, info, encoding) : info.buffer;
    if (encoding) {
        headers['Content-Encoding'] = encoding;
        // three.js's FileLoader reads this before Content-Length to size its
        // progress events, and counts decompressed bytes. With only the
        // compressed length to go by, the 3D loading bar hit 100 % with a
        // quarter of the model still on its way.
        headers['X-File-Size'] = info.buffer.length;
    }
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
}

/* -----------------------------------------------------------------------------
   Rutas
-------------------------------------------------------------------------- */

const LOOKUP_PATH = /^\/api\/requests\/([0-9]{10})$/;

const COLOUR_MODELS_PATH = /^\/api\/colours\/makes\/([0-9]{1,5})\/models$/;
const COLOUR_ONE_PATH = /^\/api\/colours\/([0-9A-Za-z-]{1,12})$/;

// Una hora para las dos listas que no cambian entre despliegues, cinco minutos
// para los colores. `private` y no `public` en los colores a propósito: delante
// hay Cloudflare, y una caché compartida serviría a quien esté copiando el
// catálogo sin que ninguno de los contadores de arriba lo vea.
const COLOUR_LIST_CACHE = 'public, max-age=3600';
const COLOUR_ROW_CACHE = 'private, max-age=300';

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
const OCCUPANCY_PATH = /^\/api\/staff\/requests\/([0-9]{10})\/occupancy$/;
const WORKER_NOTE_PATH = /^\/api\/staff\/workers\/([A-Za-z]{2}[0-9]{5})\/note$/;

// Long enough for «Termina el Onix antes del viernes y avísame», short enough
// that the card can show it whole. The column CHECKs the same number.
const MAX_NOTE = 500;

// Every row of the panel carries, besides their codes, the names of the workers
// holding it. It is put together here and not in the database because the name
// is looked up from the code (see server/names.js) and that is the only place
// where it is decided. `occupiedBy` comes from the database; `holders` is the
// server's doing, and it is the shape the panel reads — one entry per person,
// up to the two the vehicle admits (MAX_HOLDERS in server/db.js).
function withHolders(request) {
    const codes = request.occupiedBy || [];
    return Object.assign({}, request, {
        holders: codes.map(function (workerId) {
            return { workerId: workerId, name: names.nameFor(workerId) };
        }),
    });
}

// «Ana Bravo y Carlos Díaz», for the refusals that have to say who is holding a
// vehicle. A code with no configured name is shown as the code (see
// server/names.js), because naming nobody says less than naming the code.
function holderNames(codes) {
    const named = (codes || []).map(function (workerId) {
        return names.nameFor(workerId) || workerId;
    });
    if (named.length === 0) return '';
    if (named.length === 1) return named[0];
    return named.slice(0, -1).join(', ') + ' y ' + named[named.length - 1];
}

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

// The monitor, writing a note on a worker and registering a walk-in vehicle are
// the boss's and nobody else's: all three are for running the workshop, not for
// working in it. A 403 and not a 404: whoever asks has a session and the route
// exists — what they do not have is the boss's code.
function requireBoss(req) {
    requireStaff(req);
    if (!auth.isBoss(auth.sessionWorkerId(req))) {
        throw new HttpError(403, 'Esto es solo para el jefe del taller.');
    }
}

// The other way round: the boss takes no vehicles and changes no statuses. His
// profile never offers him the controls, but the rule lives here like every
// other one (see server/db.js) and not in the browser. If he took one, he would
// show up as one more row in his own monitor.
function refuseBoss(req) {
    if (auth.isBoss(auth.sessionWorkerId(req))) {
        throw new HttpError(403, 'El jefe del taller no toma vehículos ni les cambia el estado.');
    }
}

// Qué dirección de cliente ve el servidor, y de qué cabecera la sacó.
//
// El límite por IP no se puede comprobar desde fuera: si falla, falla
// pareciendo que todo va bien. Y qué cabecera trae la dirección de verdad
// depende del alojamiento, no de lo que uno suponga — averiguarlo a ciegas,
// mirando si el límite salta o no, lleva a conclusiones equivocadas.
//
// Detrás de la contraseña del taller porque enseña la cadena de proxies. No
// dice nada que quien la consulta no sepa ya: su propia dirección.
function whoami(req, ip) {
    const workerId = auth.sessionWorkerId(req);
    const isBoss = auth.isBoss(workerId);
    const answer = {
        clientIp: ip,                                  // lo que usa el límite
        workerId,                                      // quién tiene la sesión
        isBoss,                                        // y si es el jefe del taller
    };
    // The proxy chain and the mail account are for whoever runs the workshop.
    // A worker checking their own session has no use for the shop inbox, the
    // Brevo endpoint or the hosting's internal headers.
    if (!isBoss) return answer;

    const forwarding = {};
    for (const [name, value] of Object.entries(req.headers)) {
        if (/^(x-forwarded|x-real-ip|forwarded|cf-|true-client-ip|fly-|x-render|x-client)/i.test(name)) {
            forwarding[name] = value;
        }
    }
    return Object.assign(answer, {
        socket: req.socket.remoteAddress,              // el último salto
        trustProxy: TRUST_PROXY,
        forwarding,                                    // de dónde podría salir
        mail: mail.describe(),                         // a qué cuenta salen los avisos
    });
}

async function handleStaff(req, res, pathname, ip) {
    if (pathname === '/api/staff/whoami' && req.method === 'GET') {
        requireStaff(req);
        return sendJson(res, 200, whoami(req, ip));
    }

    if (pathname === '/api/staff/login' && req.method === 'POST') {
        if (!auth.isConfigured()) {
            return sendJson(res, 503, { error: 'El panel del taller no está configurado en este servidor.' });
        }
        // Five FAILED attempts a minute: with one shared password, the limit is
        // what makes guessing it impractical. Only failures count, because the
        // whole shop signs in from one NAT address and a shift change is several
        // correct logins inside the same minute.
        const loginKey = `login:${rateKey(ip)}`;
        const failures = buckets.get(loginKey);
        if (failures && Date.now() <= failures.resetAt && failures.count >= 5) {
            return sendJson(res, 429, { error: 'Demasiados intentos. Espera un minuto.' });
        }
        // Sin códigos de trabajador configurados el panel quedaría abierto
        // a cualquiera con la contraseña: se responde 503, como cuando falta
        // la propia contraseña, en vez de dejar entrar sin identificar a nadie.
        if (!auth.hasWorkerIds()) {
            return sendJson(res, 503, { error: 'El panel del taller no está configurado en este servidor.' });
        }
        const body = requireObject(await readJsonBody(req));
        // Hacen falta los dos: un código de trabajador válido y la contraseña.
        // El error no dice cuál de los dos falló, para no revelar qué códigos
        // existen a quien prueba.
        // Both checks always run: short-circuiting on an unknown code skipped
        // the password hashing, and the faster answer told a prober which codes
        // do not exist.
        const workerId = auth.verifyWorkerId(body.workerId);
        const passwordOk = auth.verifyPassword(body.password);
        if (!workerId || !passwordOk) {
            rateLimit(loginKey, 5);
            console.warn(`[taller] intento fallido desde ${ip}`);
            return sendJson(res, 401, { error: 'Código de trabajador o contraseña incorrectos.' });
        }
        // console.log y no console.warn: aquí no ha pasado nada raro. En el
        // resto del archivo un warn marca una anomalía, y mezclar con ellos el
        // renglón más frecuente del registro los entierra.
        console.log(`[taller] entró ${workerId} desde ${ip}`);
        res.setHeader('Set-Cookie', auth.cookieHeader(auth.createSession(workerId)));
        return sendJson(res, 200, { ok: true, workerId });
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
        const requests = (await listRequests({ status: wanted })).map(withHolders);
        // Quién está mirando: el panel lo necesita para saber qué filas puede
        // tocar —una ocupada solo la mueve quien la tiene— sin volver a
        // preguntar por cada una.
        const viewerId = auth.sessionWorkerId(req);
        // `isBoss` decides which profile gets painted — the monitor instead of
        // the start-session button — and nothing else: it is the interface. Who
        // may ask for the monitor and who may take a vehicle is decided by
        // requireBoss and refuseBoss, here, without trusting the browser.
        // Their own note from the boss, and nobody else's: it rides here so the
        // profile — which this same response already paints — does not need a
        // second request for one line of text. The boss reads everybody's from
        // the monitor instead.
        const own = viewerId ? await findWorkerNote(viewerId) : null;
        const viewer = {
            workerId: viewerId,
            name: names.nameFor(viewerId),
            isBoss: auth.isBoss(viewerId),
            note: own ? { text: own.note, updatedAt: own.updatedAt } : null,
        };
        return sendJson(res, 200, { requests, viewer });
    }

    // A vehicle driven straight to the shop. Same table and same code as one
    // that came through the website — the queue does not care how a car
    // arrived — but fewer questions (WALK_IN_REQUIRED): the customer is at the
    // counter and has no reason to be asked for year, department or province.
    // Nothing can be edited from the panel afterwards, so what it does ask for
    // is required.
    //
    // No rate limit, unlike the public route: this one is behind the shop
    // password, and the ten-a-minute cap there would bite a shop booking three
    // cars in a row from a single address.
    if (pathname === '/api/staff/requests' && req.method === 'POST') {
        requireBoss(req);
        const data = validateRequest(await readJsonBody(req), WALK_IN_REQUIRED);
        const created = await createRequest(data);
        const viewerId = auth.sessionWorkerId(req);
        console.log(`[taller] ${created.id} registrado en el local por ${viewerId}`);
        // Queued before answering so the answer can say whether the customer's
        // email is on its way. notifyNewRequest() only fills a queue and never
        // throws, so a stumble in the mail still cannot fail the registration;
        // the sending itself happens afterwards, as on the public route.
        const queued = mail.notifyNewRequest(created, data, { walkIn: true });
        sendJson(res, 201, Object.assign({}, created, { mailQueued: !!(queued && queued.customer) }));
        return;
    }

    // The boss's monitor: every worker with the vehicles they are holding right
    // now.
    //
    // The roster comes from the configured list of codes and not from the
    // database, so somebody holding no vehicle shows up too, with an empty list.
    // Were it built from the database alone, an idle workshop would look exactly
    // like a workshop with no workers.
    if (pathname === '/api/staff/workers' && req.method === 'GET') {
        requireBoss(req);

        // Code -> its vehicles. Start from the roster and deal the database rows
        // on top of it.
        const held = new Map();
        for (const workerId of auth.listWorkerIds()) held.set(workerId, []);

        // The notes come along for the ride: the monitor draws them on the same
        // cards, and a second request would only be a second way for the two
        // halves of one screen to disagree.
        const notes = new Map();
        for (const note of await listWorkerNotes()) notes.set(note.workerId, note);

        for (const row of await listOccupied()) {
            // A vehicle held by two people is on both their cards: the board
            // answers «what is this person on», and leaving it off one of them
            // would show somebody as free while their hands are on a car.
            for (const workerId of row.occupiedBy) {
                // A code that is no longer on the roster — somebody who left
                // with a vehicle still taken — goes in anyway: leaving it out
                // would hide a vehicle that really is in somebody's hands.
                if (!held.has(workerId)) held.set(workerId, []);
                held.get(workerId).push({
                    id: row.id,
                    plate: row.plate,
                    brand: row.brand,
                    model: row.model,
                    status: row.status,
                    createdAt: row.createdAt,
                });
            }
        }

        const workers = Array.from(held, function ([workerId, requests]) {
            const note = notes.get(workerId);
            return {
                workerId: workerId,
                name: names.nameFor(workerId),
                requests: requests,
                // null and not an empty string: «no le he dicho nada» and «le
                // escribí una nota vacía» are different, and only the first one
                // exists (the column refuses a blank note).
                note: note ? { text: note.note, updatedAt: note.updatedAt } : null,
            };
        });
        // Whoever is working comes first, and within each group by name, which
        // is how the screen reads. Without this the order would be the one of the
        // code list, where somebody holding three vehicles can land at the end.
        workers.sort(function (a, b) {
            if ((a.requests.length > 0) !== (b.requests.length > 0)) {
                return a.requests.length > 0 ? -1 : 1;
            }
            return (a.name || a.workerId).localeCompare(b.name || b.workerId, 'es');
        });

        return sendJson(res, 200, { workers });
    }

    // The boss writes, replaces or removes the note on one worker. PUT and not
    // POST because there is at most one note per worker: sending the same body
    // twice leaves the same single note, not two.
    //
    // A body with text sets it; an empty one takes it away. That is one round
    // trip for both, and it matches what the card offers — a textarea you can
    // empty.
    const noteMatch = WORKER_NOTE_PATH.exec(pathname);
    if (noteMatch && req.method === 'PUT') {
        requireBoss(req);
        const workerId = noteMatch[1].toUpperCase();
        // Against the roster, not just against the shape: a typo would
        // otherwise write a note onto a code nobody has, where nobody would
        // ever read it and the boss would believe he had said something.
        if (auth.listWorkerIds().indexOf(workerId) === -1) {
            return sendJson(res, 404, { error: 'Ese código no es de ningún trabajador del taller.' });
        }

        const body = requireObject(await readJsonBody(req));
        const note = text(body.note, { max: MAX_NOTE, field: 'la nota', agree: 'f' });
        if (!note) {
            await clearWorkerNote(workerId);
            console.log(`[taller] nota de ${workerId} borrada`);
            return sendJson(res, 200, { workerId: workerId, note: null });
        }

        const saved = await setWorkerNote(workerId, note, auth.sessionWorkerId(req));
        console.log(`[taller] nota escrita a ${workerId}`);
        return sendJson(res, 200, {
            workerId: workerId,
            note: { text: saved.note, updatedAt: saved.updatedAt },
        });
    }

    if (req.method === 'PATCH') {
        const match = STAFF_PATH.exec(pathname);
        if (match) {
            requireStaff(req);
            refuseBoss(req);
            const viewerId = auth.sessionWorkerId(req);
            const body = requireObject(await readJsonBody(req));
            if (!STATUSES.has(body.status)) throw new BadRequest('El estado no es válido.');
            const result = await updateRequestStatus(match[1], body.status, viewerId);
            if (!result.ok && result.reason === 'not_found') {
                return sendJson(res, 404, { error: 'No encontramos ninguna solicitud con ese código.' });
            }
            // Solo quien ocupa el vehículo le cambia el estado. Si estaba
            // libre, el error dice que hay que tomarlo; si lo tienen otros, los
            // nombra para que quede claro a quién pedírselo.
            if (!result.ok) {
                const holding = holderNames(result.occupiedBy);
                const message = holding
                    ? `${holding} ${result.occupiedBy.length > 1 ? 'tienen' : 'tiene'} este vehículo. Solo quien lo tiene puede cambiarle el estado.`
                    : 'Toma el vehículo (columna «Ocupado») antes de cambiarle el estado.';
                return sendJson(res, 403, { error: message });
            }
            console.log(`[taller] ${result.id} -> ${result.status}`);
            return sendJson(res, 200, withHolders(result));
        }

        // Ocupar o liberar un vehículo. Mientras quede sitio —dos personas a la
        // vez como mucho— lo toma cualquiera; soltarlo solo puede quien lo
        // tiene, y suelta su parte y no la del otro. Las dos reglas las hace
        // cumplir la base (ver server/db.js), no este handler ni el navegador.
        const occ = OCCUPANCY_PATH.exec(pathname);
        if (occ) {
            requireStaff(req);
            refuseBoss(req);
            const viewerId = auth.sessionWorkerId(req);
            const body = requireObject(await readJsonBody(req));
            if (typeof body.occupied !== 'boolean') {
                throw new BadRequest('Falta indicar si se ocupa o se libera.');
            }

            if (body.occupied) {
                const result = await occupyRequest(occ[1], viewerId);
                if (!result.ok && result.reason === 'not_found') {
                    return sendJson(res, 404, { error: 'No encontramos ninguna solicitud con ese código.' });
                }
                // Lleno: ya lo tienen dos, que es el tope. Se nombra a los dos
                // —es a ellos a quienes hay que pedirles sitio— y el 409 es el
                // mismo de antes: la solicitud choca con cómo está la fila.
                if (!result.ok) {
                    const holding = holderNames(result.occupiedBy) || 'otros trabajadores';
                    return sendJson(res, 409, { error: `${holding} ya tienen este vehículo. Son dos personas como mucho.` });
                }
                console.log(`[taller] ${occ[1]} ocupado por ${viewerId}`);
                return sendJson(res, 200, withHolders({ id: occ[1], occupiedBy: result.occupiedBy }));
            }

            const result = await releaseRequest(occ[1], viewerId);
            if (!result.ok && result.reason === 'not_found') {
                return sendJson(res, 404, { error: 'No encontramos ninguna solicitud con ese código.' });
            }
            if (!result.ok) {
                const holding = holderNames(result.occupiedBy) || 'otro trabajador';
                return sendJson(res, 403, { error: `${holding} ${result.occupiedBy.length > 1 ? 'tienen' : 'tiene'} este vehículo. Cada uno suelta el suyo.` });
            }
            console.log(`[taller] ${occ[1]} liberado por ${viewerId}`);
            return sendJson(res, 200, withHolders({ id: occ[1], occupiedBy: result.occupiedBy }));
        }
    }

    return sendJson(res, 404, { error: 'Ruta no encontrada.' });
}

/* -----------------------------------------------------------------------------
   Colores

   El catálogo de Sherwin-Williams: 68.717 colores y 693.636 asociaciones
   vehículo-color, en una base aparte y de sólo lectura. Ver
   server/colordb/README.md.

   Todo lo que sale de aquí es del catálogo, no del cliente: no hay nada que
   proteger de una fuga de datos personales. Lo que hay que encarecer es
   copiarlo entero, y eso se hace en tres sitios a la vez —los límites dentro
   de las funciones de la base, los contadores de aquí, y que no exista
   ninguna consulta que devuelva «todos los colores»—.
-------------------------------------------------------------------------- */

// Un entero de la cadena de consulta, o null si no lo es. Rechaza en vez de
// redondear: `?make=12abc` es una petición mal formada, no la marca 12.
function intParam(params, name, min, max) {
    const raw = params.get(name);
    if (raw === null || raw === '') return null;
    if (!/^-?[0-9]{1,7}$/.test(raw)) return undefined;
    const value = Number(raw);
    if (value < min || value > max) return undefined;
    return value;
}

async function handleColours(req, res, pathname, ip) {
    if (req.method !== 'GET') {
        return sendJson(res, 405, { error: 'Método no permitido.' });
    }
    // En un GET del propio sitio el navegador no manda Origin, así que la
    // ausencia pasa. Lo que esto para es una página ajena leyendo el catálogo
    // desde el navegador de otro; no para a curl, y no pretende hacerlo.
    if (!isOwnOrigin(req)) {
        return sendJson(res, 403, { error: 'Consulta los colores desde el sitio.' });
    }
    if (!colordb.isEnabled()) {
        return sendJson(res, 503, {
            error: 'El buscador de colores no está disponible ahora mismo.',
        });
    }

    const key = rateKey(ip);
    const budget = colourBudget(key);
    if (budget === 'ceiling') {
        return sendJson(res, 503, {
            error: 'El buscador de colores no está disponible ahora mismo.',
        });
    }
    if (budget === 'ip') {
        return sendJson(res, 429, {
            error: 'Has consultado muchos colores hoy. Escríbenos por WhatsApp y te ayudamos.',
        });
    }

    const params = new URL(req.url, 'http://localhost').searchParams;

    try {
        if (pathname === '/api/colours/makes') {
            if (!rateLimit(`colour:list:${key}`, 30)) {
                return sendJson(res, 429, { error: 'Demasiadas consultas. Espera un minuto.' });
            }
            return sendJson(res, 200, { items: await colordb.makes() }, COLOUR_LIST_CACHE);
        }

        const models = COLOUR_MODELS_PATH.exec(pathname);
        if (models) {
            if (!rateLimit(`colour:list:${key}`, 30)) {
                return sendJson(res, 429, { error: 'Demasiadas consultas. Espera un minuto.' });
            }
            return sendJson(res, 200,
                { items: await colordb.models(Number(models[1])) }, COLOUR_LIST_CACHE);
        }

        if (pathname === '/api/colours/browse') {
            if (!rateLimit(`colour:browse:${key}`, 20)) {
                return sendJson(res, 429, { error: 'Demasiadas consultas. Espera un minuto.' });
            }
            const makeId = intParam(params, 'make', 1, 32767);
            const modelId = intParam(params, 'model', 1, 2147483647);
            const year = intParam(params, 'year', 1900, 2100);
            const from = intParam(params, 'from', 0, 600);
            // Siempre hace falta una marca: aquí no hay ninguna consulta que
            // conteste «todos los colores», que es justo la que serviría para
            // llevarse el catálogo.
            if (!makeId) {
                return sendJson(res, 400, { error: 'Elige la marca para ver sus colores.' });
            }
            if (modelId === undefined || year === undefined) {
                return sendJson(res, 400, { error: 'El modelo o el año no son válidos.' });
            }
            // Se rechaza en vez de recortar. La función de la base recorta a
            // 600 igual, pero contestar 200 con la última página otra vez
            // dejaría a «ver más» dando vueltas sobre las mismas filas.
            if (from === undefined) {
                return sendJson(res, 400, {
                    error: 'Afina el modelo o el año para ver el resto de colores.',
                });
            }
            const page = await colordb.coloursFor({ makeId, modelId, year, from: from || 0 });
            return sendJson(res, 200, page, COLOUR_ROW_CACHE);
        }

        if (pathname === '/api/colours/search') {
            if (!rateLimit(`colour:code:${key}`, 20)) {
                return sendJson(res, 429, { error: 'Demasiadas consultas. Espera un minuto.' });
            }
            const makeId = intParam(params, 'make', 1, 32767);
            const code = String(params.get('code') || '');
            if (!makeId) {
                return sendJson(res, 400, { error: 'Elige la marca del vehículo.' });
            }
            // El mismo recorte que hace la función de la base, para no gastar
            // un viaje en algo que va a rechazar igual.
            const key2 = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
            if (key2.length < 2 || key2.length > 10) {
                return sendJson(res, 400, { error: 'Escribe el código tal como viene en la etiqueta.' });
            }
            return sendJson(res, 200,
                { items: await colordb.colourByCode(makeId, code) }, COLOUR_ROW_CACHE);
        }

        const one = COLOUR_ONE_PATH.exec(pathname);
        if (one) {
            if (!rateLimit(`colour:one:${key}`, 30)) {
                return sendJson(res, 429, { error: 'Demasiadas consultas. Espera un minuto.' });
            }
            const colour = await colordb.colourById(one[1]);
            if (!colour) return sendJson(res, 404, { error: 'No encontramos ese color.' });
            return sendJson(res, 200, colour, COLOUR_ROW_CACHE);
        }
    } catch (err) {
        // Una base caída es un 503 y se puede reintentar; cualquier otra cosa
        // es un error nuestro y sube al 500 de siempre, que no cuenta nada.
        if (err instanceof colordb.ColourDbUnavailable) {
            return sendJson(res, 503, {
                error: 'El buscador de colores no está disponible ahora mismo.',
            });
        }
        throw err;
    }

    return sendJson(res, 404, { error: 'Ruta no encontrada.' });
}

/* El nombre del color lo dice la base, no el formulario.
 *
 * Cuando el pedido trae un swCode, se vuelve a resolver aquí antes de guardar.
 * No es desconfianza del cliente: es que el correo y la orden de taller se leen
 * como si fueran la base, y un campo de formulario que se quedó viejo —o que
 * alguien cambió— acabaría impreso como si lo fuera.
 *
 * Lo que NO se toca: colorCode sigue siendo el código de fábrica que el cliente
 * leyó en la etiqueta, y finish sigue siendo el que vio cuando se le cobró.
 * Pisar el primero pondría «20246» donde el taller espera «1F7» y dejaría a
 * colourHex() en mail.js sin encontrar la muestra; pisar el segundo cambiaría
 * el precio después de cobrarlo.
 *
 * Si la base no está, el pedido pasa igual. Un color sin confirmar se vende; un
 * pedido perdido, no.
 */
async function confirmColour(data) {
    if (!data.swCode || !colordb.isEnabled()) return;
    let colour;
    try {
        colour = await colordb.colourById(data.swCode);
    } catch (err) {
        console.warn(`[paint-orders] no se pudo confirmar el color ${data.swCode}: ${err.name}`);
        return;
    }
    if (!colour) {
        console.warn(`[paint-orders] swCode ${data.swCode} no existe en la base de colores`);
        data.swCode = null;
        return;
    }
    if (data.colorName !== colour.name) {
        console.warn(`[paint-orders] el nombre del color no coincide para ${data.swCode}:`
            + ` llegó "${data.colorName}", la base dice "${colour.name}"`);
        data.colorName = colour.name;
    }
    // La muestra del correo. Antes colourHex() la buscaba en el catálogo local
    // (server/paintCatalog.js, ~777 colores), así que un color de los 693k de
    // la base salía sin muestra. Aquí ya tenemos la fila de la base, con su hex,
    // así que lo guardamos para que el correo lo pinte sin volver a buscar.
    data.hex = colour.hex || '';
}

async function handleApi(req, res, pathname) {
    const ip = clientIp(req);
    if (applyCors(req, res)) return;

    if (pathname.startsWith('/api/staff/')) {
        return handleStaff(req, res, pathname, ip);
    }

    if (pathname.startsWith('/api/colours')) {
        return handleColours(req, res, pathname, ip);
    }

    if (req.method === 'POST' && pathname === '/api/requests') {
        // JSON only. A cross-site `<form enctype="text/plain">` can post a body
        // that parses as JSON, but it cannot set this header without a CORS
        // preflight, which this server does not grant to other sites.
        if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) {
            return sendJson(res, 415, { error: 'El formulario debe enviarse como JSON.' });
        }
        if (!isOwnOrigin(req)) {
            console.warn(`[requests] refused origin ${req.headers.origin} (host ${req.headers.host})`);
            return sendJson(res, 403, { error: 'Envía tu solicitud desde el formulario del sitio.' });
        }
        if (!rateLimit(`post:${rateKey(ip)}`, 10)) {
            return sendJson(res, 429, { error: 'Demasiadas solicitudes. Espera un minuto.' });
        }
        const data = validateRequest(await readJsonBody(req), WIZARD_REQUIRED);
        const created = await createRequest(data);
        console.log(`[requests] nueva solicitud ${created.id} (${data.vehicle}, ${data.parts.length} piezas)`);
        sendJson(res, 201, created);
        // Los dos correos salen DESPUÉS de contestar: la fila ya está guardada
        // y el cliente ya tiene su código, así que un tropiezo del correo no
        // puede convertirse en un error de la solicitud.
        //
        // Sin `await` y sin `.catch()` a propósito: notifyNewRequest() es
        // síncrona, se limita a poner los dos mensajes en una cola y no lanza
        // —ni siquiera si armar un cuerpo falla—, así que aquí no queda nada
        // colgando. Lo que tarden en salir es asunto de server/mail.js.
        mail.notifyNewRequest(created, data);
        return;
    }

    if (req.method === 'POST' && pathname === '/api/paint-orders') {
        // Las mismas tres puertas que /api/requests, por las mismas razones:
        // JSON de verdad, desde el sitio, y con un techo por IP.
        if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) {
            return sendJson(res, 415, { error: 'El formulario debe enviarse como JSON.' });
        }
        if (!isOwnOrigin(req)) {
            console.warn(`[paint-orders] refused origin ${req.headers.origin} (host ${req.headers.host})`);
            return sendJson(res, 403, { error: 'Envía tu pedido desde el formulario del sitio.' });
        }
        if (!rateLimit(`paint:${rateKey(ip)}`, 10)) {
            return sendJson(res, 429, { error: 'Demasiados pedidos. Espera un minuto.' });
        }
        const data = validatePaintOrder(await readJsonBody(req));
        await confirmColour(data);
        const created = await createPaintOrder(data);
        console.log(`[paint-orders] nuevo pedido ${created.id} (${data.method}` +
            `${data.colorCode ? `, ${data.brand} ${data.colorCode}` : ''}` +
            `${data.size ? `, ${data.size} x${data.units}` : ''})`);
        sendJson(res, 201, created);
        // Detrás de la respuesta y sin await, igual que los de una solicitud:
        // la fila ya está guardada y el cliente ya tiene su código, así que un
        // tropiezo del correo no puede convertirse en un error del pedido.
        mail.notifyNewPaintOrder(created, data);
        return;
    }

    if (req.method === 'GET') {
        const match = LOOKUP_PATH.exec(pathname);
        if (match) {
            if (!rateLimit(`get:${rateKey(ip)}`, 30)) {
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
    // A fixed base and not the Host header, and inside the try: `GET //` or a
    // Host such as `a b` make WHATWG URL throw, and a throw out here rejected the
    // handler with no response ever written, leaving the connection open.
    let pathname;
    try {
        pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
        sendJson(res, 400, { error: 'La dirección no es válida.' });
        return;
    }

    try {
        // La comprobación de salud del alojamiento. No toca la base a
        // propósito: el alojamiento reinicia el servicio cuando esta ruta
        // falla, así que preguntarle a Postgres convierte un tropiezo de la
        // base —o el segundo que tarda en despertar— en un reinicio, y cada
        // reinicio se lleva por delante las sesiones abiertas del panel. Lo
        // que hay que contestar aquí es «este proceso atiende HTTP», que es
        // exactamente lo que el alojamiento usa para decidir.
        //
        // Fuera de /api/ para que no pase por el CORS, ni por clientIp, ni por
        // el límite de peticiones. sendJson ya responde con Cache-Control:
        // no-store.
        if (pathname === '/healthz') {
            sendJson(res, 200, { ok: true });
            return;
        }
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
        // Una base que no responde no es un fallo del programa, y decir lo
        // mismo de las dos cosas le cuesta un pedido al taller: el cliente lee
        // «no pudimos procesar la solicitud», entiende que lo ha hecho mal y se
        // va. La base gestionada se duerme y tarda en despertar (ver connect()
        // en server/db.js, que ya reintenta tres veces antes de llegar aquí),
        // así que esto es una espera, no una avería, y se dice como tal.
        //
        // 503 y no 500 también para el registro: un 500 hay que ir a mirarlo,
        // un 503 contra una base que duerme se explica solo.
        if (unreachable(err)) {
            console.error('[db] no responde:', err.message);
            if (!res.headersSent) {
                sendJson(res, 503, {
                    error: 'La base de datos no responde en este momento. Espera un minuto y'
                        + ' vuelve a intentarlo; no se ha guardado nada todavía.',
                });
            }
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
        // Contra una base gestionada, varios intentos: suspende el cómputo
        // cuando nadie la usa y el primero después de eso se agota mientras
        // despierta. Aquí eso importa más que en cualquier otro sitio, porque
        // este ping corre ANTES de abrir el puerto: si falla, el proceso muere
        // sin escuchar y el alojamiento da el despliegue por fallido.
        //
        // En local, un solo intento y como estaba: allí una base que no
        // responde es una base apagada, y esperar no la va a encender.
        await ping({ attempts: DATABASE_URL ? 4 : 1 });
    } catch (err) {
        // Al no haber nadie escuchando en el puerto, Node agrupa un intento por
        // dirección (::1 y 127.0.0.1) en un AggregateError cuyo propio .message
        // viene vacío; sin esto el aviso terminaría en dos puntos y nada.
        const detail = err.message || (err.errors || []).map((e) => e.message).join('; ') || err.code || err;
        console.error(`\nNo se pudo conectar a la base ${describe()}: ${detail}`);
        if (DATABASE_URL) {
            // Mandar a levantar el Postgres de esta máquina sería mal consejo:
            // la base que no responde está en otro lado.
            console.error('\nRevisa DATABASE_URL en las variables del servicio.\n');
        } else {
            console.error('\nAutocolor usa su propio servidor Postgres, aparte del general de la');
            console.error('máquina. Para levantarlo (o crearlo, la primera vez):\n');
            console.error('    npm run db:start        # o  npm run db:init  la primera vez\n');
        }
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

    // Los dos avisos van contra la variable RENDER, que pone el propio
    // alojamiento, y no contra una regla general del tipo «HOST es público y
    // TRUST_PROXY está apagado»: esa saltaría con el HOST=0.0.0.0 que el README
    // recomienda para probar desde el móvil, que es legítimo. Así no hay
    // falsos positivos.
    if (process.env.RENDER && ['127.0.0.1', 'localhost', '::1'].includes(HOST)) {
        // Render da el despliegue por vivo escaneando el puerto, y solo ve lo
        // que esté atado a 0.0.0.0. Con la dirección de bucle el despliegue se
        // queda colgado sin más explicación que un tiempo agotado.
        console.warn(`\nAviso: HOST=${HOST} no es alcanzable desde fuera del contenedor. Hace falta HOST=0.0.0.0.\n`);
    }
    if (process.env.RENDER && TRUST_PROXY <= 0) {
        // Ver clientIp(): sin esto los tres límites por IP se funden en uno
        // solo, compartido por todos los visitantes.
        console.warn('\nAviso: falta TRUST_PROXY. El límite de peticiones cuenta a todos los visitantes como uno solo.\n');
    }

    server.listen(PORT, HOST, () => {
        console.log(`Autocolor en ${process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`}`);
        // DE QUÉ CÓDIGO ES ESTE PROCESO. Las dos variables las pone Render
        // sola; en esta máquina no hay ninguna y el renglón no sale.
        //
        // Está aquí porque ya costó una tarde: se puso una variable nueva en
        // el panel del alojamiento y no pasaba nada, y el motivo era que lo
        // desplegado seguía siendo una versión anterior que ni siquiera leía
        // esa variable. Todo lo que se mira para diagnosticar —los avisos del
        // correo, los de abajo— habla del código que está corriendo, así que
        // conviene que el registro diga cuál es antes que nada.
        if (process.env.RENDER_GIT_COMMIT) {
            const branch = process.env.RENDER_GIT_BRANCH || 'rama desconocida';
            console.log(`Desplegado: ${branch} @ ${process.env.RENDER_GIT_COMMIT.slice(0, 7)}`);
        }
        console.log(`Base de datos: ${describe()}`);
        // El panel pide las dos cosas: la contraseña y los códigos de
        // trabajador. Se nombra la que falte —o las dos—, porque el panel
        // apagado se ve desde dentro como un 503 y desde fuera como una
        // página rota, y adivinar cuál de las dos era cuesta una tarde.
        const faltan = [];
        if (!auth.isConfigured()) faltan.push('AUTOCOLOR_STAFF_PASSWORD');
        if (!auth.hasWorkerIds()) faltan.push('AUTOCOLOR_WORKER_IDS');
        if (faltan.length === 0) {
            const base = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
            console.log(`Panel del taller: ${base}/pgs/taller.html`);
        } else {
            console.log(`Panel del taller: apagado — falta ${faltan.join(' y ')}.`);
            console.log('  Escríbelo en el .env de la raíz (hay un .env.example al lado).');
        }
        // La base de colores se comprueba AQUÍ y no en start(), al revés
        // que la de solicitudes: aquella corre antes de abrir el puerto y
        // mata el proceso si falla, porque sin ella no hay presupuesto ni
        // panel. Los colores son una función de una página. Si esta base
        // no está, la página cae al catálogo local y el sitio sigue
        // vendiendo, así que un fallo aquí se cuenta y no se muere.
        if (colordb.isEnabled()) {
            colordb.ping({ attempts: 3 }).then(() => colordb.stats()).then((s) => {
                const built = s ? new Date(s.built_at).toISOString().slice(0, 10) : '?';
                console.log(`Base de colores: ${colordb.describe()}`);
                console.log(`  ${Number(s.colours).toLocaleString('es-PE')} colores`
                    + ` y ${Number(s.makes).toLocaleString('es-PE')} marcas, del ${built}.`);
            }).catch((err) => {
                console.error(`\nBase de colores: NO RESPONDE — ${err.message}`);
                console.error('  El buscador contestará 503 y la página usará el catálogo local.');
            });
        } else {
            console.log(`Base de colores: apagada — ${colordb.offMessage()}.`);
            console.log('  El buscador de colores usará solo el catálogo local'
                + ' (777 colores, 10 marcas).');
        }

        // Sin cuenta de correo el sitio funciona igual y las solicitudes se
        // guardan; lo que no sale es el aviso. Se dice para que nadie se
        // quede esperando un correo que nunca se intentó mandar.
        //
        // Y si la hay, se prueba de verdad: conectar y autenticar sin mandar
        // nada. El fallo del correo es invisible desde fuera —el sitio se ve
        // perfecto y las solicitudes se guardan—, así que la alternativa a
        // este renglón es enterarse días después, porque alguien no recibió
        // su código. No se espera para atender: la comprobación va por su
        // cuenta y el sitio ya está sirviendo.
        if (!mail.isConfigured()) {
            console.log('Correos de aviso: apagados — falta AUTOCOLOR_BREVO_KEY.');
        } else {
            mail.verify().then((result) => {
                if (result.ok) {
                    const m = mail.describe();
                    const account = result.account ? `, cuenta ${result.account}` : '';
                    console.log(`Correos de aviso: listos (Brevo, de ${m.from.name} <${m.from.email}>${account}).`);
                } else {
                    console.error(`\nCorreos de aviso: NO FUNCIONAN — ${result.error}`);
                    console.error('  Las solicitudes se siguen guardando; lo que no sale es el aviso.');
                    console.error('  Un 401 es la llave (AUTOCOLOR_BREVO_KEY); un 400 suele ser el');
                    console.error('  remitente, que tiene que estar verificado en Brevo → Senders.');
                    // Y se mira a dónde llega este alojamiento, porque «no
                    // funcionan» tiene tres causas que se arreglan de maneras
                    // distintas y el motivo de arriba no las distingue: ver
                    // server/netcheck.js. Solo cuando ya falló: en un
                    // despliegue sano esto no llega a correr.
                    return netcheck.run().then(({ lines, verdict }) => {
                        console.error('\n  A dónde llega este alojamiento:');
                        console.error(lines.join('\n'));
                        console.error('');
                        console.error(verdict.join('\n') + '\n');
                    });
                }
            }).catch((err) => {
                // El arranque no se cae por un renglón informativo.
                console.error(`Correos de aviso: no se pudo comprobar — ${err.message}`);
            });
        }
        if (ALLOWED_ORIGINS.size > 0) {
            console.log(`Orígenes permitidos: ${[...ALLOWED_ORIGINS].join(', ')}`);
        }
    });
}

// Una promesa rechazada sin dueño termina el proceso en Node 20 y siguientes.
// En un servidor eso es tirar el sitio entero —y todas las sesiones abiertas
// del panel— por un fallo de algo secundario, que casi siempre es un correo.
// Registrarlo y seguir es lo correcto: lo que no podía seguir era la
// solicitud, y esa ya se contestó mucho antes de llegar aquí.
process.on('unhandledRejection', (reason) => {
    console.error(`[server] promesa rechazada sin manejar: ${reason instanceof Error ? reason.stack : reason}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
        // EL ORDEN IMPORTA. Primero se deja de aceptar y se termina lo que ya
        // está en marcha; solo cuando no queda nadie sirviendo se abandonan la
        // cola del correo y el pool de la base. Al revés —como estaba— cada
        // despliegue y cada apagado por inactividad cortaba los avisos que
        // estuvieran saliendo en ese momento.
        server.close(() => {
            mail.close();
            pool.end().then(() => process.exit(0));
        });
    });
}

start();
