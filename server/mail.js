'use strict';

/* =============================================================================
   mail.js — los dos correos que salen con cada solicitud nueva

   Cuando alguien termina el asistente (pgs/repair.html) salen dos avisos:

     - al cliente: unas líneas y el código de seguimiento, que es lo único que
       necesita para consultar su estado más tarde.
     - al taller: los datos de contacto y el trabajo pedido, para preparar el
       presupuesto sin tener que abrir el panel.

   Salen por el SMTP de Gmail, con la cuenta del taller. No es lo más vistoso
   —el remitente es un @gmail.com y no el dominio del taller—, pero es lo
   único que hoy entrega de verdad: los servicios de correo por API solo dejan
   mandar desde un dominio verificado, y el sitio vive en el subdominio de
   Render, cuyo DNS es de Render. Cuando haya dominio propio, cambiar de
   transporte es este archivo y nada más.

   Es la razón de la segunda dependencia del proyecto, `nodemailer`. Hablar
   SMTP a mano se consideró y se descartó: la parte fácil es el diálogo con el
   servidor, y la que muerde es codificar los mensajes —los asuntos y los
   cuerpos van con tildes y con «ñ», y eso es MIME, quoted-printable y
   cabeceras codificadas—. Equivocarse ahí no rompe: entrega «Solicitud de
   PÃ©rez».

   NINGUNO DE LOS DOS PUEDE TUMBAR UNA SOLICITUD. Para cuando se envían, la
   fila ya está en la base y el cliente ya tiene su código en pantalla. Que un
   correo no salga es una molestia; perder la solicitud por eso sería mucho
   peor. Por eso server.js los dispara DESPUÉS de responder el 201 y
   notifyNewRequest() no rechaza nunca: los fallos se registran y ya.

   Sin AUTOCOLOR_SMTP_USER y AUTOCOLOR_SMTP_PASS no se manda nada y el sitio
   funciona igual. Es lo que pasa en la máquina de trabajo, donde no hace falta
   una cuenta para probar el asistente.
   ========================================================================== */

const nodemailer = require('nodemailer');

// La cuenta que manda. La contraseña NO es la del correo: es una «contraseña
// de aplicación» de 16 caracteres que Google emite aparte (myaccount.google.com
// → Seguridad → Verificación en dos pasos → Contraseñas de aplicaciones), y
// que se puede revocar sola sin tocar la cuenta. Google no acepta la
// contraseña normal por SMTP desde 2022.
const SMTP_USER = process.env.AUTOCOLOR_SMTP_USER || '';
const SMTP_PASS = process.env.AUTOCOLOR_SMTP_PASS || '';

// Gmail por omisión, pero configurable: cambiar de proveedor —a uno del
// dominio del taller, el día que lo haya— no debería ser un cambio de código.
// El 465 es TLS desde el primer byte; el 587 empieza en claro y sube con
// STARTTLS, y `secure` se deduce del puerto para que no puedan contradecirse.
const SMTP_HOST = process.env.AUTOCOLOR_SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.AUTOCOLOR_SMTP_PORT) || 465;

// Tope para conectar, para el saludo y para cada operación del diálogo SMTP.
const TIMEOUT_MS = 10000;

// Gmail reescribe el remitente al de la cuenta autenticada, así que ponerlo
// distinto no engaña a nadie: lo único que se elige es el nombre visible.
const FROM = process.env.AUTOCOLOR_MAIL_FROM || (SMTP_USER ? `Autocolor <${SMTP_USER}>` : '');

// A dónde va la copia del taller. Por ahora el Gmail personal que hace de
// buzón; cuando el taller tenga el suyo, esto es una variable de entorno y no
// un cambio de código.
const SHOP = process.env.AUTOCOLOR_MAIL_SHOP || 'gabrielesarria167@gmail.com';

// Para los enlaces de los correos. RENDER_EXTERNAL_URL la pone el alojamiento
// sola; en la máquina de trabajo no hay ninguna y los enlaces se omiten, que
// es mejor que mandar un http://localhost:3000 que no le sirve a nadie.
const SITE_URL = (process.env.AUTOCOLOR_SITE_URL || process.env.RENDER_EXTERNAL_URL || '')
    .replace(/\/+$/, '');

