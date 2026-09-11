'use strict';

/* =============================================================================
   Sesiones del panel del taller.

   Una sola contraseña compartida, la del taller, en la variable de entorno
   AUTOCOLOR_STAFF_PASSWORD. Lo habitual es dejarla escrita una vez en el .env
   de la raíz (ver .env.example y server/env.js) y arrancar con `npm start`;
   ponerla delante del comando sigue funcionando y tiene prioridad:

       AUTOCOLOR_STAFF_PASSWORD='...' npm start

   Sin ella el panel no existe: las rutas responden 503 en vez de quedar
   abiertas. Es la diferencia entre olvidarse de configurarlo y publicar los
   teléfonos de los clientes.

   Por qué la comprobación vive aquí y no en el navegador: pgs/taller.html es
   un archivo estático como cualquier otro y su código fuente lo lee todo el
   mundo. Lo que hay que cerrar es la API.
   ========================================================================== */

// Antes que nada: el .env tiene que estar en process.env cuando se lea
// AUTOCOLOR_STAFF_PASSWORD, unas líneas más abajo.
require('./env');

const crypto = require('node:crypto');

const COOKIE_NAME = 'autocolor_staff';
const SESSION_MS = 8 * 60 * 60 * 1000;   // una jornada
const PASSWORD = process.env.AUTOCOLOR_STAFF_PASSWORD || '';

// Who may enter, from AUTOCOLOR_WORKER_IDS: comma-separated entries, each one a
// code and, after a colon, the name of the person it belongs to.
//
//     AUTOCOLOR_WORKER_IDS=AB12345:Ana Bravo,CD67890:Carlos Díaz
//
// A code is the first initial, the surname initial and five digits (AB12345).
// Codes are normalised — trimmed and upper-cased — so that typing «ab12345»
// matches the «AB12345» of the .env; the name is kept as written, because it is
// shown as written. The password is still the shared secret; the code says who
// came in, and the name is what the panel puts on screen instead of it.
//
// The name is optional: an entry that is only a code still lets that person in,
// and the panel falls back to showing the code. That keeps a deployment whose
// AUTOCOLOR_WORKER_IDS predates the names working untouched.
//
// Both live in the environment and not in this repository on purpose: the
// repository is public, and between them these two say who works at the shop.
function parseRoster(raw) {
    const codes = new Set();
    const names = new Map();
    for (const entry of String(raw || '').split(',')) {
        const colon = entry.indexOf(':');
        const code = (colon === -1 ? entry : entry.slice(0, colon)).trim().toUpperCase();
        if (!code) continue;
        codes.add(code);
        const name = colon === -1 ? '' : entry.slice(colon + 1).trim();
        if (name) names.set(code, name);
    }
    return { codes, names };
}

const roster = parseRoster(process.env.AUTOCOLOR_WORKER_IDS);
const WORKER_IDS = roster.codes;
const WORKER_NAMES = roster.names;

// The workshop boss, in AUTOCOLOR_BOSS_ID. One entry, written exactly like the
// ones above — code, colon, name. It does not need to be repeated in
// AUTOCOLOR_WORKER_IDS: it is accepted on its own (see verifyWorkerId), because
// naming the boss and forgetting to list him would lock out the very person
// just configured.
//
// What being the boss changes is the profile: instead of the start-session
// button it carries the monitor, which shows the vehicle each worker is
// holding (see GET /api/staff/workers in server/server.js). In exchange he
// takes no vehicles and changes no statuses; if he did, he would show up as
// one more row in his own monitor.
//
// Empty is the normal case: with no boss configured nobody sees the monitor
// and the panel works as it always did.
const bossRoster = parseRoster(process.env.AUTOCOLOR_BOSS_ID);
const BOSS_ID = bossRoster.codes.values().next().value || '';
for (const [code, name] of bossRoster.names) WORKER_NAMES.set(code, name);

// Las sesiones viven en memoria y se pierden al reiniciar el servidor: el
// panel es de una máquina y de un puñado de personas, y una tabla en la base
// solo agregaría cosas que mantener para ahorrarles volver a entrar.
const sessions = new Map(); // token -> { expiresAt, workerId }

function isConfigured() {
    return PASSWORD.length > 0;
}

/**
 * Compara la contraseña recibida con la configurada.
 *
 * Se comparan los digest y no las cadenas: timingSafeEqual exige que los dos
 * buffers midan lo mismo, y un SHA-256 siempre mide 32 bytes venga de donde
 * venga. Así el tiempo de la comparación no delata cuántos caracteres del
 * comienzo acertó quien prueba.
 */
function verifyPassword(entered) {
    if (!isConfigured() || typeof entered !== 'string' || entered.length === 0) return false;
    const a = crypto.createHash('sha256').update(entered).digest();
    const b = crypto.createHash('sha256').update(PASSWORD).digest();
    return crypto.timingSafeEqual(a, b);
}

