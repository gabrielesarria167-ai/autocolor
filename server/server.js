'use strict';

/* =============================================================================
   The Autocolor server.

   Serves the static site and the two routes the wizard needs:

     POST /api/requests      stores a request and returns its code
     GET  /api/requests/:id  looks a request up by code

   And the workshop panel's (pgs/taller.html), all behind the shared
   password configured in server/auth.js:

     POST  /api/staff/login        opens a session
     POST  /api/staff/logout       closes it
     GET   /api/staff/requests             lists the work queue
     POST  /api/staff/requests             registers a walk-in vehicle (boss only)
     GET   /api/staff/workers              who holds which vehicle (boss only)
     PUT   /api/staff/workers/:code/note   the boss's note on one worker
     PATCH /api/staff/requests/:id           changes a request's status
     PATCH /api/staff/requests/:id/occupancy takes or releases a vehicle

   No framework on purpose: the site is plain HTML and JS, and the server
   needs a handful of routes and static files. There is one dependency,
   `pg`: the email notices go out over HTTPS and need no library.

       npm install
       npm run db:init           # creates and starts its own Postgres (port 5434)
       npm start                 # http://localhost:3000

   PORT changes the site's port. The database lives on its own Postgres
   server, apart from the machine's general one; see server/pgserver.sh.
   ========================================================================== */

// The root .env, before reading any environment variable (PORT, PGDATABASE,
// ALLOWED_ORIGINS and the panel password come from there if present).
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
    listPaintOrders, updatePaintOrderStatus, definePaintOrder,
    listWorkerNotes, findWorkerNote, setWorkerNote, clearWorkerNote,
    ping, describe, pool, DATABASE_URL, unreachable,
} = require('./db');
const auth = require('./auth');
const colordb = require('./colordb');
const names = require('./names');
const mail = require('./mail');
const netcheck = require('./netcheck');
const paints = require('../src/paints.js');

const PORT = Number(process.env.PORT) || 3000;

// Loopback by default: behind /api/staff there are customers' phone numbers,
// and they should not show up on the shop's network just because the server
// is on. HOST=0.0.0.0 opens it to the network on purpose (testing from a phone).
const HOST = process.env.HOST || '127.0.0.1';

// How many trusted proxies sit in front of this process. 0 (the normal case
// on this machine) means nobody sits in between and the socket address is the
// client's. Behind a proxy it is the number of hops that append to
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