// Copia de src/staff.js. Son dos y no pueden leerse entre ellas —una corre en
// el navegador y la otra aquí—, así que las dos tienen que decir lo mismo, del
// mismo modo que los estados (ver la nota de src/statuses.js).
const QUALITY_LABELS = {
    standard: 'Económico',
    premium: 'Profesional',
    custom: 'Alta gama',
};

function isConfigured() {
    return SMTP_USER.length > 0 && SMTP_PASS.length > 0;
}

// Un solo transporte para todo el proceso, con su pool: nodemailer reaprovecha
// la conexión TLS en vez de rehacer el saludo y la autenticación en cada
// correo, y los dos de una solicitud salen casi siempre seguidos.
//
// Se crea perezosamente para que no cueste nada en la máquina de trabajo, que
// arranca sin cuenta configurada y no manda ningún correo.
let transport = null;

function getTransport() {
    if (transport) return transport;
    transport = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,   // 465 es TLS directo; 587 sube con STARTTLS
        auth: { user: SMTP_USER, pass: SMTP_PASS },
        pool: true,
        maxConnections: 1,
        // Los tres topes están para que un alojamiento que bloquee el puerto
        // de salida —cosa que pasa— falle y se registre, en vez de dejar la
        // promesa colgada para siempre.
        connectionTimeout: TIMEOUT_MS,
        greetingTimeout: TIMEOUT_MS,
        socketTimeout: TIMEOUT_MS,
    });
    return transport;
}

/**
 * Un valor del formulario en una sola línea.
 *
 * validateRequest() recorta los extremos pero no toca lo de dentro, así que un
 * nombre pegado desde otro sitio puede traer saltos de línea. En un cuerpo de
 * texto plano eso solo descuadra la lista de datos —no hay cabeceras que
 * inyectar: nodemailer codifica las cabeceras y es él quien arma el mensaje—,
 * pero un correo cuadrado se lee mejor.
 */
function oneLine(value) {
    if (value === undefined || value === null || value === '') return '';
    return String(value).replace(/\s+/g, ' ').trim();
}

/** «  Teléfono  +51935646304», o nada si el dato no vino. */
function row(label, value, width) {
    const clean = oneLine(value);
    if (!clean) return null;
    return `  ${label.padEnd(width)}  ${clean}`;
}

function block(title, rows) {
    const kept = rows.filter(Boolean);
    if (kept.length === 0) return null;
    return `${title}\n${kept.join('\n')}`;
}

/**
 * Manda un correo. Rechaza si falta la cuenta, si no se puede conectar o si el
 * servidor rechaza el mensaje; quien llama decide qué hacer con eso —aquí
 * siempre es registrarlo—.
 */
async function send(message) {
    if (!isConfigured()) throw new Error('Faltan AUTOCOLOR_SMTP_USER y AUTOCOLOR_SMTP_PASS');
    await getTransport().sendMail(message);
}

/* -----------------------------------------------------------------------------
   Los dos mensajes
-------------------------------------------------------------------------- */

function customerMessage(created, data) {
    const name = oneLine(data.firstName);
    const greeting = name ? `Hola ${name},` : 'Hola,';
    const lines = [
        greeting,
        '',
        'Recibimos tu solicitud de pintura. Te contactaremos en 24 horas con tu',
        'presupuesto personalizado.',
        '',
        'Tu código de seguimiento es:',
        '',
        `    ${created.id}`,
        '',
    ];

    // El mismo texto que la pantalla de éxito del asistente, para que el
    // correo no diga una cosa distinta de la que acaba de leer en el sitio.
    lines.push(SITE_URL
        ? `Guárdalo: con este código puedes ver el estado de tu solicitud en\n${SITE_URL}/pgs/repair.html#consulta`
        : 'Guárdalo: con este código puedes ver el estado de tu solicitud en nuestro sitio.');

    lines.push('', '— Autocolor');

    return {
        from: FROM,
        to: [data.email],
        // Solo el código, que lo genera el servidor. Nada que haya escrito
        // quien rellenó el formulario entra en el asunto.
        subject: `Tu solicitud en Autocolor — código ${created.id}`,
        text: lines.join('\n'),
    };
}