// The boss counts: a workshop configured with him alone still has someone to
// let in, and answering 503 there would switch off a panel that is set up.
function hasWorkerIds() {
    return WORKER_IDS.size > 0 || BOSS_ID.length > 0;
}

/** Whether a code is the boss's. Always false when no boss is configured. */
function isBoss(entered) {
    if (!BOSS_ID) return false;
    return String(entered || '').trim().toUpperCase() === BOSS_ID;
}

/**
 * The worker codes, sorted. The monitor needs them to show the people holding
 * no vehicle at all: without this only the codes that appear in the database
 * for holding one would show up, and "nobody is working" would look exactly
 * like "there are no workers".
 *
 * The boss is not in the list: he is not a worker and does not appear in his
 * own monitor.
 */
function listWorkerIds() {
    return Array.from(WORKER_IDS).sort();
}

/**
 * The name configured for a code, or an empty string when there is none — an
 * entry written without one, or a code that is not on the roster at all (an old
 * one still sitting on a row of the table). Callers fall back to the code, which
 * always identifies somebody even when nothing names them.
 */
function workerName(code) {
    return WORKER_NAMES.get(String(code || '').trim().toUpperCase()) || '';
}

/**
 * Comprueba un código de trabajador contra la lista de AUTOCOLOR_WORKER_IDS.
 * The boss's code (AUTOCOLOR_BOSS_ID) is accepted too, listed or not.
 *
 * Devuelve el código ya normalizado (mayúsculas, sin espacios) si es válido, o
 * cadena vacía si no. Se normaliza igual que al cargarlos para que no importe
 * cómo lo escriba quien entra. A diferencia de la contraseña no se compara en
 * tiempo constante: el código identifica, no es el secreto —ese es la
 * contraseña—, y el límite de intentos ya frena probarlos a ciegas.
 */
function verifyWorkerId(entered) {
    if (typeof entered !== 'string') return '';
    const code = entered.trim().toUpperCase();
    if (BOSS_ID && code === BOSS_ID) return code;
    return WORKER_IDS.has(code) ? code : '';
}

function createSession(workerId) {
    const token = crypto.randomBytes(32).toString('base64url');
    sessions.set(token, { expiresAt: Date.now() + SESSION_MS, workerId: workerId || '' });
    return token;
}

function destroySession(token) {
    if (token) sessions.delete(token);
}

// 'a=1; b=2' -> { a: '1', b: '2' }. No hace falta más: las cookies de este
// servidor son una sola y su valor es base64url, sin nada que decodificar.
function parseCookies(header) {
    const out = {};
    for (const part of (header || '').split(';')) {
        const eq = part.indexOf('=');
        if (eq < 1) continue;
        out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
    return out;
}

function readToken(req) {
    return parseCookies(req.headers.cookie)[COOKIE_NAME] || '';
}

/** El token de la petición si su sesión sigue viva; si no, cadena vacía. */
function readSession(req) {
    const token = readToken(req);
    const session = sessions.get(token);
    if (!session) return '';
    if (Date.now() > session.expiresAt) {
        sessions.delete(token);
        return '';
    }
    return token;
}

/** El código del trabajador de la sesión viva, o cadena vacía si no la hay. */
function sessionWorkerId(req) {
    const token = readSession(req);
    const session = token && sessions.get(token);
    return session ? (session.workerId || '') : '';
}

// HttpOnly para que ningún script pueda leer el token, y SameSite=Strict para
// que la cookie no viaje en peticiones que nazcan en otro sitio. Secure queda
// tras una variable porque en http://localhost el navegador descartaría la
// cookie; al alojar el panel detrás de https hay que encenderla.
function cookieHeader(token) {
    const parts = [
        `${COOKIE_NAME}=${token}`,
        'HttpOnly',
        'SameSite=Strict',
        'Path=/',
        `Max-Age=${Math.floor(SESSION_MS / 1000)}`,
    ];
    if (process.env.AUTOCOLOR_STAFF_COOKIE_SECURE === '1') parts.push('Secure');
    return parts.join('; ');
}

function clearCookieHeader() {
    return `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

// Las sesiones vencidas se acumularían para siempre si nadie las quita.
setInterval(() => {
    const now = Date.now();
    for (const [token, session] of sessions) {
        if (now > session.expiresAt) sessions.delete(token);
    }
}, 60 * 60 * 1000).unref();

module.exports = {
    isConfigured,
    hasWorkerIds,
    isBoss,
    listWorkerIds,
    workerName,
    verifyPassword,
    verifyWorkerId,
    createSession,
    sessionWorkerId,
    destroySession,
    readSession,
    readToken,
    cookieHeader,
    clearCookieHeader,
};
