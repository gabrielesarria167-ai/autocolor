'use strict';

/* =============================================================================
   Workshop panel sessions.

   A single shared password, the workshop's, in the environment variable
   AUTOCOLOR_STAFF_PASSWORD. The usual way is to write it once in the root
   .env (see .env.example and server/env.js) and start with `npm start`;
   putting it in front of the command still works and takes priority:

       AUTOCOLOR_STAFF_PASSWORD='...' npm start

   Without it the panel does not exist: the routes answer 503 instead of
   staying open. That is the difference between forgetting to configure it
   and publishing the customers' phone numbers.

   Why the check lives here and not in the browser: pgs/taller.html is a
   static file like any other and anyone can read its source. What has to be
   locked is the API.
   ========================================================================== */

// First of all: the .env has to be in process.env when
// AUTOCOLOR_STAFF_PASSWORD is read, a few lines below.
require('./env');

const crypto = require('node:crypto');

const COOKIE_NAME = 'autocolor_staff';
const SESSION_MS = 8 * 60 * 60 * 1000;   // one working day
const PASSWORD = process.env.AUTOCOLOR_STAFF_PASSWORD || '';

// Who may enter, from AUTOCOLOR_WORKER_IDS: comma-separated entries, each one a
// code and, after a colon, the name of the person it belongs to.
//
//     AUTOCOLOR_WORKER_IDS=AB12345:Ana Bravo,CD67890:Carlos Díaz
//
// A code is the first initial, the surname initial and five digits (AB12345).
// Codes are normalised (trimmed and upper-cased) so that typing «ab12345»
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
//
// A code of any other shape is skipped with a warning. The database columns
// that store a code (occupied_by, worker_id) CHECK this same shape, so a code
// like «JEFE» would log in fine and then fail with a 500 on the first vehicle
// it took or the first note written to it.
const CODE_RE = /^[A-Z]{2}[0-9]{5}$/;

function parseRoster(raw, variable) {
    const codes = new Set();
    const names = new Map();
    for (const entry of String(raw || '').split(',')) {
        const colon = entry.indexOf(':');
        const code = (colon === -1 ? entry : entry.slice(0, colon)).trim().toUpperCase();
        if (!code) continue;
        if (!CODE_RE.test(code)) {
            console.warn(`[auth] ${variable}: skipping «${code}», codes are two letters and five digits (AB12345)`);
            continue;
        }
        codes.add(code);
        const name = colon === -1 ? '' : entry.slice(colon + 1).trim();
        if (name) names.set(code, name);
    }
    return { codes, names };
}

const roster = parseRoster(process.env.AUTOCOLOR_WORKER_IDS, 'AUTOCOLOR_WORKER_IDS');
const WORKER_IDS = roster.codes;
const WORKER_NAMES = roster.names;

// The workshop boss, in AUTOCOLOR_BOSS_ID. One entry, written exactly like the
// ones above: code, colon, name. It does not need to be repeated in
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
const bossRoster = parseRoster(process.env.AUTOCOLOR_BOSS_ID, 'AUTOCOLOR_BOSS_ID');
const BOSS_ID = bossRoster.codes.values().next().value || '';
if (bossRoster.codes.size > 1) {
    console.warn(`[auth] AUTOCOLOR_BOSS_ID lists ${bossRoster.codes.size} codes; only the first, ${BOSS_ID}, is the boss`);
}
const bossName = bossRoster.names.get(BOSS_ID);
if (bossName) WORKER_NAMES.set(BOSS_ID, bossName);
// Listed in both variables, the boss would show up in his own monitor as a
// worker holding nothing, and could be sent notes.
if (BOSS_ID) WORKER_IDS.delete(BOSS_ID);

// Sessions live in memory and are lost when the server restarts: the panel
// belongs to one machine and a handful of people, and a table in the database
// would only add things to maintain to save them logging in again.
const sessions = new Map(); // token -> { expiresAt, workerId }

function isConfigured() {
    return PASSWORD.length > 0;
}

/**
 * Compares the password received with the configured one.
 *
 * The digests are compared, not the strings: timingSafeEqual requires both
 * buffers to be the same length, and a SHA-256 is always 32 bytes wherever it
 * comes from. That way the comparison time does not give away how many
 * leading characters a prober got right.
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
 * The name configured for a code, or an empty string when there is none: an
 * entry written without one, or a code that is not on the roster at all (an old
 * one still sitting on a row of the table). Callers fall back to the code, which
 * always identifies somebody even when nothing names them.
 */
function workerName(code) {
    return WORKER_NAMES.get(String(code || '').trim().toUpperCase()) || '';
}

/**
 * Checks a worker code against the AUTOCOLOR_WORKER_IDS list.
 * The boss's code (AUTOCOLOR_BOSS_ID) is accepted too, listed or not.
 *
 * Returns the code already normalised (upper case, no spaces) if it is valid,
 * or an empty string if not. It is normalised the same way as when loading so
 * it does not matter how whoever logs in types it. Unlike the password it is
 * not compared in constant time: the code identifies, it is not the secret
 * (that is the password), and the attempt limit already slows blind guessing.
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

// 'a=1; b=2' -> { a: '1', b: '2' }. Nothing more is needed: this server has a
// single cookie and its value is base64url, with nothing to decode.
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

/** The request's token if its session is still alive; otherwise an empty string. */
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

/** The worker code of the live session, or an empty string if there is none. */
function sessionWorkerId(req) {
    const token = readSession(req);
    const session = token && sessions.get(token);
    return session ? (session.workerId || '') : '';
}

// HttpOnly so no script can read the token, and SameSite=Strict so the cookie
// does not travel on requests born on another site. Secure sits behind a
// variable because on http://localhost the browser would drop the cookie;
// when hosting the panel behind https it has to be turned on.
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

// Expired sessions would pile up forever if nobody removed them.
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
