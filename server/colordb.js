/* The colour database: Sherwin-Williams vehicle-to-colour lookups.
 *
 * A second pool, separate from db.js, because this is a second database: the
 * requests live in the shop's own, the colours in a read-only copy that the
 * application role reaches only through the functions in api.
 *
 * Two things differ from db.js on purpose.
 *
 * It takes a URL and nothing else. db.js has two exclusive branches because it
 * also supports PGHOST/PGPORT for the local cluster, and pg does
 * Object.assign({}, config, parse(connectionString)), so mixing the two silently
 * drops whatever sits beside the string. There is no second branch here, so
 * there is nothing to mix.
 *
 * And it fails soft. server.js pings the requests database before it listens
 * and exits if that fails, which is right: without it there is no quote and no
 * panel. The colours are one feature of one page. If this database is missing,
 * misconfigured or down, the site still sells paint — the page falls back to
 * the local catalogue — so a failure here logs a line and disables itself
 * rather than taking the process with it.
 */

'use strict';

require('./env.js');

const { Pool } = require('pg');

const COLORDB_URL = process.env.AUTOCOLOR_COLORDB_URL || '';

/* Thrown when the database is off or unreachable, so the routes can answer 503
 * and mean it. A bug still throws something else and still becomes a 500. */
class ColourDbUnavailable extends Error {
    constructor(message) {
        super(message || 'The colour database is not available.');
        this.name = 'ColourDbUnavailable';
    }
}

/* ---------------------------------------------------------------------------
   sslmode=verify-full, checked rather than documented

   render.yaml and .env.example both ask for verify-full on DATABASE_URL, and
   nothing enforces it. Here it is enforced, because this connection carries a
   licensed catalogue and the check costs nothing.

   It reads the text of the URL, not the parsed options, and that is the whole
   trick: pg-connection-string turns sslmode=require, prefer, verify-ca and
   verify-full into the same `ssl: {}` today, so by the time pg has parsed it
   there is nothing left to tell them apart. pg prints a deprecation notice
   saying pg 9 will give require the weaker libpq meaning; this check is what
   makes that change a non-event.

   Returns '' when the URL is fine, or one line saying what is wrong.
   --------------------------------------------------------------------------- */
function sslComplaint(raw) {
    if (!raw) return 'it is empty';
    let url;
    try {
        url = new URL(raw);
    } catch {
        return 'it is not a URL';
    }
    if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
        return `the scheme is ${url.protocol} and should be postgresql:`;
    }

    const host = url.hostname.replace(/^\[|\]$/g, '');
    const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    const mode = url.searchParams.get('sslmode');

    // The one exception, and it is narrow: the local build database on this
    // machine, where there is no network to protect and no certificate to
    // verify against. Anything not on loopback must be verify-full.
    if (loopback && (mode === 'disable' || mode === null)) return '';

    if (mode !== 'verify-full') {
        return `sslmode is ${mode === null ? 'missing' : mode} and must be verify-full`;
    }
    // uselibpqcompat switches pg to libpq's weaker reading of the same word.
    if (url.searchParams.get('uselibpqcompat') === 'true') {
        return 'uselibpqcompat=true weakens what verify-full means';
    }
    const root = url.searchParams.get('sslrootcert');
    if (root === 'disable') return 'sslrootcert=disable turns verification off again';
    // psql needs sslrootcert=system to use the OS trust store; node does not,
    // and pg-connection-string reads the value as a FILE NAME -- it would try
    // to open one called "system" and throw ENOENT while the Pool is being
    // built, before any of this could report it. Caught here so a URL copied
    // from the push script disables the colour search instead of stopping the
    // server from booting at all.
    if (root === 'system') {
        return 'sslrootcert=system is for psql; node verifies with its own roots, '
            + 'so remove it from this URL';
    }
    if (url.searchParams.get('ssl') === 'false') return 'ssl=false contradicts sslmode';
    return '';
}

/* --------------------------------------------------------------------------- */

const disabled = process.env.AUTOCOLOR_COLORDB_DISABLED === '1';
const complaint = COLORDB_URL ? sslComplaint(COLORDB_URL) : '';

let offReason = '';
if (disabled) offReason = 'AUTOCOLOR_COLORDB_DISABLED=1';
else if (!COLORDB_URL) offReason = 'AUTOCOLOR_COLORDB_URL is not set';
else if (complaint) offReason = `AUTOCOLOR_COLORDB_URL rejected: ${complaint}`;

let enabled = !offReason;

const pool = enabled
    ? new Pool({
        connectionString: COLORDB_URL,
        // Half of db.js's ten. Neon's free compute is shared with the requests
        // database, and the requests are the ones that must not queue.
        max: Number(process.env.AUTOCOLOR_COLORDB_MAX) || 4,
        idleTimeoutMillis: 30_000,
        // Long, like db.js: a managed database suspends its compute when idle
        // and the first connection after that pays the start as well as the
        // network and the TLS.
        connectionTimeoutMillis: 15_000,
    })
    : null;

