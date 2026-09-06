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

const dns = require('node:dns').promises;
const net = require('node:net');
const path = require('node:path');
const nodemailer = require('nodemailer');
const mailhtml = require('./mailhtml');

// La cuenta que manda. La contraseña NO es la del correo: es una «contraseña
// de aplicación» de 16 caracteres que Google emite aparte (myaccount.google.com
// → Seguridad → Verificación en dos pasos → Contraseñas de aplicaciones), y
// que se puede revocar sola sin tocar la cuenta. Google no acepta la
// contraseña normal por SMTP desde 2022.
const SMTP_USER = process.env.AUTOCOLOR_SMTP_USER || '';
const SMTP_PASS = process.env.AUTOCOLOR_SMTP_PASS || '';

// Gmail por omisión, pero configurable: cambiar de proveedor —a uno del
// dominio del taller, el día que lo haya— no debería ser un cambio de código.
//
// EL PUERTO ES EL 587 Y NO EL 465 POR UNA RAZÓN MEDIDA: Render deja salir por
// el 587 y no por el 465. Con el 465 los dos avisos de cada solicitud morían
// en «Connection timeout» —un tiempo agotado, no un rechazo: los paquetes se
// pierden sin respuesta, que es como se ve un cortafuegos del alojamiento—.
// Cambiar el puerto fue lo único que hizo falta.
//
// El 465 es TLS desde el primer byte; el 587 empieza en claro y sube con
// STARTTLS, y `secure` se deduce del puerto para que no puedan contradecirse.
const SMTP_HOST = process.env.AUTOCOLOR_SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.AUTOCOLOR_SMTP_PORT) || 587;

// Los topes del diálogo SMTP.
//
// Están para que un alojamiento que bloquee el puerto de salida falle y se
// registre en vez de dejar la promesa colgada para siempre. Eso NO pide que
// sean cortos: los dos correos salen después de contestar el 201, así que
// esperar un minuto por una conexión lenta no le cuesta nada a nadie —solo
// retrasa un renglón del registro—, mientras que cortar demasiado pronto sí
// cuesta el correo entero.
//
// Estuvieron en 10 s los tres y se quedaban cortos: Render duerme las
// instancias del plan gratuito, y la primera conexión de salida de un
// contenedor recién despierto no siempre entra en diez segundos. El síntoma
// era «Connection timeout» —el nombre que nodemailer le da justo a este
// tope—, con la solicitud guardada y ningún correo.
const CONNECT_TIMEOUT_MS = 60000;   // establecer el TCP
const GREETING_TIMEOUT_MS = 30000;  // el 220 del servidor, ya conectados
const SOCKET_TIMEOUT_MS = 60000;    // inactividad durante el diálogo

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

// El logotipo se manda pegado al mensaje y el HTML lo referencia por su
// identificador (cid:). Ni una URL —muchos clientes no bajan imágenes remotas
// sin permiso— ni un data: URI, que Gmail borra. Es una versión de 480 px y
// 18 KB hecha para esto: la del sitio pesa 218 KB y se pagaría en cada correo.
const LOGO = {
    filename: 'autocolor.jpg',
    path: path.join(__dirname, '..', 'imgs', 'logoEmail.jpg'),
    cid: mailhtml.LOGO_CID,
};

// Copia de src/staff.js. Son dos y no pueden leerse entre ellas —una corre en
// el navegador y la otra aquí—, así que las dos tienen que decir lo mismo, del
// mismo modo que los estados (ver la nota de src/statuses.js).
const QUALITY_LABELS = {
    standard: 'Económico',
    premium: 'Profesional',
    custom: 'Alta gama',
};

