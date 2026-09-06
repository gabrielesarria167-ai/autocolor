'use strict';

/* =============================================================================
   netcheck.js — a dónde llega este alojamiento y a dónde no

   Existe porque el fallo del correo lleva cuatro rondas diciendo lo mismo
   —«Connection timeout» contra smtp.gmail.com— y esa frase, sola, no distingue
   tres situaciones que se arreglan de maneras distintas:

     1. El alojamiento no deja salir por el 587. Entonces NINGÚN servidor de
        correo por SMTP va a funcionar desde aquí, y la única salida es un
        proveedor por HTTPS (el 443 no lo bloquea nadie).
     2. El 587 sale bien, pero Google no acepta conexiones desde la IP de
        salida de este alojamiento —el plan gratuito de Render sale por
        direcciones compartidas, y Google las trata según su reputación—.
        Entonces cambiar de proveedor arregla el problema y afinar el SMTP no.
     3. El 587 y Gmail están bien, y lo que falla es otra cosa (la cuenta, el
        mensaje, la resolución de nombres).

   Se prueba abriendo un socket y nada más: ni se habla SMTP ni se manda un
   byte. Lo único que se mide es si el saludo TCP llega a completarse, que es
   exactamente lo que está fallando.

   NO SE CORRE NUNCA SI EL CORREO FUNCIONA. Lo dispara server.js solo cuando la
   comprobación del arranque falla, así que en un despliegue sano esto no
   cuesta nada y no aparece en el registro.
   ========================================================================== */

const net = require('node:net');

// Un tope corto a propósito: esto es un diagnóstico y va detrás de un correo
// que ya falló. Una conexión sana a cualquiera de estos tarda milésimas (la de
// Gmail, 22 ms medidos), así que ocho segundos es de sobra generoso y mantiene
// el arranque por debajo de eso: las cuatro pruebas van a la vez.
const PROBE_TIMEOUT_MS = 8000;

// Las cuatro preguntas, en el orden en que se leen. Los destinos no son un
// capricho: los dos primeros son el que usamos y el que ya se descartó, y los
// dos últimos son el candidato a sustituirlo, así que si hay que mudarse,
// esto ya dice si el sitio nuevo es alcanzable.
const PROBES = [
    { label: 'Gmail por el 587 (el que usamos)', host: 'smtp.gmail.com', port: 587 },
    { label: 'Gmail por el 465 (ya descartado)', host: 'smtp.gmail.com', port: 465 },
    { label: 'otro SMTP cualquiera por el 587', host: 'smtp-relay.brevo.com', port: 587 },
    { label: 'una API de correo por HTTPS', host: 'api.brevo.com', port: 443 },
];

/**
 * ¿Se completa el saludo TCP contra este destino?
 *
 * `family: 4` por lo mismo que server/mail.js resuelve el registro A a mano:
 * Render no tiene salida IPv6, y una prueba que salga por IPv6 diría «no
 * llego» de un destino perfectamente alcanzable.
 *
 * No lanza: devuelve el resultado, que aquí es el dato.
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
 * Corre las cuatro y devuelve { lines, verdict } ya redactados.
 *
 * Devuelve texto y no datos porque el único consumidor es el registro del
 * despliegue, que es donde se mira esto.
 *
 * `probes` se puede pasar para probar la función misma contra destinos
 * conocidos; en producción se llama sin argumentos.
 */
async function run(probes = PROBES) {
    const results = await Promise.all(probes.map(probe));
    const [gmail587, gmail465, otherSmtp, https] = results;

    const lines = results.map((r) => {
        const mark = r.ok ? 'sí' : 'NO';
        const detail = r.ok ? `${r.ms} ms` : `${r.error}, tras ${(r.ms / 1000).toFixed(1)} s`;
        return `    ${mark.padEnd(4)} ${r.label.padEnd(36)} ${r.host}:${r.port} (${detail})`;
    });

    return { lines, verdict: verdictFor({ gmail587, gmail465, otherSmtp, https }) };
}

function verdictFor({ gmail587, otherSmtp, https }) {
    if (gmail587.ok) {
        return ['  El camino hasta Gmail está bien, así que el fallo del correo no es de red.',
                '  Mira el motivo que dio la comprobación: la cuenta, la contraseña de',
                '  aplicación o el mensaje.'];
    }
    if (otherSmtp.ok) {
        return ['  Se sale por el 587, pero NO hacia Gmail. Es Google el que no acepta',
                '  conexiones desde la IP de salida de este alojamiento, no un cortafuegos.',
                '  Reintentar no lo va a arreglar: hay que mandar por otro proveedor.'];
    }
    if (https.ok) {
        return ['  El 587 está bloqueado hacia fuera, sea cual sea el servidor. Ningún',
                '  ajuste del SMTP va a hacer que salga un correo desde aquí.',
                '  El 443 sí sale: la salida es un proveedor de correo por HTTPS.'];
    }
    return ['  No se llega a ninguno de los cuatro. Esto ya no es cosa del correo:',
            '  o no hay salida a internet, o la resolución de nombres está caída.',
            '  (La base de datos es externa: si el sitio funciona, mira ahí primero.)'];
}

module.exports = { run };