// Origins that may call the API from another domain, comma-separated:
//
//     ALLOWED_ORIGINS=https://gabrielesarria167-ai.github.io npm start
//
// Needed when the site is published on a static host (GitHub Pages and
// friends) and the API runs elsewhere. Empty by default: if the same server
// serves the site and the API, there is no cross-origin request to allow, and
// an empty list beats a wildcard.
const ALLOWED_ORIGINS = new Set(
    (process.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
);

/* -----------------------------------------------------------------------------
   Validation

   The browser already validates the form, but that only helps whoever uses it
   as expected: anyone can call the API directly, so what gets stored is
   checked again here. The length limits are what stop a request from filling
   the table with junk text.
-------------------------------------------------------------------------- */

const VEHICLES = new Set(['van', 'wagon', 'pickup', 'suv']);
const BODY_TYPES = new Set(['sedan', 'hatchback', 'coupe', 'wagon', 'suv', 'pickup', 'minivan', 'van']);
const PLATE_RE = /^[A-Z0-9]{3}-[A-Z0-9]{3}$/;
const YEAR_MIN = 1980;
// Worked out on every request and not once at module load: the form
// (src/repair.js) works it out when the page opens, so a process still alive
// at the turn of the year would accept on screen a year it then rejects on
// sending, with the form already filled in and no way forward.
function yearMax() {
    return new Date().getFullYear() + 1;
}
const MAX_MILEAGE = 2_000_000;
const QUALITIES = new Set(['standard', 'premium', 'custom']);
// The statuses the workshop moves a request through.
//
// There are three copies of this list and none can read the others: this one,
// the one in src/statuses.js (what the customer sees) and the CHECK on
// `status` in server/schema.sql, which has the last word. Adding a status
// means those three places plus the migration that widens the CHECK.
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

// Field names are lower case ('el año', 'la placa') because they nearly
// always appear mid-sentence; when they open one, the initial goes up.
function capitalize(field) {
    return field.charAt(0).toUpperCase() + field.slice(1);
}

// The adjective agrees with the field name, which is a phrase with its own
// gender and number: 'la placa' wants «válida», 'las notas' want «largas» and
// a plural verb too. With a single masculine-singular template out came «La
// placa no es válido.» and «Las notas es demasiado largo.», and these messages
// are shown to the customer as they are.
//
// `agree` goes on every field that is not masculine singular, the default:
// 'f' feminine singular, 'fp' feminine plural.
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

// Numbers arrive from the form as text ('2020', ''). They are converted here,
// with their range, so the database gets integers or NULL and never the empty
// string.
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
// wanted now (marca, modelo, placa and the panels to paint) because a row
// that arrives without them is one somebody has to chase the customer for
// later, and by then the car has been in the shop for a week.
//
// `notes` is the only thing left out, and it is the only one that can be:
// there is nothing to write down when the customer had nothing to say.
//
// What the website still asks for and this does not (`year`, `department`,
// `province`, `bodyType`) is not a judgement call: the counter simply has no
// reason to ask. The body type arrives anyway, derived from the model (see
// intakePayload in src/staff.js).
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
    // The makes and models catalogue lives in the browser (src/carModels.js),
    // so there is nothing here to check them against: they must be present
    // and be short text, same as the 3D viewer's panels.
    const plate = text(body.plate, { max: 7, required: need('plate'), field: 'la placa', agree: 'f' });
    if (plate && !PLATE_RE.test(plate.toUpperCase())) throw new BadRequest('La placa no es válida.');
    if (!QUALITIES.has(body.quality)) throw new BadRequest('Nivel de acabado no válido.');

    // Both forms ask for panels, so in practice an empty array no longer
    // arrives from either. A missing value is still accepted as an empty
    // array (what the column holds by default) and `required` rejects it
    // below: that way the error says what is missing instead of «cuerpo
    // inválido».
    const parts = Array.isArray(body.parts) ? body.parts : (body.parts == null ? [] : null);
    if (!parts) throw new BadRequest('Selecciona al menos una pieza.');
    if (need('parts') && parts.length === 0) throw new BadRequest('Selecciona al menos una pieza.');
    if (parts.length > MAX_PARTS) throw new BadRequest('Demasiadas piezas.');
    // Panel ids come from each model's GLB ('hood', 'rear_door_left',
    // 'Object_26', and so on), so the shape is validated, not a closed list:
    // adding a new model should not force a change on the server.
    for (const part of parts) {
        if (typeof part !== 'string' || !PART_RE.test(part)) {
            throw new BadRequest('Pieza no válida.');
        }
    }

    const phone = text(body.phone, { max: 20, required: need('phone'), field: 'el teléfono' });
    if (phone && !PHONE_RE.test(phone)) throw new BadRequest('El teléfono debe tener 9 dígitos.');

    // Email is required on both forms: it is how the confirmation with the
    // tracking code goes out (server/mail.js), so a request without it leaves
    // the customer no way to get it back other than calling the workshop.
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
   Matizado orders (pgs/paintings.html)

   Another form and another table, so another validation, but the same
   helpers as above (text, integer) and the same Spanish messages, which is
   what makes both forms fail the same way.

   The rule that is not obvious at a glance: an 'in_person' order arrives
   WITHOUT a colour and WITHOUT a container, and that is correct. The
   customer is bringing the vehicle to be measured, so the formula does not
   exist yet and there is nothing to quote. The other routes do bring both,
   and they are required.
-------------------------------------------------------------------------- */

const PAINT_METHODS = new Set(['code', 'model', 'reading', 'in_person']);
const PAINT_FINISHES = new Set(['solido', 'metalico', 'perlado', 'tricapa']);
// The six gallon fractions the workshop sells. The list also lives in SIZES
// (src/paints.js), which draws the cards, and in the CHECK on `size`
// (server/schema.sql), which has the last word.
const PAINT_SIZES = new Set(['1_32', '1_16', '1_8', '1_4', '1_2', '1_1']);
const MAX_UNITS = 20;
// The ceiling for the stored price. It is not a rate: it is what stops anyone
// sending an absurd number to the field the counter will read as «this is what
// was promised on screen».
const MAX_PAINT_PRICE = 100_000;
// A matizado order's statuses. Another list, shorter than STATUSES: a
// matizado is received, prepared, ready and handed over. The copies are
// PAINT_ORDER in src/statuses.js and the CHECK on `paint_orders.status`
// (server/schema.sql), which has the last word.
const PAINT_STATUSES = new Set(['recibido', 'preparacion', 'listo', 'entregado', 'cancelado']);
const HEX_RE = /^#?([0-9a-fA-F]{6})$/;

/** A swatch as the column stores it, «#rrggbb» in lower case, or null. */
function normalizeHex(value) {
    const match = HEX_RE.exec(String(value || '').trim());
    return match ? '#' + match[1].toLowerCase() : null;
}

/** One value of the CIELAB reading, or null if the order has no measurement. */
function labValue(value, { min, max, field }) {
    if (value === undefined || value === null || value === '') return null;
    const number = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isFinite(number) || number < min || number > max) {
        throw new BadRequest(`${capitalize(field)} no es válido.`);
    }
    // Two decimals, which is what a spectrophotometer gives and what the
    // column accepts.
    return Math.round(number * 100) / 100;
}

/**
 * What the boss sends when he defines an order read at the counter: the colour
 * the spectrophotometer found, the container and the price he closes. Unlike
 * the customer's form, everything that describes the tin is required (this
 * is the step that turns «bring the car in» into an order that can be mixed)
 * except the swatch, which is only the table's hint of the colour.
 */