// Copia de src/repair.js, por lo mismo que la de arriba. El taller pide un
// presupuesto por pieza, y «rear_door_left» no es lo que nadie va a escribir
// en él. Una pieza que falte aquí sale con su identificador, como en el
// asistente: se degrada, no se rompe.
const PART_LABELS = {
    hood: 'Capó',
    roof: 'Techo',
    front_bumper: 'Parachoques delantero',
    tonneau: 'Platón y portón',
    tailgate: 'Portón trasero',
    rear_bumper: 'Parachoques trasero',
    back_door_left: 'Puerta corrediza izquierda',
    back_door_right: 'Puerta corrediza derecha',
    left_fender: 'Guardabarros delantero izquierdo',
    right_fender: 'Guardabarros delantero derecho',
    rear_window_left: 'Panel lateral trasero izquierdo',
    rear_window_right: 'Panel lateral trasero derecho',
    back_bumper: 'Parachoques trasero',
    Object_26: 'Moldura trasera del techo',
    bumper: 'Parachoques delantero',
    front_door_left: 'Puerta delantera izquierda',
    front_door_right: 'Puerta delantera derecha',
    rear_door_left: 'Puerta trasera izquierda',
    rear_door_right: 'Puerta trasera derecha',
    fender_left: 'Guardabarros delantero izquierdo',
    fender_right: 'Guardabarros delantero derecho',
    quarter_panel_left: 'Guardabarros trasero izquierdo',
    quarter_panel_right: 'Guardabarros trasero derecho',
    side_skirt_left: 'Faldón lateral izquierdo',
    side_skirt_right: 'Faldón lateral derecho',
    rear_hatch: 'Portón trasero',
};

// Copia de src/carModels.js (BODY_TYPES) y de src/lookup.js (VEHICLE_LABELS).
// Sin ellas el correo del taller decía «sedan» y «wagon» —los identificadores
// del catálogo— donde el resto del sitio dice «Sedán» y «Familiar».
const BODY_TYPE_LABELS = {
    sedan: 'Sedán',
    hatchback: 'Hatchback',
    coupe: 'Coupé',
    wagon: 'Station wagon',
    suv: 'SUV',
    pickup: 'Pickup',
    minivan: 'Minivan',
    van: 'Furgoneta',
};

const VEHICLE_LABELS = {
    van: 'Furgoneta',
    wagon: 'Familiar',
    pickup: 'Pickup',
    suv: 'SUV',
};

function partLabel(id) {
    return PART_LABELS[id] || id;
}

function bodyTypeLabel(id) {
    return BODY_TYPE_LABELS[id] || id;
}

function vehicleLabel(id) {
    return VEHICLE_LABELS[id] || id;
}

/**
 * '+51935646304' -> '+51 935 646 304'. Un número de nueve dígitos de corrido
 * no se lee ni se dicta; el sitio lo enseña así en todas partes.
 */
function formatPhone(value) {
    const match = /^\+51(\d{3})(\d{3})(\d{3})$/.exec(oneLine(value));
    return match ? `+51 ${match[1]} ${match[2]} ${match[3]}` : oneLine(value);
}

function qualityLabel(id) {
    return QUALITY_LABELS[id] || id;
}

// Lo que mailhtml.js necesita de aquí para armar las dos maquetas. Se pasa en
// vez de que allí se importe medio módulo: así las etiquetas y la dirección
// del sitio siguen viviendo en un solo sitio.
function htmlContext() {
    return { oneLine, partLabel, qualityLabel, bodyTypeLabel, vehicleLabel,
             formatPhone, siteUrl: SITE_URL,
             partsLabel: (parts) => parts.map(partLabel).join(', ') };
}

function isConfigured() {
    return SMTP_USER.length > 0 && SMTP_PASS.length > 0;
}

