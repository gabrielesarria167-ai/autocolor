'use strict';

/* =============================================================================
   netcheck.js: where this host can reach and where it cannot

   It exists because «could not connect» does not tell apart three situations
   that are fixed in different ways:

     1. There is no way out to the internet, or DNS does not answer. Then it
        is not a mail problem and the host is what needs looking at.
     2. Traffic gets out fine, but the Brevo API does not answer. Then there
        is nothing to fix here: it is a matter of waiting, which is what the
        retries are for.
     3. Everything is reachable, and what fails is the key, the unverified
        sender or the message. The reason the check gave says so.

   It tests by opening a socket and nothing else: no HTTP is spoken and not a
   byte is sent. All that is measured is whether the TCP handshake completes.

   THIS WAS WRITTEN FOR THE EARLIER PROBLEM, when emails went out through
   Gmail's SMTP and died on «Connection timeout» without saying why (see the
   header of server/mail.js). It stays, pointed at the current transport,
   because the question it answers («does this host reach where it has to?»)
   is the same the day something fails again.

   IT NEVER RUNS IF MAIL WORKS. server.js only fires it when the startup check
   fails, so on a healthy deploy this costs nothing and does not show in the log.
   ========================================================================== */

const net = require('node:net');

// A short cap on purpose: this is a diagnostic and it runs after an email
// that already failed. A healthy connection to any of these takes
// milliseconds (Gmail's, 22 ms measured), so eight seconds is more than
// generous and keeps startup under that: the probes run at the same time.
const PROBE_TIMEOUT_MS = 8000;

// The questions, in the order they are read: the destination we use, another
// of the same kind to tell whether the problem is theirs or ours, and a third
// that only checks this container gets out to the internet.
const PROBES = [
    { label: 'la API de Brevo (la que usamos)', host: 'api.brevo.com', port: 443 },
    { label: 'otro sitio cualquiera por HTTPS', host: 'www.cloudflare.com', port: 443 },
    { label: 'la base de datos (Neon)', host: 'console.neon.tech', port: 443 },
];

/**
 * Does the TCP handshake complete against this destination?
 *
 * `family: 4` because Render has no outbound IPv6 (server/mail.js no longer
 * resolves anything by hand; it just uses fetch), and a probe going out over
 * IPv6 would say «cannot reach» about a perfectly reachable destination.
 *
 * It does not throw: it returns the result, which here is the data.
 */
function probe({ label, host, port }) {
    return new Promise((resolve) => {
        const started = Date.now();
        const socket = net.connect({ host, port, family: 4 });
        const done = (error) => {
            socket.destroy();
            resolve({ label, host, port, ok: !error, error, ms: Date.now() - started });
        };
        socket.setTimeout(PROBE_TIMEOUT_MS);
        socket.once('connect', () => done(null));
        socket.once('timeout', () => done('sin respuesta'));
        socket.once('error', (err) => done(err.code || err.message));
    });
}

/**
 * Runs the probes and returns { lines, verdict } already worded.
 *
 * It returns text and not data because the only consumer is the deploy log,
 * which is where this gets looked at.
 *
 * `probes` can be passed to test the function itself against known
 * destinations; in production it is called with no arguments.
 */
async function run(probes = PROBES) {
    const results = await Promise.all(probes.map(probe));
    const [api, other, neon] = results;

    const lines = results.map((r) => {
        const mark = r.ok ? 'sí' : 'NO';
        const detail = r.ok ? `${r.ms} ms` : `${r.error}, tras ${(r.ms / 1000).toFixed(1)} s`;
        return `    ${mark.padEnd(4)} ${r.label.padEnd(36)} ${r.host}:${r.port} (${detail})`;
    });

    return { lines, verdict: verdictFor({ api, other, neon }) };
}

function verdictFor({ api, other, neon }) {
    if (api.ok) {
        return ['  Se llega a la API, así que el fallo no es de red. Mira el motivo que',
                '  dio la comprobación: suele ser la llave (401) o el remitente sin',
                '  verificar en Brevo (400).'];
    }
    if (other.ok || neon.ok) {
        return ['  Se sale a internet, pero NO se llega a la API de Brevo. Casi siempre es',
                '  cosa suya y se arregla sola; los avisos se reintentan durante cuarenta y',
                '  ocho minutos. Si sigue mañana, mira si Brevo tiene una caída.'];
    }
    return ['  No se llega a ninguno de los tres. Esto ya no es cosa del correo:',
            '  o no hay salida a internet, o la resolución de nombres está caída.',
            '  (La base de datos también es externa: si el sitio guarda solicitudes,',
            '  desconfía de este resultado antes que del alojamiento.)'];
}

module.exports = { run };
