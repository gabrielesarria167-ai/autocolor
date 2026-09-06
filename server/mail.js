'use strict';

/* =============================================================================
   mail.js — los dos correos que salen con cada solicitud nueva

   Cuando alguien termina el asistente (pgs/repair.html) salen dos avisos:

     - al cliente: unas líneas y el código de seguimiento, que es lo único que
       necesita para consultar su estado más tarde.
     - al taller: los datos de contacto y el trabajo pedido, para preparar el
       presupuesto sin tener que abrir el panel.

   Salen por el SMTP de Gmail, con la cuenta del taller. El remitente es un
   @gmail.com y no el dominio del taller, porque no hay dominio del taller: el
   sitio vive en el subdominio de Render, cuyo DNS es de Render, y casi todos
   los servicios de correo por API piden un dominio verificado para dejar
   mandar. Cuando lo haya, cambiar de transporte es este archivo y nada más
   (ver NEXT-STEPS.md, que también anota la alternativa por HTTPS para
   mientras tanto).

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
   notifyNewRequest() no lanza ni rechaza nunca: los fallos se registran y ya.

   NO SALEN EN EL ACTO: van a una cola (OUTBOX) que los manda de uno en uno y
   reintenta los que fallan durante casi una hora. Eso no es un lujo. Desde
   Render, las conexiones a Gmail se pierden a ratos —el SYN sale y no vuelve
   nada—, y con un solo intento la mitad de los avisos no llegaba. Con la cola,
   un correo que hoy fallaba se manda unos minutos más tarde y llega.

   Sin AUTOCOLOR_SMTP_USER y AUTOCOLOR_SMTP_PASS no se manda nada y el sitio
   funciona igual. Es lo que pasa en la máquina de trabajo, donde no hace falta
   una cuenta para probar el asistente.
   ========================================================================== */

const dns = require('node:dns').promises;
const fs = require('node:fs');
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
// ESTUVIERON EN 60 s Y NO ARREGLARON NADA. La idea era que Render duerme las
// instancias del plan gratuito y que la primera conexión de un contenedor
// recién despierto tardaría; la medida dice otra cosa: una conexión sana a
// smtp.gmail.com:587 se establece en 22 milésimas de segundo. Las que fallan
// no van lentas —se pierden—, así que esperar 60 s por ellas solo hacía que
// cada fallo tardara un minuto en aparecer en el registro.
//
// Lo que sí rescata un correo es volver a intentarlo un rato después (ver
// RETRY_DELAYS_MS), y para eso conviene que cada intento se rinda pronto.
const CONNECT_TIMEOUT_MS = 15000;   // establecer el TCP
const GREETING_TIMEOUT_MS = 15000;  // el 220 del servidor, ya conectados
const SOCKET_TIMEOUT_MS = 30000;    // inactividad durante el diálogo

// Cuánto se espera antes de cada reintento, contando desde el intento
// anterior: seis intentos en total repartidos en unos 48 minutos.
//
// POR QUÉ TAN SEPARADOS. Desde Render el fallo es «Connection timeout» contra
// Gmail: en un rato salen y en otro no. Reintentar a los dos segundos vuelve a
// caer en el mismo rato malo. Además smtp.gmail.com resuelve a una dirección
// distinta cada pocos minutos —el TTL de su registro A ronda los 135 s—, así
// que esperar también cambia la IP contra la que se prueba, y con ella la ruta
// que estaba tragándose los paquetes.
//
// Que tarde no importa: cuando estos correos salen, la solicitud ya está
// guardada y el cliente ya tiene su código en pantalla. Un aviso que llega
// media hora tarde es infinitamente mejor que uno que no llega.
const RETRY_DELAYS_MS = [30000, 120000, 300000, 900000, 1800000];

// Tope de la cola. Con el correo caído y alguien insistiendo en el formulario,
// esto es lo que se guarda antes de empezar a tirar lo más viejo. No es una
// cifra medida: es un techo para que un fallo del correo no se coma la memoria
// del proceso, que es lo único que aquí no puede pasar.
const MAX_OUTBOX = 100;

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
//
// Se lee UNA VEZ, al cargar el módulo, y no con `path:`, que le pide a
// nodemailer un createReadStream por cada correo que sale. Son 18 KB y el
// proceso vive semanas.
const LOGO = readLogo();