function shopMessage(created, data) {
    const vehicle = [oneLine(data.brand), oneLine(data.model)].filter(Boolean).join(' ');
    const zone = [oneLine(data.department), oneLine(data.province)].filter(Boolean).join(' / ');
    const quality = QUALITY_LABELS[data.quality] || data.quality;

    const blocks = [
        `Nueva solicitud desde el asistente del sitio.`,
        block('CLIENTE', [
            row('Nombre', `${oneLine(data.firstName)} ${oneLine(data.lastName)}`, 16),
            row('Teléfono', data.phone, 16),
            row('Email', data.email || '(no dejó)', 16),
            row('Zona', zone, 16),
        ]),
        block('VEHÍCULO', [
            row('Marca y modelo', vehicle, 16),
            row('Carrocería', data.bodyType, 16),
            row('Año', data.year, 16),
            row('Placa', data.plate, 16),
            row('Kilometraje', data.mileage === null ? '' : `${data.mileage.toLocaleString('es-PE')} km`, 16),
            row('Código de color', data.colorCode, 16),
            // La silueta del visor 3D no siempre coincide con la carrocería
            // real (el catálogo tiene cuatro siluetas y ocho carrocerías), así
            // que va aparte y no en lugar de la de arriba.
            row('Silueta 3D', data.vehicle, 16),
        ]),
        block('TRABAJO', [
            row('Acabado', quality, 16),
            row('Piezas', `(${data.parts.length}) ${data.parts.join(', ')}`, 16),
        ]),
        // Las notas se dejan como las escribió el cliente, con sus saltos de
        // línea: son lo único del formulario donde el formato dice algo.
        data.notes ? `NOTAS\n${data.notes}` : null,
        SITE_URL ? `Panel del taller: ${SITE_URL}/pgs/taller.html` : null,
    ];

    const message = {
        from: FROM,
        to: [SHOP],
        // La placa ya pasó por PLATE_RE y el código lo genera el servidor: los
        // dos son seguros de poner en el asunto.
        subject: `Solicitud ${created.id} — ${data.plate}`,
        text: blocks.filter(Boolean).join('\n\n'),
    };

    // Responder al correo del taller le escribe al cliente, que es lo que uno
    // quiere hacer al leerlo.
    if (data.email) message.replyTo = data.email;

    return message;
}

/* -----------------------------------------------------------------------------
   Lo que llama server.js
-------------------------------------------------------------------------- */

/**
 * Avisa de una solicitud nueva por correo. No rechaza nunca: se la puede
 * llamar sin `await` y sin `.catch()` desde el manejador de POST /api/requests,
 * que es justo lo que hace, porque el 201 ya salió.
 *
 * Los dos envíos van en paralelo y por separado: que el cliente no tenga
 * correo, o que el suyo rebote, no puede dejar al taller sin su copia.
 */
async function notifyNewRequest(created, data) {
    if (!isConfigured()) return;

    const jobs = [
        send(shopMessage(created, data))
            .then(() => { console.log(`[mail] aviso al taller de ${created.id}`); })
            .catch((err) => { console.error(`[mail] no salió el aviso al taller de ${created.id}: ${err.message}`); }),
    ];

    // El asistente ya lo exige, pero la guarda se queda: en la base hay
    // solicitudes anteriores a que el correo fuera obligatorio, y sin ella
    // reenviar una de esas mandaría un mensaje a `undefined`.
    if (data.email) {
        jobs.push(
            send(customerMessage(created, data))
                // La dirección no se registra: el registro del alojamiento no
                // es sitio para los datos de contacto de un cliente. El código
                // basta para seguir el rastro en la base.
                .then(() => { console.log(`[mail] confirmación al cliente de ${created.id}`); })
                .catch((err) => { console.error(`[mail] no salió la confirmación de ${created.id}: ${err.message}`); })
        );
    }

    await Promise.all(jobs);
}

/**
 * Cierra la conexión SMTP del pool. Solo la llama el apagado ordenado de
 * server.js, junto al cierre del pool de Postgres: sin esto queda un socket
 * abierto contra Gmail mientras el proceso termina de irse.
 */
function close() {
    if (transport) {
        transport.close();
        transport = null;
    }
}

module.exports = {
    isConfigured,
    notifyNewRequest,
    close,
    // Exportados para poder revisar los cuerpos sin mandar nada (ver
    // tools/mailpreview.js).
    customerMessage,
    shopMessage,
};