function validatePaintDefinition(body) {
    requireObject(body);
    const brand = text(body.brand, { max: 40, required: true, field: 'la marca', agree: 'f' });
    const colorCode = text(body.colorCode, { max: 20, required: true, field: 'el código de color' });
    const colorName = text(body.colorName, { max: 80, required: true, field: 'el nombre del color' });
    if (!PAINT_FINISHES.has(body.finish)) throw new BadRequest('Acabado no válido.');
    if (!PAINT_SIZES.has(body.size)) throw new BadRequest('Envase no válido.');
    let hex = null;
    if (body.hex !== undefined && body.hex !== null && body.hex !== '') {
        hex = normalizeHex(body.hex);
        if (!hex) throw new BadRequest('La muestra de color no es válida.');
    }
    return {
        brand,
        colorCode,
        colorName,
        finish: body.finish,
        hex,
        size: body.size,
        units: integer(body.units, { min: 1, max: MAX_UNITS, required: true, field: 'la cantidad', agree: 'f' }),
        price: integer(body.price, { min: 0, max: MAX_PAINT_PRICE, required: true, field: 'el precio' }),
    };
}

// The swatch for a row of the workshop table: the one stored with the order,
// else the page's local catalogue by brand and code (orders placed before
// the column existed, or a colour the colour database had no hex for). Empty
// when neither knows it; the table then draws the swatch as unknown rather
// than guess one.
function paintHex(order) {
    if (order.hex) return order.hex;
    if (!order.brand || !order.colorCode) return '';
    const wanted = order.brand.trim().toLowerCase();
    const brandId = Object.keys(paints.BRAND_NAMES)
        .find((id) => paints.BRAND_NAMES[id].toLowerCase() === wanted);
    const colour = brandId ? paints.findColour(brandId, order.colorCode) : null;
    return colour && colour.hex ? normalizeHex(colour.hex) || '' : '';
}

function withPaintHex(order) {
    return Object.assign({}, order, { hex: paintHex(order) });
}