function readLogo() {
    try {
        return [{
            filename: 'autocolor.jpg',
            content: fs.readFileSync(path.join(__dirname, '..', 'imgs', 'logoEmail.jpg')),
            cid: mailhtml.LOGO_CID,
        }];
    } catch (err) {
        // Sin logotipo los correos salen igual, con el texto alternativo donde
        // iba la imagen. Que falte un adjunto no puede impedir que arranque el
        // sitio entero.
        console.warn(`[mail] los correos saldrán sin logotipo: ${err.message}`);
        return [];
    }
}

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

// Object.hasOwn y no `MAPA[id] || id`: sin él, `id` valiendo 'constructor' o
// 'toString' saca lo que hereda el objeto de Object.prototype, y el correo del
// taller pedía presupuesto para «function Object() { [native code] }». Las
// piezas vienen del formulario, así que el que las escribe elige el `id`.
function label(map, id) {
    return Object.hasOwn(map, id) ? map[id] : id;
}

function partLabel(id) {
    return label(PART_LABELS, id);
}

function bodyTypeLabel(id) {
    return label(BODY_TYPE_LABELS, id);
}

function vehicleLabel(id) {
    return label(VEHICLE_LABELS, id);
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
    return label(QUALITY_LABELS, id);
}

/**
 * 85000 -> «85,000 km», y nada si no lo dejó.
 *
 * Existe como función porque los dos cuerpos —el de texto y el HTML— lo
 * necesitan, y mientras fueron dos expresiones copiadas se separaron: una
 * miraba solo `null` y la otra `null` y `undefined`, así que un kilometraje
 * ausente armaba bien el HTML y reventaba el texto. Lo mismo vale para
 * zoneLabel() y vehicleName().
 */
function mileageLabel(value) {
    return value === null || value === undefined ? '' : `${value.toLocaleString('es-PE')} km`;
}

/** «Ayacucho / Huamanga». */
function zoneLabel(data) {
    return [oneLine(data.department), oneLine(data.province)].filter(Boolean).join(' / ');
}

/** «Toyota Corolla», y con el año si se pide. */
function vehicleName(data, withYear) {
    const parts = [oneLine(data.brand), oneLine(data.model)];
    if (withYear) parts.push(data.year);
    return parts.filter(Boolean).join(' ');
}