/**
 * Resuelve el servidor de correo a una dirección IPv4.
 *
 * Hace falta porque Render no tiene salida IPv6 y smtp.gmail.com responde con
 * las dos familias. nodemailer pide los registros A y los AAAA, los junta y
 * ELIGE UNO AL AZAR (shared/index.js: `addresses[Math.floor(Math.random() *
 * …)]`), así que sin esto, una de cada dos solicitudes salía con:
 *
 *     connect ENETUNREACH 2607:f8b0:4004:c19::6c:465 - Local (:::0)
 *
 * Tiene una lista de reserva para reintentar con otra dirección, pero solo
 * durante el saludo inicial, y el tope de diez segundos la cortaba: el segundo
 * correo de la misma solicitud terminaba en «Connection timeout».
 *
 * Dándole una IP ya resuelta se salta su resolución entera —`net.isIP()` la
 * ataja— y solo quedan direcciones alcanzables. El nombre viaja aparte, en
 * `servername`, para que el certificado se siga comprobando contra
 * smtp.gmail.com y no contra un número.
 *
 * Si el servidor no tuviera registros A —un servidor solo IPv6—, se devuelve
 * el nombre sin tocar y que nodemailer resuelva como sabe: forzar IPv4 no
 * puede convertirse en no poder conectar nunca.
 */
async function resolveIpv4(host) {
    if (net.isIP(host)) return host;
    try {
        const addresses = await dns.resolve4(host);
        return addresses.length > 0 ? addresses[0] : host;
    } catch {
        return host;
    }
}

// Un solo transporte para todo el proceso, con su pool: nodemailer reaprovecha
// la conexión TLS en vez de rehacer el saludo y la autenticación en cada
// correo, y los dos de una solicitud salen casi siempre seguidos.
//
// Se crea perezosamente para que no cueste nada en la máquina de trabajo, que
// arranca sin cuenta configurada y no manda ningún correo.
//
// SE GUARDA LA PROMESA, NO EL TRANSPORTE. Los dos correos de una solicitud
// salen a la vez (Promise.all en notifyNewRequest), y resolver la IP es una
// espera: guardando el transporte, los dos pasaban el `if` antes de que
// ninguno hubiera asignado y se creaban DOS, con dos conexiones a Gmail de las
// que una quedaba huérfana —y sin cerrar, porque close() solo conocía la
// última—. Guardando la promesa, el segundo espera a la del primero.
let transportPromise = null;

// La dirección con la que se acabó conectando, para describe(). Sale del
// transporte, pero pedírselo obligaría a esperar la promesa en un sitio que no
// puede.
let resolvedAddress = null;

function getTransport() {
    if (!transportPromise) transportPromise = createTransport();
    return transportPromise;
}

async function createTransport() {
    const host = await resolveIpv4(SMTP_HOST);
    resolvedAddress = host;
    return nodemailer.createTransport({
        host,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,   // 465 es TLS directo; 587 sube con STARTTLS
        // Con el 587 la conexión empieza en claro y se sube con STARTTLS. Sin
        // esto, un servidor que no lo ofrezca haría que la contraseña saliera
        // sin cifrar: con requireTLS el envío falla antes de autenticarse, que
        // es lo que tiene que pasar. Con el 465 no cambia nada, porque ahí ya
        // es TLS desde el primer byte.
        requireTLS: true,
        // El certificado se comprueba contra el nombre, no contra la IP que
        // se acaba de resolver. Si lo configurado ya era una IP no hay nombre
        // que comprobar, y ponerla como SNI lo prohíbe el RFC 6066: Node avisa
        // de que lo ignorará.
        ...(net.isIP(SMTP_HOST) ? {} : { tls: { servername: SMTP_HOST } }),
        auth: { user: SMTP_USER, pass: SMTP_PASS },
        pool: true,
        maxConnections: 1,
        connectionTimeout: CONNECT_TIMEOUT_MS,
        greetingTimeout: GREETING_TIMEOUT_MS,
        socketTimeout: SOCKET_TIMEOUT_MS,
    });
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
    const started = Date.now();
    try {
        await (await getTransport()).sendMail(message);
    } catch (err) {
        // Con a dónde y cuánto tardó, un fallo se lee sin tener que adivinar:
        // «ETIMEDOUT tras 60,0 s contra 142.251.127.108:587» dice que el
        // alojamiento no llega, y uno de 0,2 s con un 535 dice que sí llega y
        // que lo que está mal es la cuenta.
        err.message = `${err.message} (${SMTP_HOST} ${resolvedAddress || '?'}:${SMTP_PORT}, tras ${((Date.now() - started) / 1000).toFixed(1)} s)`;
        // AQUÍ NO SE CIERRA EL TRANSPORTE. Los dos correos de una solicitud
        // comparten un pool de una sola conexión, así que cerrarlo por haber
        // fallado uno se lleva por delante al otro, que estaba en la cola:
        //
        //   no salió el aviso al taller: Greeting never received (…, tras 30 s)
        //   no salió la confirmación:    Connection pool was closed (…)
        //
        // El segundo no falló por nada suyo. Tirar el transporte sigue siendo
        // lo correcto —puede haber quedado con una IP vieja o una conexión
        // muerta—, pero cuando no queda nadie usándolo: lo hace
        // notifyNewRequest() con los dos ya terminados.
        throw err;
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
        // Los dos cuerpos viajan juntos (multipart/alternative). El texto no
        // es un resto: es lo que se ve en los clientes que no pintan HTML y en
        // los avisos del reloj o del móvil, y lo que salva el mensaje si las
        // imágenes vienen bloqueadas.
        text: lines.join('\n'),
        html: mailhtml.customerHtml(created, data, htmlContext()),
        attachments: [LOGO],
    };
}