function validatePaintOrder(body) {
    if (!body || typeof body !== 'object') throw new BadRequest('Cuerpo inválido.');
    if (!PAINT_METHODS.has(body.method)) throw new BadRequest('Forma de identificar el color no válida.');

    const inPerson = body.method === 'in_person';

    // The colour. Required on the routes that settle it on screen, accepted
    // empty on the one the workshop settles.
    const colorCode = text(body.colorCode, { max: 20, required: !inPerson, field: 'el código de color' });
    // Optional: it comes from the colour database, and an order settled with
    // the local catalogue or at the workshop does not carry it. The shape is
    // checked, not its existence: the database handles that, one step below.
    const swCode = text(body.swCode, { max: 12, field: 'el código Sherwin' });
    if (swCode && !/^[0-9A-Za-z-]{1,12}$/.test(swCode)) {
        throw new BadRequest('El código de color no es válido.');
    }
    const colorName = text(body.colorName, { max: 80, required: !inPerson, field: 'el nombre del color' });
    const brand = text(body.brand, { max: 40, required: !inPerson, field: 'la marca', agree: 'f' });
    if (body.finish || !inPerson) {
        if (!PAINT_FINISHES.has(body.finish)) throw new BadRequest('Acabado no válido.');
    }

    // The digital reading: all three values come or none do. Two of three
    // describe no colour, and storing them would be storing false data.
    const reading = body.reading && typeof body.reading === 'object' ? {
        L: labValue(body.reading.L, { min: 0, max: 100, field: 'el valor L*' }),
        a: labValue(body.reading.a, { min: -128, max: 128, field: 'el valor a*' }),
        b: labValue(body.reading.b, { min: -128, max: 128, field: 'el valor b*' }),
    } : null;
    if (reading && (reading.L === null || reading.a === null || reading.b === null)) {
        throw new BadRequest('La lectura necesita los tres valores: L*, a* y b*.');
    }

    // The container. The order's three fields (container, units and price) go
    // together: all three or none. An 'in_person' order carrying units with no
    // container would leave a «3» of nothing in the database, so they are
    // dropped here instead of being half stored.
    if (!inPerson && !PAINT_SIZES.has(body.size)) throw new BadRequest('Envase no válido.');
    if (inPerson && body.size) throw new BadRequest('Un pedido con lectura en el taller no lleva envase.');

    const units = inPerson ? null
        : integer(body.units, { min: 1, max: MAX_UNITS, required: true, field: 'la cantidad', agree: 'f' });
    const price = inPerson ? null
        : integer(body.price, { min: 0, max: MAX_PAINT_PRICE, field: 'el precio' });

    const phone = text(body.phone, { max: 20, required: true, field: 'el teléfono' });
    if (!PHONE_RE.test(phone)) throw new BadRequest('El teléfono debe tener 9 dígitos.');

    // Optional: if they leave it, the order code goes there; if not, the
    // workshop sends it over WhatsApp to the phone, which is required.
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

// Errors that are told to the customer, with their code. Anything else
// becomes a generic 500 (see the server's catch).
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
   Rate limiting

   A fixed window per IP, in memory. It does not pretend to stop a serious
   attack (that needs something in front of the process) but it does stop a
   script walking 10-digit codes at full speed looking for customer names,
   which is the only personal data the lookup exposes.
-------------------------------------------------------------------------- */

// '203.0.113.7:53411' and '[2001:db8::1]:443' -> the bare address. Some
// proxies append the source port; most do not.
function bareIp(value) {
    const trimmed = value.trim();
    const bracketed = /^\[(.+)\](?::\d+)?$/.exec(trimmed);
    if (bracketed) return bracketed[1];
    // A single ':' is 'IPv4:port'. Several mean an IPv6 written without
    // brackets, which has to be left whole.
    const first = trimmed.indexOf(':');
    if (first !== -1 && first === trimmed.lastIndexOf(':')) return trimmed.slice(0, first);
    return trimmed;
}

/**
 * The client's address: the key for the three per-IP limits and what gets
 * written in the log of a failed password attempt.
 *
 * With no proxy in front it is the socket's and that is that. With a proxy,
 * the socket's is the proxy's (the same for everybody), and using it merges
 * the three buckets into one: five wrong passwords from any visitor and the
 * workshop cannot log in for a minute. That is why the header has to be read.
 *
 * X-Forwarded-For is built by APPENDING: each proxy adds at the end the
 * address of whoever talked to it. If the client sends a made-up one,
 *
 *     X-Forwarded-For: 9.9.9.9
 *
 * the proxy does not remove it, it appends the real one after it:
 *
 *     X-Forwarded-For: 9.9.9.9, 200.1.2.3
 *                      ^made up    ^written by our proxy
 *
 * That is why it is read from the RIGHT. Taking the first element (the
 * classic mistake, and what half the tutorials recommend) hands the limit to
 * the attacker: they change the made-up address on each request and the cap
 * of five attempts a minute stops existing; worse still, they can write
 * someone else's and lock that person out.
 *
 * With n trusted proxies, the last n elements are the ones they wrote, and
 * the client is the first of those n: list[list.length - n]. Reading from the
 * left hands it to whoever forges the header; from the right it does not,
 * and it stays right even if extra elements are put in front.
 *
 * What it does NOT cover: a proxy that REPLACES the header instead of
 * appending. With TRUST_PROXY=3 the list would have a single element, the
 * length check below trips and every visitor shares the socket address again
 * (and with it a single limit bucket), which is exactly what this exists to
 * prevent. It fails safe, but silently: hence the warning, written once and
 * not on every request.
 */
let warnedShortChain = false;
function clientIp(req) {
    const socketIp = req.socket.remoteAddress || 'desconocida';
    if (TRUST_PROXY <= 0) return socketIp;

    const forwarded = String(req.headers['x-forwarded-for'] || '')
        .split(',')
        .map(bareIp)
        .filter(Boolean);

    // Fewer hops than declared: the request did not come through the expected
    // proxies (an internal health check, or someone talking to the container
    // directly). Nobody outside writes the socket's address.
    if (forwarded.length < TRUST_PROXY) {
        // If this shows up with a header set, the topology is no longer what
        // TRUST_PROXY says and the per-IP limit is counting everyone as one.
        // Check it with /api/staff/whoami and adjust the number.
        if (forwarded.length > 0 && !warnedShortChain) {
            warnedShortChain = true;
            console.warn(`\nAviso: x-forwarded-for trae ${forwarded.length} salto(s) y TRUST_PROXY=${TRUST_PROXY}.`);
            console.warn('El límite de peticiones cuenta a todos los visitantes como uno solo. Revísalo con /api/staff/whoami.\n');
        }
        return socketIp;
    }

    const candidate = forwarded[forwarded.length - TRUST_PROXY];

    // It must be a real address, and not only for hygiene: RFC 7239 allows
    // values like 'unknown' or opaque identifiers, and this ends up as a key
    // in the `buckets` Map. Without the check, the caller picks strings of any
    // length that live a minute each.
    if (net.isIP(candidate) === 0) return socketIp;

    // '::ffff:200.1.2.3' and '200.1.2.3' are the same client; without this it
    // would get two buckets and twice the attempts.
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

// Expired windows would pile up forever if nobody removed them.
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

// Returns '' if the request passes, or the reason it does not.
function colourBudget(key) {
    const now = Date.now();

    if (now > colourTotal.resetAt) {
        colourTotal = { count: 0, resetAt: now + DAY_MS };
        colourCeilingLogged = false;
    }
    colourTotal.count += 1;
    if (colourTotal.count > COLOUR_DAILY_TOTAL) {
        // The line goes out once a day and not once per request: it is an
        // anomaly to look into, not a line of traffic.
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

// JSON.parse('null'), 'true' or '3' are valid JSON but not an object, and
// reading a property off them throws TypeError: a 500 where the client sent
// something wrong. It is the same guard validateRequest already applies to the public form.
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
    // A stray percent sign ('/%', '/%zz') makes decodeURIComponent throw
    // URIError. Without this it climbs to the general catch and comes out as a
    // 500 with its trace in the log, when all that happened was a mistyped address.
    let decoded;
    try {
        decoded = decodeURIComponent(pathname);
    } catch {
        throw new BadRequest('La dirección no es válida.');
    }

    const filePath = path.join(ROOT, decoded === '/' ? 'index.html' : decoded);

    // path.join already resolves the '..', but one '..' too many would leave
    // the project folder and serve any file on disk: it has to be checked.
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

// An hour for the two lists that do not change between deploys, five minutes
// for the colours. `private` and not `public` on the colours on purpose:
// Cloudflare sits in front, and a shared cache would serve whoever is copying
// the catalogue without any of the counters above seeing it.
const COLOUR_LIST_CACHE = 'public, max-age=3600';
const COLOUR_ROW_CACHE = 'private, max-age=300';

// Returns true if the request has already been answered (an OPTIONS preflight).
function applyCors(req, res) {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.has(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        // The allowed origin depends on the Origin header, so intermediate
        // caches have to know the response varies with it.
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Max-Age', '86400');
    }
    if (req.method === 'OPTIONS') {
        // With no CORS headers above, the browser rejects the preflight on its
        // own; answering 204 anyway avoids leaving the request hanging.
        res.writeHead(204).end();
        return true;
    }
    return false;
}

const STAFF_PATH = /^\/api\/staff\/requests\/([0-9]{10})$/;
const OCCUPANCY_PATH = /^\/api\/staff\/requests\/([0-9]{10})\/occupancy$/;
const WORKER_NOTE_PATH = /^\/api\/staff\/workers\/([A-Za-z]{2}[0-9]{5})\/note$/;
const STAFF_PAINT_PATH = /^\/api\/staff\/paint-orders\/([0-9]{10})$/;
const STAFF_PAINT_DEFINE_PATH = /^\/api\/staff\/paint-orders\/([0-9]{10})\/definition$/;

// Long enough for «Termina el Onix antes del viernes y avísame», short enough
// that the card can show it whole. The column CHECKs the same number.
const MAX_NOTE = 500;

// Every row of the panel carries, besides their codes, the names of the workers
// holding it. It is put together here and not in the database because the name
// is looked up from the code (see server/names.js) and that is the only place
// where it is decided. `occupiedBy` comes from the database; `holders` is the
// server's doing, and it is the shape the panel reads: one entry per person,
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

// Every panel route goes through here. With no password configured there is
// no panel: answering 503 and not 401 tells «this server does not have it»
// apart from «your session expired», which is what whoever sets it up needs to know.
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
// exists; what they do not have is the boss's code.
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

// Which client address the server sees, and which header it took it from.
//
// The per-IP limit cannot be checked from outside: when it fails, it fails
// looking as if everything works. And which header carries the real address
// depends on the host, not on what one assumes; working it out blind, by
// watching whether the limit trips, leads to wrong conclusions.
//
// Behind the workshop password because it shows the proxy chain. It says
// nothing the caller does not already know: their own address.
function whoami(req, ip) {
    const workerId = auth.sessionWorkerId(req);
    const isBoss = auth.isBoss(workerId);
    const answer = {
        clientIp: ip,                                  // what the limit uses
        workerId,                                      // who holds the session
        isBoss,                                        // and whether they are the boss
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
        socket: req.socket.remoteAddress,              // the last hop
        trustProxy: TRUST_PROXY,
        forwarding,                                    // where it could come from
        mail: mail.describe(),                         // which account notices go out from
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
        // With no worker codes configured the panel would be open to anyone
        // with the password: answer 503, as when the password itself is
        // missing, instead of letting people in without identifying anyone.
        if (!auth.hasWorkerIds()) {
            return sendJson(res, 503, { error: 'El panel del taller no está configurado en este servidor.' });
        }
        const body = requireObject(await readJsonBody(req));
        // Both are needed: a valid worker code and the password. The error
        // does not say which one failed, so as not to reveal to a prober
        // which codes exist.
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
        // console.log and not console.warn: nothing odd happened here. In the
        // rest of the file a warn marks an anomaly, and mixing the most
        // frequent log line in with them buries them.
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
        // Who is looking: the panel needs it to know which rows it can touch
        // (an occupied one is only moved by whoever holds it) without asking
        // again for each one.
        const viewerId = auth.sessionWorkerId(req);
        // `isBoss` decides which profile gets painted (the monitor instead of
        // the start-session button) and nothing else: it is the interface. Who
        // may ask for the monitor and who may take a vehicle is decided by
        // requireBoss and refuseBoss, here, without trusting the browser.
        // Their own note from the boss, and nobody else's: it rides here so the
        // profile (which this same response already paints) does not need a
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
    // that came through the website (the queue does not care how a car
    // arrived) but fewer questions (WALK_IN_REQUIRED): the customer is at the
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
                // A code that is no longer on the roster (somebody who left
                // with a vehicle still taken) goes in anyway: leaving it out
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
    // trip for both, and it matches what the card offers: a textarea you can
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

    // The matizado orders, the table the panel shows beside the vehicles. Same
    // gate as the vehicle list: anybody with a session reads it.
    if (pathname === '/api/staff/paint-orders' && req.method === 'GET') {
        requireStaff(req);
        const wanted = new URL(req.url, 'http://localhost').searchParams.get('status');
        if (wanted && !PAINT_STATUSES.has(wanted)) throw new BadRequest('El estado no es válido.');
        const orders = (await listPaintOrders({ status: wanted })).map(withPaintHex);
        return sendJson(res, 200, { orders });
    }

    // The boss defines an order the customer brought to be read at the counter:
    // colour, container and the price he closes. Boss only, like the walk-in
    // form: pricing is running the workshop, not working in it.
    const defineMatch = STAFF_PAINT_DEFINE_PATH.exec(pathname);
    if (defineMatch && req.method === 'PUT') {
        requireBoss(req);
        const data = validatePaintDefinition(await readJsonBody(req));
        const result = await definePaintOrder(defineMatch[1], data);
        if (!result.ok && result.reason === 'not_found') {
            return sendJson(res, 404, { error: 'No encontramos ningún pedido con ese código.' });
        }
        if (!result.ok) {
            return sendJson(res, 409, {
                error: 'Este pedido ya trae su color desde la página: solo se definen los que se leen en el taller.',
            });
        }
        console.log(`[taller] matizado ${result.order.id} definido: ${data.brand} ${data.colorCode}, ${data.size} x${data.units}, S/ ${data.price}`);
        return sendJson(res, 200, withPaintHex(result.order));
    }

    // A matizado order's status. Nobody holds a tin the way they hold a car, so
    // there is no occupancy to check: any worker on shift moves it. The boss
    // does not, as with the vehicles (see refuseBoss).
    const paintMatch = STAFF_PAINT_PATH.exec(pathname);
    if (paintMatch && req.method === 'PATCH') {
        requireStaff(req);
        if (auth.isBoss(auth.sessionWorkerId(req))) {
            throw new HttpError(403, 'El jefe del taller define los pedidos, pero no les cambia el estado.');
        }
        const body = requireObject(await readJsonBody(req));
        if (!PAINT_STATUSES.has(body.status)) throw new BadRequest('El estado no es válido.');
        const updated = await updatePaintOrderStatus(paintMatch[1], body.status);
        if (!updated) return sendJson(res, 404, { error: 'No encontramos ningún pedido con ese código.' });
        console.log(`[taller] matizado ${updated.id} -> ${updated.status}`);
        return sendJson(res, 200, withPaintHex(updated));
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
            // Only whoever holds the vehicle changes its status. If it was
            // free, the error says it has to be taken; if others hold it, it
            // names them so it is clear whom to ask.
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

        // Taking or releasing a vehicle. While there is room (two people at
        // once at most) anyone takes it; only a holder can release it, and
        // they release their share and not the other's. The database enforces
        // both rules (see server/db.js), not this handler or the browser.
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
                // Full: two already hold it, which is the cap. Both are named
                // (they are the ones to ask for room) and the 409 is the same
                // as before: the request clashes with the state of the row.
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
   Colours

   The Sherwin-Williams catalogue: 68,717 colours and 693,636 vehicle-colour
   associations, in a separate, read-only database. See
   server/colordb/README.md.

   Everything that comes out of here is the catalogue's, not the customer's:
   there is no personal data to protect from a leak. What has to be made
   expensive is copying it whole, and that is done in three places at once:
   the limits inside the database functions, the counters here, and the fact
   that no query returns «all the colours».
-------------------------------------------------------------------------- */

// An integer from the query string, or null if it is not one. Rejects rather
// than rounding: `?make=12abc` is a malformed request, not make 12.
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
    // On a GET from the site itself the browser sends no Origin, so its
    // absence passes. What this stops is a foreign page reading the catalogue
    // from someone else's browser; it does not stop curl, and does not try to.
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
            // A make is always required: there is no query here that answers
            // «all the colours», which is exactly the one that would serve to
            // walk off with the catalogue.
            if (!makeId) {
                return sendJson(res, 400, { error: 'Elige la marca para ver sus colores.' });
            }
            if (modelId === undefined || year === undefined) {
                return sendJson(res, 400, { error: 'El modelo o el año no son válidos.' });
            }
            // Rejected rather than trimmed. The database function trims to
            // 600 anyway, but answering 200 with the last page again would
            // leave «ver más» looping over the same rows.
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
            // The same trim the database function applies, so as not to spend
            // a round trip on something it will reject anyway.
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
        // A database that is down is a 503 and can be retried; anything else
        // is our bug and goes up to the usual 500, which tells nothing.
        if (err instanceof colordb.ColourDbUnavailable) {
            return sendJson(res, 503, {
                error: 'El buscador de colores no está disponible ahora mismo.',
            });
        }
        throw err;
    }

    return sendJson(res, 404, { error: 'Ruta no encontrada.' });
}

/* The colour name is what the database says, not the form.
 *
 * When the order carries a swCode, it is resolved again here before saving.
 * It is not distrust of the customer: the email and the workshop order are
 * read as if they were the database, and a form field that went stale (or
 * that someone changed) would end up printed as if it were.
 *
 * What is NOT touched: colorCode stays the factory code the customer read off
 * the label, and finish stays the one they saw when they were charged.
 * Overwriting the first would put «20246» where the workshop expects «1F7»
 * and leave colourHex() in mail.js unable to find the swatch; overwriting
 * the second would change the price after charging it.
 *
 * If the database is not there, the order goes through anyway. An
 * unconfirmed colour still sells; a lost order does not.
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
    // The email's swatch. colourHex() used to look it up in the local
    // catalogue (server/paintCatalog.js, ~777 colours), so a colour from the
    // database's 693k came out without one. Here we already have the database
    // row, with its hex, so it is stored for the email to paint without looking again.
    data.hex = normalizeHex(colour.hex) || '';
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
        // Both emails go out AFTER answering: the row is already stored and
        // the customer already has their code, so a mail hiccup cannot turn
        // into an error on the request.
        //
        // No `await` and no `.catch()` on purpose: notifyNewRequest() is
        // synchronous, only queues the two messages and does not throw (not
        // even if building a body fails), so nothing is left hanging here.
        // How long they take to go out is server/mail.js's business.
        mail.notifyNewRequest(created, data);
        return;
    }

    if (req.method === 'POST' && pathname === '/api/paint-orders') {
        // The same three gates as /api/requests, for the same reasons: real
        // JSON, from the site, and with a per-IP ceiling.
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
        // After the response and without await, like a request's: the row is
        // already stored and the customer already has their code, so a mail
        // hiccup cannot turn into an error on the order.
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
        // A code of a different length never reaches the database: it gets the
        // same answer as a nonexistent one, so as not to reveal the valid shape.
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
        // The host's health check. It does not touch the database on purpose:
        // the host restarts the service when this route fails, so asking
        // Postgres turns a database hiccup (or the second it takes to wake)
        // into a restart, and each restart takes the panel's open sessions
        // with it. What must be answered here is «this process serves HTTP»,
        // which is exactly what the host uses to decide.
        //
        // Outside /api/ so it skips CORS, clientIp and the rate limit.
        // sendJson already answers with Cache-Control: no-store.
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
        // A database that does not answer is not a bug in the program, and
        // saying the same about both costs the workshop an order: the customer
        // reads «no pudimos procesar la solicitud», assumes they did something
        // wrong and leaves. The managed database sleeps and takes a while to
        // wake (see connect() in server/db.js, which already retries three
        // times before getting here), so this is a wait, not a fault, and it
        // is said as such.
        //
        // 503 and not 500 for the log too: a 500 has to be looked into, a 503
        // against a sleeping database explains itself.
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
        // The detail stays in the server log; the client only learns that it
        // failed, so the database structure does not leak in an error message.
        console.error('[error]', err);
        if (!res.headersSent) {
            sendJson(res, 500, { error: 'No pudimos procesar la solicitud. Inténtalo nuevamente.' });
        }
    }
});

async function start() {
    try {
        // Against a managed database, several attempts: it suspends compute
        // when nobody uses it and the first attempt after that times out while
        // it wakes. That matters more here than anywhere else, because this
        // ping runs BEFORE the port opens: if it fails, the process dies
        // without listening and the host marks the deploy as failed.
        //
        // Locally, a single attempt as before: there a database that does not
        // answer is a database that is off, and waiting will not turn it on.
        await ping({ attempts: DATABASE_URL ? 4 : 1 });
    } catch (err) {
        // With nobody listening on the port, Node groups one attempt per
        // address (::1 and 127.0.0.1) into an AggregateError whose own .message
        // is empty; without this the notice would end in a colon and nothing.
        const detail = err.message || (err.errors || []).map((e) => e.message).join('; ') || err.code || err;
        console.error(`\nNo se pudo conectar a la base ${describe()}: ${detail}`);
        if (DATABASE_URL) {
            // Telling them to start this machine's Postgres would be bad
            // advice: the database that does not answer is elsewhere.
            console.error('\nRevisa DATABASE_URL en las variables del servicio.\n');
        } else {
            console.error('\nAutocolor usa su propio servidor Postgres, aparte del general de la');
            console.error('máquina. Para levantarlo (o crearlo, la primera vez):\n');
            console.error('    npm run db:start        # o  npm run db:init  la primera vez\n');
        }
        process.exit(1);
    }
    // A busy port is the most common stumble at startup, and without this it
    // shows as an uncaught exception with its whole trace. Same treatment as
    // the unresponsive database above.
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

    // Both warnings key off the RENDER variable, which the host sets itself,
    // and not off a general rule like «HOST is public and TRUST_PROXY is
    // off»: that one would trip on the HOST=0.0.0.0 the README recommends for
    // testing from a phone, which is legitimate. This way there are no false
    // positives.
    if (process.env.RENDER && ['127.0.0.1', 'localhost', '::1'].includes(HOST)) {
        // Render marks the deploy live by scanning the port, and only sees
        // what is bound to 0.0.0.0. With the loopback address the deploy
        // just hangs, with no explanation beyond a timeout.
        console.warn(`\nAviso: HOST=${HOST} no es alcanzable desde fuera del contenedor. Hace falta HOST=0.0.0.0.\n`);
    }
    if (process.env.RENDER && TRUST_PROXY <= 0) {
        // See clientIp(): without this the three per-IP limits merge into
        // one, shared by every visitor.
        console.warn('\nAviso: falta TRUST_PROXY. El límite de peticiones cuenta a todos los visitantes como uno solo.\n');
    }

    server.listen(PORT, HOST, () => {
        console.log(`Autocolor en ${process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`}`);
        // WHICH CODE THIS PROCESS IS. Render sets both variables itself; on
        // this machine there are none and the line does not print.
        //
        // It is here because it already cost an afternoon: a new variable was
        // set on the host's dashboard and nothing happened, and the reason was
        // that what was deployed was still an older version that did not even
        // read that variable. Everything looked at to diagnose (the mail
        // notices, the ones below) speaks about the running code, so the log
        // should say which one it is before anything else.
        if (process.env.RENDER_GIT_COMMIT) {
            const branch = process.env.RENDER_GIT_BRANCH || 'rama desconocida';
            console.log(`Desplegado: ${branch} @ ${process.env.RENDER_GIT_COMMIT.slice(0, 7)}`);
        }
        console.log(`Base de datos: ${describe()}`);
        // The panel needs both: the password and the worker codes. Whichever
        // is missing gets named (or both), because a switched-off panel looks
        // like a 503 from inside and a broken page from outside, and guessing
        // which of the two it was costs an afternoon.
        const faltan = [];
        if (!auth.isConfigured()) faltan.push('AUTOCOLOR_STAFF_PASSWORD');
        if (!auth.hasWorkerIds()) faltan.push('AUTOCOLOR_WORKER_IDS');
        if (faltan.length === 0) {
            const base = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
            console.log(`Panel del taller: ${base}/pgs/taller.html`);
        } else {
            console.log(`Panel del taller apagado: falta ${faltan.join(' y ')}.`);
            console.log('  Escríbelo en el .env de la raíz (hay un .env.example al lado).');
        }
        // The colour database is checked HERE and not in start(), unlike the
        // requests one: that runs before the port opens and kills the process
        // if it fails, because without it there are no quotes and no panel.
        // Colours are a feature of one page. If this database is not there,
        // the page falls back to the local catalogue and the site keeps
        // selling, so a failure here is reported and does not kill anything.
        if (colordb.isEnabled()) {
            colordb.ping({ attempts: 3 }).then(() => colordb.stats()).then((s) => {
                const built = s ? new Date(s.built_at).toISOString().slice(0, 10) : '?';
                console.log(`Base de colores: ${colordb.describe()}`);
                console.log(`  ${Number(s.colours).toLocaleString('es-PE')} colores`
                    + ` y ${Number(s.makes).toLocaleString('es-PE')} marcas, del ${built}.`);
            }).catch((err) => {
                console.error(`\nBase de colores NO RESPONDE: ${err.message}`);
                console.error('  El buscador contestará 503 y la página usará el catálogo local.');
            });
        } else {
            console.log(`Base de colores apagada: ${colordb.offMessage()}.`);
            console.log('  El buscador de colores usará solo el catálogo local'
                + ' (777 colores, 10 marcas).');
        }

        // Without a mail account the site works the same and requests are
        // stored; what does not go out is the notice. It is said so nobody
        // waits for an email that was never even attempted.
        //
        // And if there is one, it is tested for real: connect and
        // authenticate without sending anything. A mail failure is invisible
        // from outside (the site looks perfect and requests are stored), so
        // the alternative to this line is finding out days later, because
        // someone did not get their code. Serving does not wait for it: the
        // check runs on its own and the site is already serving.
        if (!mail.isConfigured()) {
            console.log('Correos de aviso apagados: falta AUTOCOLOR_BREVO_KEY.');
        } else {
            mail.verify().then((result) => {
                if (result.ok) {
                    const m = mail.describe();
                    const account = result.account ? `, cuenta ${result.account}` : '';
                    console.log(`Correos de aviso: listos (Brevo, de ${m.from.name} <${m.from.email}>${account}).`);
                } else {
                    console.error(`\nCorreos de aviso NO FUNCIONAN: ${result.error}`);
                    console.error('  Las solicitudes se siguen guardando; lo que no sale es el aviso.');
                    console.error('  Un 401 es la llave (AUTOCOLOR_BREVO_KEY); un 400 suele ser el');
                    console.error('  remitente, que tiene que estar verificado en Brevo → Senders.');
                    // And check where this host can reach, because «no
                    // funcionan» has three causes that are fixed in different
                    // ways and the reason above does not tell them apart: see
                    // server/netcheck.js. Only once it has failed: on a
                    // healthy deploy this never runs.
                    return netcheck.run().then(({ lines, verdict }) => {
                        console.error('\n  A dónde llega este alojamiento:');
                        console.error(lines.join('\n'));
                        console.error('');
                        console.error(verdict.join('\n') + '\n');
                    });
                }
            }).catch((err) => {
                // Startup does not fall over for an informational line.
                console.error(`Correos de aviso sin comprobar: ${err.message}`);
            });
        }
        if (ALLOWED_ORIGINS.size > 0) {
            console.log(`Orígenes permitidos: ${[...ALLOWED_ORIGINS].join(', ')}`);
        }
    });
}

// An unhandled rejected promise ends the process in Node 20 and later. On a
// server that means taking the whole site down (and every open panel session)
// over a failure in something secondary, which is nearly always an email.
// Logging it and carrying on is right: what could not carry on was the
// request, and that was answered long before getting here.
process.on('unhandledRejection', (reason) => {
    console.error(`[server] promesa rechazada sin manejar: ${reason instanceof Error ? reason.stack : reason}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
        // THE ORDER MATTERS. First stop accepting and finish what is already
        // running; only when nobody is being served are the mail queue and the
        // database pool dropped. The other way round (as it used to be) every
        // deploy and every idle shutdown cut off the notices that were going
        // out at that moment.
        server.close(() => {
            mail.close();
            pool.end().then(() => process.exit(0));
        });
    });
}

start();