// Lo que mailhtml.js necesita de aquí para armar las dos maquetas. Se pasa en
// vez de que allí se importe medio módulo: así las etiquetas y la dirección
// del sitio siguen viviendo en un solo sitio.
function htmlContext() {
    return { oneLine, partLabel, qualityLabel, bodyTypeLabel, vehicleLabel,
             formatPhone, mileageLabel, zoneLabel, vehicleName,
             siteUrl: SITE_URL,
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
 * durante el saludo inicial, y el tope del saludo la cortaba: el segundo
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
// Se llama una vez POR INTENTO y no una vez por proceso: con el TTL de Gmail
// —unos 135 s— un reintento de dentro de media hora resuelve a otra IP, y con
// ella a otra ruta, que es media razón para reintentar.
async function resolveIpv4(host) {
    if (net.isIP(host)) return host;
    try {
        const addresses = await dns.resolve4(host);
        return addresses.length > 0 ? addresses[0] : host;
    } catch {
        return host;
    }
}

// UN TRANSPORTE POR INTENTO, Y SIN POOL.
//
// Antes había uno solo para todo el proceso, con un pool de una conexión, para
// no rehacer el saludo TLS en cada correo. Salía mucho más caro de lo que
// ahorraba, por dos motivos que costaron sendos correos perdidos:
//
//   - EL POOL ES ESTADO COMPARTIDO. Cerrarlo desde el código de una solicitud
//     —para tirar una conexión que se creía muerta— se llevaba por delante el
//     correo que tenía otra esperando en la cola. Y peor: sendMail() sobre un
//     pool ya cerrado no resuelve NI rechaza, así que ese correo desaparecía
//     sin dejar un solo renglón en el registro.
//   - LA IP SE QUEDABA FIJA. Se resolvía una vez y valía para toda la vida del
//     proceso, de modo que si la primera resolución caía en una dirección que
//     Render no alcanza, TODOS los avisos de esa instancia iban a esa
//     dirección hasta el siguiente despliegue.
//
// Con un transporte por intento no hay nada compartido que cerrar, cada
// reintento vuelve a resolver el nombre —y con el TTL de Gmail eso suele dar
// otra IP, que es medio arreglo por sí solo— y la cola de abajo manda de uno
// en uno, así que tampoco hay dos conexiones simultáneas que reaprovechar.
// Lo que se paga es un saludo TLS por correo: 22 ms medidos, en un envío que
// de todos modos va detrás de la respuesta al cliente.

// La dirección con la que se conectó la última vez, para describe() y para los
// mensajes de error. `null` mientras no se haya intentado nada.
let lastAddress = null;

async function createTransport() {
    const host = await resolveIpv4(SMTP_HOST);
    lastAddress = host;
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

// El ancho de la columna de etiquetas del cuerpo de texto. Cabe la más larga
// («Código de color») con un espacio de sobra.
const LABEL_WIDTH = 16;

/** «  Teléfono          +51935646304», o nada si el dato no vino. */
function row(label, value) {
    const clean = oneLine(value);
    if (!clean) return null;
    return `  ${label.padEnd(LABEL_WIDTH)}  ${clean}`;
}

function block(title, rows) {
    const kept = rows.filter(Boolean);
    if (kept.length === 0) return null;
    return `${title}\n${kept.join('\n')}`;
}

// UN SOLO DIÁLOGO SMTP A LA VEZ EN TODO EL PROCESO, la cola y la comprobación
// del arranque incluidas. Dos conexiones simultáneas a Gmail desde la IP
// compartida del plan gratuito de Render es justo el patrón que hace que
// empiecen a perderse paquetes, y aquí no hay ninguna prisa que justifique el
// paralelismo: estos correos van detrás de una respuesta que ya salió.
//
// Hace falta que sea del proceso y no solo de la cola porque en Render las dos
// cosas se pisan de verdad: la instancia dormida se despierta CON una
// solicitud, así que la comprobación del arranque cae encima del primer envío.
let inFlight = Promise.resolve();

function oneAtATime(work) {
    const next = inFlight.then(work, work);
    // La cadena nunca se queda en rechazado: el siguiente de la fila no tiene
    // nada que ver con el fallo del anterior, y si se quedara, arrastraría el
    // error a un envío que no lo cometió.
    inFlight = next.then(() => {}, () => {});
    return next;
}

/**
 * Abre un transporte, hace con él lo que se le pida y lo suelta.
 *
 * El error sale diciendo a dónde iba y cuánto tardó, que es lo que hace que un
 * fallo se lea sin adivinar: «ETIMEDOUT tras 15,0 s contra
 * 142.251.127.108:587» dice que el alojamiento no llega, y uno de 0,2 s con un
 * 535 dice que sí llega y que lo que está mal es la cuenta.
 */
function withTransport(work) {
    return oneAtATime(async () => {
        const started = Date.now();
        const transport = await createTransport();
        try {
            return await work(transport);
        } catch (err) {
            err.message = `${err.message} (${SMTP_HOST} ${lastAddress || '?'}:${SMTP_PORT}, tras ${((Date.now() - started) / 1000).toFixed(1)} s)`;
            throw err;
        } finally {
            // Suelta lo que el transporte tuviera cogido. Sin pool no hay
            // conexión compartida detrás, así que esto no puede cortarle nada
            // a nadie: era justo lo que sí pasaba antes.
            transport.close();
        }
    });
}

/**
 * Un intento de envío. Rechaza si falta la cuenta, si no se puede conectar o
 * si el servidor rechaza el mensaje; quien llama decide si reintentar —lo hace
 * drain()— o rendirse.
 */
async function attemptSend(message) {
    if (!isConfigured()) throw new Error('Faltan AUTOCOLOR_SMTP_USER y AUTOCOLOR_SMTP_PASS');
    await withTransport((transport) => transport.sendMail(message));
}

/**
 * ¿Tiene sentido volver a intentarlo?
 *
 * Un 5xx es el servidor contestando que no: la contraseña de aplicación está
 * mal (535), la dirección no existe (550). Repetirlo cinco veces no lo
 * arregla, y en el caso de la contraseña le regala a Google cinco intentos
 * fallidos de autenticación desde la misma IP.
 *
 * Todo lo demás —tiempos agotados, conexiones cortadas, fallos de DNS, 4xx—
 * es pasajero por definición, y es exactamente lo que falla desde Render.
 */
function isPermanent(err) {
    if (err.code === 'EAUTH') return true;
    return Number.isInteger(err.responseCode) && err.responseCode >= 500 && err.responseCode < 600;
}

/**
 * ¿Sabemos con certeza que el mensaje NO llegó a entregarse?
 *
 * Un fallo de conexión lo dice sin ambigüedad: si el saludo TCP no se
 * completó, o el servidor no llegó a contestar su 220, no salió ni un byte del
 * mensaje. Reintentar eso es gratis. Es el caso de TODO lo que está fallando
 * hoy desde Render.
 *
 * La excepción es la ventana entre que se manda el cuerpo y llega el «250 OK»
 * final. Si ahí se corta la conexión, Gmail puede haberlo aceptado y ser la
 * respuesta lo que se perdió: reintentar entrega el mismo correo dos veces.
 * Nunca se ha visto pasar aquí —los fallos son todos de conexión—, pero un
 * cliente que recibe su código por duplicado es un error visible, y no hay
 * forma de preguntar después.
 *
 * SE DISTINGUE POR EL TEXTO del error, que es lo único que nodemailer deja
 * fuera: `command` vale 'CONN' tanto para el tope de conexión como para el de
 * inactividad a media conversación (smtp-connection/index.js: `_onTimeout()`
 * pasa 'CONN'), así que no sirve para separarlos. Los tres mensajes de la
 * lista sí son inequívocos.
 *
 * Si algún día nodemailer los reescribe, esto deja de reconocerlos y el correo
 * vuelve a reintentarse siempre: se pierde la protección contra el duplicado,
 * pero no se pierde ningún correo. Es el lado bueno por el que equivocarse.
 */
const NEVER_SENT = new Set([
    'Connection timeout',      // no se llegó a establecer el TCP
    'Greeting never received', // conectado, pero sin el 220 del servidor
    'Connection closed',       // el servidor cortó antes de empezar
]);

function isDeliveryUnknown(err) {
    if (err.command === 'DATA') return true;
    const transient = err.code === 'ETIMEDOUT' || err.code === 'ESOCKET' || err.code === 'ECONNECTION';
    if (!transient) return false;
    // El mensaje trae pegado el «(host ip:port, tras N s)» que le añade
    // withTransport(), así que se compara por el principio.
    return !Array.from(NEVER_SENT).some((known) => err.message.startsWith(known));
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
        attachments: LOGO,
    };
}

function shopMessage(created, data) {
    const vehicle = vehicleName(data, false);
    const zone = zoneLabel(data);
    const quality = qualityLabel(data.quality);

    const blocks = [
        `Nueva solicitud desde el asistente del sitio.`,
        block('CLIENTE', [
            row('Nombre', `${oneLine(data.firstName)} ${oneLine(data.lastName)}`),
            row('Teléfono', formatPhone(data.phone)),
            row('Email', data.email || '(no dejó)'),
            row('Zona', zone),
        ]),
        block('VEHÍCULO', [
            row('Marca y modelo', vehicle),
            row('Carrocería', bodyTypeLabel(data.bodyType)),
            row('Año', data.year),
            row('Placa', data.plate),
            row('Kilometraje', mileageLabel(data.mileage)),
            row('Código de color', data.colorCode),
            // La silueta del visor 3D no siempre coincide con la carrocería
            // real (el catálogo tiene cuatro siluetas y ocho carrocerías), así
            // que va aparte y no en lugar de la de arriba.
            row('Silueta 3D', vehicleLabel(data.vehicle)),
        ]),
        block('TRABAJO', [
            row('Acabado', quality),
            row('Piezas', `(${data.parts.length}) ${data.parts.map(partLabel).join(', ')}`),
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
        attachments: LOGO,
    };

    // Responder al correo del taller le escribe al cliente, que es lo que uno
    // quiere hacer al leerlo.
    if (data.email) message.replyTo = data.email;

    return message;
}

/* -----------------------------------------------------------------------------
   Lo que llama server.js
-------------------------------------------------------------------------- */

// La cola de salida: los correos que faltan por mandar, cada uno con el
// intento por el que va y el momento a partir del cual se puede reintentar.
//
// Vive en memoria, y eso es una decisión, no un descuido: guardarla en
// Postgres pediría una tabla y una migración a mano (ver render.yaml) para
// proteger un caso —que Render apague la instancia justo en la media hora en
// que el correo está caído— en el que además no se pierde nada importante: la
// solicitud está en la base y el panel del taller la enseña igual. Lo que sí
// se hace es DECIRLO al apagar (ver close()), para que un aviso que no salió
// no se vaya en silencio.
const OUTBOX = [];

// La cola se recorre de una en una (ver también oneAtATime, que serializa
// además con la comprobación del arranque).
let draining = false;
let retryTimer = null;

/**
 * Avisa de una solicitud nueva por correo. NO LANZA NI RECHAZA NUNCA, ni
 * siquiera si armar los mensajes falla: se la llama sin `await` y sin
 * `.catch()` desde el manejador de POST /api/requests, que ya contestó su 201.
 *
 * Devuelve en cuanto los mensajes están en la cola. Lo que tarden en salir es
 * asunto de drain().
 */
function notifyNewRequest(created, data) {
    if (!isConfigured()) return;

    // Uno y otro por separado: que armar el del taller falle no puede dejar al
    // cliente sin su código, ni al revés.
    enqueue(`aviso al taller de ${created.id}`, () => shopMessage(created, data));

    // El asistente ya lo exige, pero la guarda se queda: en la base hay
    // solicitudes anteriores a que el correo fuera obligatorio, y sin ella
    // reenviar una de esas mandaría un mensaje a `undefined`.
    if (data.email) {
        enqueue(`confirmación al cliente de ${created.id}`, () => customerMessage(created, data));
    }

    kick();
}

/**
 * Pone un correo en la cola. El mensaje se arma AQUÍ y no fuera, para que un
 * fallo al armarlo muera dentro de este try.
 *
 * Antes notifyNewRequest() era `async` y se la llamaba sin `.catch()`: un error
 * al armar un cuerpo se convertía en una promesa rechazada sin dueño, y Node se
 * lleva el proceso entero por eso —con el 201 ya mandado y todas las sesiones
 * del panel dentro—.
 */
function enqueue(what, build) {
    let message;
    try {
        message = build();
    } catch (err) {
        console.error(`[mail] no se pudo armar ${what}: ${err.message}`);
        return;
    }
    // `retryAt` en 0 y no en Date.now(): se puede mandar ya.
    OUTBOX.push({ what, message, attempt: 0, retryAt: 0 });
    while (OUTBOX.length > MAX_OUTBOX) {
        const dropped = OUTBOX.shift();
        console.error(`[mail] cola llena (${MAX_OUTBOX}), se descarta ${dropped.what}`);
    }
}

/** drain() sin dueño, que es como se la llama siempre. */
function kick() {
    drain().catch((err) => console.error(`[mail] fallo inesperado en la cola: ${err.message}`));
}

/**
 * Manda lo que ya toca mandar, de uno en uno, y deja programado el siguiente
 * reintento si algo se quedó por el camino.
 */
async function drain() {
    if (draining) return;
    draining = true;
    try {
        for (;;) {
            const now = Date.now();
            const index = OUTBOX.findIndex((item) => item.retryAt <= now);
            if (index === -1) break;
            const [item] = OUTBOX.splice(index, 1);

            try {
                await attemptSend(item.message);
                // Las direcciones no se registran: el registro del alojamiento
                // no es sitio para los datos de contacto de un cliente. El
                // código de la solicitud basta para seguir el rastro.
                const which = item.attempt > 0 ? ` (al intento ${item.attempt + 1})` : '';
                console.log(`[mail] salió ${item.what}${which}`);
            } catch (err) {
                // Se corta la conversación sin saber si el mensaje entró.
                // Reintentar podría entregarlo dos veces, así que se para y se
                // dice, que es lo único honesto: puede que haya llegado.
                if (isDeliveryUnknown(err)) {
                    console.error(`[mail] ${item.what}: se cortó sin respuesta y puede haber llegado; no se reintenta para no duplicarlo — ${err.message}`);
                    continue;
                }
                // `undefined` cuando se acabaron los intentos.
                const delay = isPermanent(err) ? undefined : RETRY_DELAYS_MS[item.attempt];
                if (delay === undefined) {
                    // No hay más que hacer: o se agotaron, o el servidor dijo
                    // que no y repetirlo no lo va a cambiar.
                    console.error(`[mail] no salió ${item.what}: ${err.message}`);
                    continue;
                }
                item.attempt += 1;
                item.retryAt = Date.now() + delay;
                OUTBOX.push(item);
                console.warn(`[mail] falló ${item.what}, se reintenta en ${Math.round(delay / 1000)} s: ${err.message}`);
            }
        }
    } finally {
        draining = false;
        scheduleNextAttempt();
    }
}

function scheduleNextAttempt() {
    if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
    }
    if (OUTBOX.length === 0) return;

    const next = OUTBOX.reduce((soonest, item) => Math.min(soonest, item.retryAt), Infinity);
    retryTimer = setTimeout(() => {
        retryTimer = null;
        kick();
    }, Math.max(next - Date.now(), 0));

    // Un correo pendiente no puede ser la razón de que el proceso no termine.
    // El servidor mantiene vivo el bucle de eventos mientras esté escuchando;
    // cuando deja de escuchar, lo que quede en la cola se anuncia en close()
    // en vez de retener el apagado media hora.
    retryTimer.unref();
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

    let detail = null;
    // DOS INTENTOS Y NO UNO. Este renglón del arranque es una alarma, y una
    // alarma que salta cada dos despliegues por un tiempo agotado pasajero
    // —que es justo lo que hace la red de Render— deja de mirarse, que es lo
    // único que esta comprobación no se puede permitir.
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            await withTransport((transport) => transport.verify());
            return { ok: true, address: lastAddress };
        } catch (err) {
            detail = err.message;
            // Una contraseña mal puesta no mejora repitiéndola.
            if (isPermanent(err)) break;
        }
    }
    return { ok: false, error: detail };
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
        address: lastAddress,
        from: FROM,
        shop: SHOP,
        // Cuántos avisos están esperando su turno o su reintento. Un número
        // que no baja entre dos consultas es la señal de que el correo está
        // caído, sin tener que ir a buscarla al registro del despliegue.
        pending: OUTBOX.length,
    };
}

/**
 * Abandona la cola. SOLO la llama el apagado ordenado de server.js, y después
 * de server.close(): la cola no es de nadie más.
 *
 * No cierra conexiones —cada envío tiene y suelta la suya (ver attemptSend)—;
 * lo que hace es cancelar el reloj de los reintentos y DEJAR DICHO qué se
 * queda sin mandar. Es la contrapartida de tener la cola en memoria: si Render
 * apaga la instancia con avisos pendientes, se pierden, y el registro del
 * despliegue tiene que decir cuáles para que nadie se entere por una llamada.
 */
function close() {
    if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
    }
    if (OUTBOX.length === 0) return;
    console.warn(`[mail] el proceso termina con ${OUTBOX.length} correo(s) sin mandar:`);
    for (const item of OUTBOX) console.warn(`[mail]   - ${item.what} (iba por el intento ${item.attempt + 1})`);
    OUTBOX.length = 0;
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
