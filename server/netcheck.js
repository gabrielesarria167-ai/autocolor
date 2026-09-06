'use strict';

/* =============================================================================
   netcheck.js — a dónde llega este alojamiento y a dónde no

   Existe porque «no se pudo conectar» no distingue tres situaciones que se
   arreglan de maneras distintas:

     1. No hay salida a internet, o el DNS no contesta. Entonces no es cosa
        del correo y hay que mirar el alojamiento.
     2. Se sale bien, pero la API de Brevo no responde. Entonces no hay nada
        que arreglar aquí: es esperar, que para eso están los reintentos.
     3. Se llega a todo, y lo que falla es la llave, el remitente sin verificar
        o el mensaje. Eso lo dice el motivo que dio la comprobación.

   Se prueba abriendo un socket y nada más: ni se habla HTTP ni se manda un
   byte. Lo único que se mide es si el saludo TCP llega a completarse.

   ESTO SE ESCRIBIÓ PARA EL PROBLEMA ANTERIOR, cuando los correos salían por el
   SMTP de Gmail y morían en «Connection timeout» sin decir por qué (ver la
   cabecera de server/mail.js). Se queda, apuntado al transporte de ahora,
   porque la pregunta que contesta —«¿llega este alojamiento a donde tiene que
   llegar?»— es la misma el día que algo vuelva a fallar.

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

// Las tres preguntas, en el orden en que se leen: el destino que usamos, otro
// del mismo tipo para saber si el problema es suyo o nuestro, y un tercero que
// solo comprueba que este contenedor sale a internet.
const PROBES = [
    { label: 'la API de Brevo (la que usamos)', host: 'api.brevo.com', port: 443 },
    { label: 'otro sitio cualquiera por HTTPS', host: 'www.cloudflare.com', port: 443 },
    { label: 'la base de datos (Neon)', host: 'console.neon.tech', port: 443 },
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