function shopMessage(created, data) {
    const vehicle = [oneLine(data.brand), oneLine(data.model)].filter(Boolean).join(' ');
    const zone = [oneLine(data.department), oneLine(data.province)].filter(Boolean).join(' / ');
    const quality = qualityLabel(data.quality);

    const blocks = [
        `Nueva solicitud desde el asistente del sitio.`,
        block('CLIENTE', [
            row('Nombre', `${oneLine(data.firstName)} ${oneLine(data.lastName)}`, 16),
            row('Teléfono', formatPhone(data.phone), 16),
            row('Email', data.email || '(no dejó)', 16),
            row('Zona', zone, 16),
        ]),
        block('VEHÍCULO', [
            row('Marca y modelo', vehicle, 16),
            row('Carrocería', bodyTypeLabel(data.bodyType), 16),
            row('Año', data.year, 16),
            row('Placa', data.plate, 16),
            row('Kilometraje', data.mileage === null ? '' : `${data.mileage.toLocaleString('es-PE')} km`, 16),
            row('Código de color', data.colorCode, 16),
            // La silueta del visor 3D no siempre coincide con la carrocería
            // real (el catálogo tiene cuatro siluetas y ocho carrocerías), así
            // que va aparte y no en lugar de la de arriba.
            row('Silueta 3D', vehicleLabel(data.vehicle), 16),
        ]),
        block('TRABAJO', [
            row('Acabado', quality, 16),
            row('Piezas', `(${data.parts.length}) ${data.parts.map(partLabel).join(', ')}`, 16),
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
        html: mailhtml.shopHtml(created, data, htmlContext()),
        attachments: [LOGO],
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

    const tasks = [
        { what: 'aviso al taller', message: shopMessage(created, data) },
    ];

    // El asistente ya lo exige, pero la guarda se queda: en la base hay
    // solicitudes anteriores a que el correo fuera obligatorio, y sin ella
    // reenviar una de esas mandaría un mensaje a `undefined`.
    if (data.email) {
        tasks.push({ what: 'confirmación al cliente', message: customerMessage(created, data) });
    }

    const failed = await sendAll(tasks, created.id, false);
    if (failed.length === 0) return;

    // UN SEGUNDO INTENTO, Y UNO SOLO. Render duerme las instancias del plan
    // gratuito y la primera conexión de salida de un contenedor recién
    // despierto a veces no llega a tiempo: un envío que falla así vuelve a
    // funcionar enseguida. Antes se tiran el transporte y la IP resuelta, que
    // es lo que puede haber quedado inservible; con los dos correos ya
    // terminados no hay nadie a quien cerrarle el pool por debajo.
    close();
    await sendAll(failed, created.id, true);
}

/**
 * Manda las tareas a la vez y devuelve las que fallaron.
 *
 * Un fallo de la primera vuelta se registra como aviso y no como error: si el
 * reintento sale bien, no ha pasado nada que mirar por la mañana.
 */
async function sendAll(tasks, id, isRetry) {
    const failed = [];
    await Promise.all(tasks.map((task) => send(task.message)
        .then(() => {
            // Las direcciones no se registran: el registro del alojamiento no
            // es sitio para los datos de contacto de un cliente. El código
            // basta para seguir el rastro en la base.
            console.log(`[mail] ${task.what} de ${id}${isRetry ? ' (al segundo intento)' : ''}`);
        })
        .catch((err) => {
            failed.push(task);
            if (isRetry) {
                console.error(`[mail] no salió ${task.what} de ${id}: ${err.message}`);
            } else {
                console.warn(`[mail] falló ${task.what} de ${id}, reintentando: ${err.message}`);
            }
        })));
    return failed;
}

/**
 * Comprueba que se puede conectar y autenticar, sin mandar nada. Es lo que
 * server.js dice al arrancar.
 *
 * Existe porque el fallo del correo es invisible: las solicitudes se siguen
 * guardando y el sitio se ve perfecto, así que sin esto la primera señal de
 * que la cuenta está mal es que alguien no recibió su código, días después.
 * Preguntarlo al arrancar convierte eso en un renglón del registro del
 * despliegue, que es donde se mira.
 *
 * Devuelve { ok: true } o { ok: false, error } — no lanza.
 */
async function verify() {
    if (!isConfigured()) return { ok: false, error: 'faltan AUTOCOLOR_SMTP_USER y AUTOCOLOR_SMTP_PASS' };
    const started = Date.now();
    try {
        await (await getTransport()).verify();
        return { ok: true, address: resolvedAddress };
    } catch (err) {
        // El mensaje se arma ANTES de cerrar: close() olvida la dirección
        // resuelta, que es justo el dato que hace falta para leer el fallo.
        const detail = `${err.message} (${SMTP_HOST} ${resolvedAddress || '?'}:${SMTP_PORT}, tras ${((Date.now() - started) / 1000).toFixed(1)} s)`;
        close();
        return { ok: false, error: detail };
    }
}

/** La configuración del correo, sin la contraseña. Para /api/staff/whoami. */
function describe() {
    return {
        configured: isConfigured(),
        host: SMTP_HOST,
        port: SMTP_PORT,
        // La dirección con la que se conectó de verdad, que es distinta del
        // nombre de arriba: tiene que ser IPv4 (ver resolveIpv4). Es lo que
        // habría dicho a la primera de qué iba el ENETUNREACH de Render.
        // `null` mientras no se haya mandado nada todavía.
        address: resolvedAddress,
        from: FROM,
        shop: SHOP,
    };
}

/**
 * Cierra la conexión SMTP del pool. Solo la llama el apagado ordenado de
 * server.js, junto al cierre del pool de Postgres: sin esto queda un socket
 * abierto contra Gmail mientras el proceso termina de irse.
 */
function close() {
    if (!transportPromise) return;
    const pending = transportPromise;
    transportPromise = null;
    resolvedAddress = null;
    // La promesa puede seguir en marcha (resolviendo la IP): se cierra cuando
    // termine, y si terminó en error no hay nada que cerrar.
    pending.then((t) => t.close()).catch(() => {});
}

module.exports = {
    isConfigured,
    verify,
    describe,
    notifyNewRequest,
    close,
    // Exportados para poder revisar los cuerpos sin mandar nada (ver
    // tools/mailpreview.js).
    customerMessage,
    shopMessage,
};