if (pool) {
    pool.on('error', (err) => {
        console.error('[colordb] idle connection lost:', err.message);
    });

    // The string check says what the URL asked for. This says what actually
    // happened, which is the part that matters.
    pool.on('connect', (client) => {
        const socket = client.connection && client.connection.stream;
        const host = (() => { try { return new URL(COLORDB_URL).hostname; } catch { return ''; } })();
        const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
        if (!loopback && !(socket && socket.encrypted)) {
            enabled = false;
            offReason = 'the connection came up without TLS';
            console.error('[colordb] the connection is not encrypted. Colour lookups are off.');
            client.end().catch(() => {});
        }
    });
}

function isEnabled() { return enabled; }
function offMessage() { return offReason; }

/* Never prints the password: this line goes to the hosting log. */
function describe() {
    if (!COLORDB_URL) return 'off (AUTOCOLOR_COLORDB_URL is not set)';
    try {
        const url = new URL(COLORDB_URL);
        const db = url.pathname.slice(1) || '(unnamed)';
        const mode = url.searchParams.get('sslmode') || 'no sslmode';
        return `${db} at ${url.host} as ${url.username || '(no user)'}, ${mode}`;
    } catch {
        return '(AUTOCOLOR_COLORDB_URL could not be read)';
    }
}

/* Connection-class failures become ColourDbUnavailable, so a route can answer
 * 503. Everything else rethrows and stays a 500: an outage and a bug should
 * not look the same from outside. */
const OUTAGE_CODES = new Set(['57P01', '57P02', '57P03', '53300', '53400', '3D000', '28000', '28P01']);
function classify(err) {
    const code = err && err.code ? String(err.code) : '';
    const outage = OUTAGE_CODES.has(code)
        || code.startsWith('08')
        || ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'ECONNRESET'].includes(code)
        || /timeout expired/i.test(err && err.message ? err.message : '');
    if (!outage) return err;
    // The detail stays in our log; the thrown error carries none of it, so no
    // route can leak the shape of the database in a message.
    console.error('[colordb] unavailable:', err.message);
    return new ColourDbUnavailable();
}

async function call(sql, params) {
    if (!enabled) throw new ColourDbUnavailable();
    try {
        return await pool.query(sql, params);
    } catch (err) {
        throw classify(err);
    }
}

async function ping(options) {
    if (!enabled) throw new ColourDbUnavailable();
    const attempts = (options || {}).attempts || 1;
    for (let attempt = 1; ; attempt += 1) {
        try {
            await pool.query('SELECT 1');
            return;
        } catch (err) {
            if (attempt >= attempts) throw classify(err);
            await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
        }
    }
}

/* ---------------------------------------------------------------------------
   The queries. Every one names its function in full, because the role's
   search_path is empty on purpose.
   --------------------------------------------------------------------------- */

/* One paint, and every factory code the make prints for it. The database
 * returns them as an array because Jeep sells one blue as both KBX and PBX,
 * and a row per code put the same tile on the grid twice. The first is the
 * one that was searched for; the rest travel as `altCodes` so the page can
 * show "KBX · PBX" rather than pretending the other does not exist.
 *
 * `code` is empty for the 5,782 colours that carry no factory code at all.
 * The page falls back to the Sherwin code, which is the only name they have. */
function colourRow(r) {
    const codes = r.oem_codes || [];
    return {
        swCode: r.sw_code,
        code: codes[0] || '',
        altCodes: codes.slice(1),
        name: r.oem_name,
        swName: r.sw_name,
        finish: r.finish,
        family: r.family,
        hex: r.hex || '',
        years: [r.year_min, r.year_max],
        brandWide: r.brand_wide,
        dualTone: r.dual_tone,
    };
}

async function makes() {
    const { rows } = await call('SELECT * FROM api.makes()');
    return rows.map((r) => ({ makeId: r.make_id, label: r.label, sortKey: r.sort_key }));
}

async function models(makeId) {
    const { rows } = await call('SELECT * FROM api.models($1)', [makeId]);
    return rows.map((r) => ({ modelId: r.model_id, name: r.name }));
}

/* Asks for 61 and returns 60. The extra row is how `hasMore` is known without
 * the API ever saying how many rows exist. */
async function coloursFor(query) {
    const q = query || {};
    const from = Math.max(0, Number(q.from) || 0);
    const { rows } = await call('SELECT * FROM api.colours_for($1, $2, $3, $4)',
        [q.makeId, q.modelId == null ? null : q.modelId, q.year == null ? null : q.year, from]);
    return { items: rows.slice(0, 60).map(colourRow), from, hasMore: rows.length > 60 };
}

async function colourByCode(makeId, code) {
    const { rows } = await call('SELECT * FROM api.colour_by_code($1, $2)', [makeId, code]);
    return rows.map((r) => Object.assign(colourRow(r), { modelName: r.model_name }));
}

async function colourById(swCode) {
    const { rows } = await call('SELECT * FROM api.colour($1)', [swCode]);
    if (!rows.length) return null;
    const r = rows[0];
    return { swCode: r.sw_code, name: r.oem_name, swName: r.sw_name,
             finish: r.finish, family: r.family, hex: r.hex || '' };
}

async function stats() {
    const { rows } = await call('SELECT * FROM api.stats()');
    return rows.length ? rows[0] : null;
}

module.exports = {
    isEnabled, offMessage, describe, ping,
    makes, models, coloursFor, colourByCode, colourById, stats,
    sslComplaint, ColourDbUnavailable, pool, COLORDB_URL,
};
