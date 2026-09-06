'use strict';

/* =============================================================================
   mail.js — los dos correos que salen con cada solicitud nueva

   Cuando alguien termina el asistente (pgs/repair.html) salen dos avisos:

     - al cliente, si dejó su correo: unas líneas y el código de seguimiento,
       que es lo único que necesita para consultar su estado más tarde.
     - al taller: los datos de contacto y el trabajo pedido, para preparar el
       presupuesto sin tener que abrir el panel.

   Se mandan por la API HTTP de Resend (https://resend.com) con el `fetch` que
   ya trae Node, a propósito: así `pg` sigue siendo la única dependencia del
   proyecto. Hablar SMTP a mano —o traer nodemailer— era la alternativa.

   NINGUNO DE LOS DOS PUEDE TUMBAR UNA SOLICITUD. Para cuando se envían, la
   fila ya está en la base y el cliente ya tiene su código en pantalla. Que un
   correo no salga es una molestia; perder la solicitud por eso sería mucho
   peor. Por eso server.js los dispara DESPUÉS de responder el 201 y
   notifyNewRequest() no rechaza nunca: los fallos se registran y ya.

   Sin AUTOCOLOR_RESEND_KEY no se manda nada y el sitio funciona igual. Es lo
   que pasa en la máquina de trabajo, donde no hace falta una clave para
   probar el asistente.
   ========================================================================== */

const RESEND_URL = 'https://api.resend.com/emails';

// Resend tarda decenas de milisegundos cuando todo va bien. El tope está para
// que una llamada colgada no deje la promesa viva para siempre.
const TIMEOUT_MS = 10000;

const KEY = process.env.AUTOCOLOR_RESEND_KEY || '';

// El remitente tiene que ser una dirección de un dominio verificado en Resend.
// Hasta que autocolorayacucho.com lo esté, Resend rechaza el envío con un 403
// y el fallo queda en el registro. Se deja aquí y no en el código de cada
// correo para que cambiarlo sea una variable y no un despliegue.
const FROM = process.env.AUTOCOLOR_MAIL_FROM || 'Autocolor <info@autocolorayacucho.com>';

// A dónde va la copia del taller. Por ahora un Gmail personal, porque nadie
// tiene todavía las llaves de info@autocolorayacucho.com; cuando las haya,
// esto es una variable de entorno y no un cambio de código.
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
    return KEY.length > 0;
}

/**
 * Un valor del formulario en una sola línea.
 *
 * validateRequest() recorta los extremos pero no toca lo de dentro, así que un
 * nombre pegado desde otro sitio puede traer saltos de línea. En un cuerpo de
 * texto plano eso solo descuadra la lista de datos —no hay cabeceras que
 * inyectar, porque a Resend se le manda JSON y es él quien arma el mensaje—,
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
 * Manda un correo por Resend. Rechaza si la clave falta, si la petición se
 * cae o si Resend contesta con un error; quien llama decide qué hacer con eso
 * —aquí siempre es registrarlo—.
 */
async function send(message) {
    if (!isConfigured()) throw new Error('Falta AUTOCOLOR_RESEND_KEY');

    const response = await fetch(RESEND_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
        // El cuerpo de Resend dice por qué (dominio sin verificar, clave
        // vencida, destinatario inválido). Se recorta porque va al registro.
        const detail = await response.text().catch(() => '');
        throw new Error(`Resend respondió ${response.status}: ${detail.slice(0, 300)}`);
    }
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
    if (data.email) message.reply_to = [data.email];

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

    // El correo del cliente es opcional en el asistente. Sin él solo se manda
    // la copia del taller, que lleva el teléfono para poder responderle.
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

module.exports = {
    isConfigured,
    notifyNewRequest,
    // Exportados para poder revisar los cuerpos sin mandar nada (ver
    // tools/mailpreview.js).
    customerMessage,
    shopMessage,
};
