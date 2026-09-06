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

// Los códigos de trabajador válidos, en AUTOCOLOR_WORKER_IDS, separados por
// comas. Cada uno es la inicial del nombre, la del apellido y cinco dígitos
// (JP64723). Se guardan normalizados —sin espacios y en mayúsculas— para que
// «jp64723» al entrar case con «JP64723» del .env. La contraseña sigue siendo
// el secreto compartido; el código dice además quién entró.
const WORKER_IDS = new Set(
    (process.env.AUTOCOLOR_WORKER_IDS || '')
        .split(',')
        .map(function (id) { return id.trim().toUpperCase(); })
        .filter(Boolean)
);

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

function hasWorkerIds() {
    return WORKER_IDS.size > 0;
}

/**
 * Comprueba un código de trabajador contra la lista de AUTOCOLOR_WORKER_IDS.
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
