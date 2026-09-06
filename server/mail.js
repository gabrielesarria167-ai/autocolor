'use strict';

/* =============================================================================
   mail.js — los dos correos que salen con cada solicitud nueva

   Cuando alguien termina el asistente (pgs/repair.html) salen dos avisos:

     - al cliente: unas líneas y el código de seguimiento, que es lo único que
       necesita para consultar su estado más tarde.
     - al taller: los datos de contacto y el trabajo pedido, para preparar el
       presupuesto sin tener que abrir el panel.

   Salen por la API de Brevo, con una petición HTTPS al 443.

   ANTES SALÍAN POR EL SMTP DE GMAIL Y NO FUNCIONABA. Cuatro rondas de
   pruebas desde Render: los avisos morían en «Connection timeout» contra
   smtp.gmail.com, primero por el 465 —que Render bloquea— y después por el
   587, que deja salir pero no hasta Gmail. Se midió: una conexión sana se
   establece en 22 milésimas de segundo, y las de Render se agotaban a los
   quince mil sin respuesta. Se subieron los topes a un minuto: nada. Se le
   puso delante una cola con seis reintentos repartidos en cuarenta y ocho
   minutos: tampoco. Con eso quedó claro que el camino no es lento, está
   cerrado, y que ninguna cantidad de reintentos lo abre.

   El 443 no lo bloquea nadie, porque es por donde va la web entera. Y Brevo
   verifica UNA DIRECCIÓN suelta en vez de un dominio, que es lo que lo hace
   posible aquí: el taller no tiene dominio propio —el sitio vive en el
   subdominio de Render, cuyo DNS es de Render—, así que los proveedores que
   piden dominio verificado quedaban descartados.

   Ya no hace falta nodemailer, así que `pg` vuelve a ser la única dependencia.
   Lo que costaba escribir a mano de SMTP era codificar los mensajes —tildes y
   «ñ» significan MIME, quoted-printable y cabeceras codificadas—, y por HTTPS
   eso desaparece: el cuerpo va en un JSON en UTF-8 y de las cabeceras se
   encarga Brevo.

   NINGUNO DE LOS DOS PUEDE TUMBAR UNA SOLICITUD. Para cuando se envían, la
   fila ya está en la base y el cliente ya tiene su código en pantalla. Que un
   correo no salga es una molestia; perder la solicitud por eso sería mucho
   peor. Por eso server.js los dispara DESPUÉS de responder el 201 y
   notifyNewRequest() no lanza ni rechaza nunca: los fallos se registran y ya.

   NO SALEN EN EL ACTO: van a una cola (OUTBOX) que los manda de uno en uno y
   reintenta los que fallan. La cola se escribió para el problema de Gmail y se
   queda ahora que no lo hay: una API caída un rato es algo que pasa, y volver
   a intentarlo veinte minutos después no le cuesta nada a nadie.

   Sin AUTOCOLOR_BREVO_KEY no se manda nada y el sitio funciona igual. Es lo
   que pasa en la máquina de trabajo, donde no hace falta una cuenta para
   probar el asistente.
   ========================================================================== */

const mailhtml = require('./mailhtml');

// La llave de la API de Brevo (Brevo → SMTP & API → API keys). Es lo único
// secreto que hace falta: no hay usuario ni contraseña que guardar.
const BREVO_KEY = process.env.AUTOCOLOR_BREVO_KEY || '';

// Los dos extremos de la API. Configurables para poder apuntarlos a un
// servidor de mentira en las pruebas sin tocar código; en producción no se
// ponen.
const SEND_URL = process.env.AUTOCOLOR_BREVO_URL || 'https://api.brevo.com/v3/smtp/email';
// Sirve para comprobar la llave sin mandar ningún correo: ver verify().
const ACCOUNT_URL = process.env.AUTOCOLOR_BREVO_ACCOUNT_URL || 'https://api.brevo.com/v3/account';

// Lo que se espera por una petición entera, desde que sale hasta la respuesta.
//
// Quince segundos son muchísimos para un JSON de unos kilobytes: si Brevo
// tarda más, es que algo va mal y lo que toca es reintentar, no seguir
// esperando. Y como el envío va detrás de la respuesta al cliente, rendirse
// pronto no le cuesta nada a nadie.
const REQUEST_TIMEOUT_MS = 15000;

// Cuánto se espera antes de cada reintento, contando desde el intento
// anterior: seis intentos en total repartidos en unos 48 minutos.
//
// La escalera se escribió para el problema de Gmail —conexiones que en un rato
// salían y en otro no— y con Brevo debería sobrar: por el 443 el primer
// intento va a bastar casi siempre. Se queda porque el caso que cubre no
// desaparece con el proveedor: una API puede estar caída un rato, y volver a
// intentarlo a los veinte minutos no le cuesta nada a nadie.
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

// A dónde va la copia del taller. Por ahora el Gmail personal que hace de
// buzón; cuando el taller tenga el suyo, esto es una variable de entorno y no
// un cambio de código.
const SHOP = process.env.AUTOCOLOR_MAIL_SHOP || 'gabrielesarria167@gmail.com';

// Quién firma los dos correos.
//
// LA DIRECCIÓN TIENE QUE ESTAR VERIFICADA EN BREVO (Brevo → Senders), o la API
// contesta 400 y no manda nada. Verificar es recibir un correo de confirmación
// y pinchar el enlace, así que se verifica una dirección que se pueda abrir:
// por omisión la misma del taller, que es la que ya hace de buzón.
//
// El nombre visible sí es libre: es lo que se lee en la bandeja de entrada.
const SENDER = {
    name: process.env.AUTOCOLOR_MAIL_FROM_NAME || 'Autocolor',
    email: process.env.AUTOCOLOR_MAIL_FROM || SHOP,
};

// Para los enlaces de los correos. RENDER_EXTERNAL_URL la pone el alojamiento
// sola; en la máquina de trabajo no hay ninguna y los enlaces se omiten, que
// es mejor que mandar un http://localhost:3000 que no le sirve a nadie.
const SITE_URL = (process.env.AUTOCOLOR_SITE_URL || process.env.RENDER_EXTERNAL_URL || '')
    .replace(/\/+$/, '');

// El logotipo, servido desde el propio sitio.
//
// IBA PEGADO AL MENSAJE Y AHORA NO PUEDE. Un logotipo dentro del correo se
// referencia por su identificador (cid:), y eso es una cabecera MIME que la
// API de Brevo no expone: su lista de adjuntos acepta un archivo con nombre,
// no un adjunto en línea. Un data: URI tampoco vale —Gmail lo borra—, así que
// queda la URL, que es lo que hacen casi todos los correos que uno recibe.
//
// El sitio es público y sirve /imgs/ (ver serveStatic en server/server.js), y
// esta es la versión de 480 px y 18 KB hecha para esto: la del sitio pesa
// 218 KB y se pagaría en cada apertura.
//
// Si el cliente de correo no baja imágenes remotas, se ve el texto alternativo
// y ya; y sin sitio conocido —la máquina de trabajo— no hay URL que poner, así
// que mailhtml.js escribe el nombre del taller en su lugar.
const LOGO_URL = SITE_URL ? `${SITE_URL}/imgs/logoEmail.jpg` : '';

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
             siteUrl: SITE_URL, logoUrl: LOGO_URL,
             partsLabel: (parts) => parts.map(partLabel).join(', ') };
}

function isConfigured() {
    return BREVO_KEY.length > 0;
}

/**
 * Un valor del formulario en una sola línea.
 *
 * validateRequest() recorta los extremos pero no toca lo de dentro, así que un
 * nombre pegado desde otro sitio puede traer saltos de línea. En un cuerpo de
 * texto plano eso solo descuadra la lista de datos —no hay cabeceras que
 * inyectar: el mensaje va en un JSON y las cabeceras las arma Brevo—, pero un
 * correo cuadrado se lee mejor.
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

/**
 * Un intento de envío: una petición a la API de Brevo.
 *
 * Rechaza si falta la llave, si no se llega a la API o si la API contesta que
 * no. Quien llama decide si reintentar —lo hace drain()— o rendirse.
 */
async function attemptSend(message) {
    if (!isConfigured()) throw new Error('Falta AUTOCOLOR_BREVO_KEY');
    await request(SEND_URL, { method: 'POST', body: brevoBody(message) });
}

/**
 * El mensaje, en la forma que pide la API.
 *
 * Los cuerpos se arman igual que antes y se traducen aquí: así el resto del
 * archivo —y mailhtml.js entero— no sabe por dónde salen los correos, que es
 * lo que hizo que cambiar de transporte fuera solo este trozo.
 */
function brevoBody(message) {
    const body = {
        sender: SENDER,
        to: message.to.map((email) => ({ email })),
        subject: message.subject,
        // Los dos cuerpos viajan juntos y Brevo arma el multipart/alternative.
        // El de texto no es un resto: es lo que se ve en los clientes que no
        // pintan HTML y en los avisos del reloj o del móvil.
        htmlContent: message.html,
        textContent: message.text,
    };
    if (message.replyTo) body.replyTo = { email: message.replyTo };
    return body;
}

/**
 * Una petición a la API, con su tope de tiempo y sus errores ya interpretados.
 *
 * El error sale diciendo qué contestó y cuánto tardó, que es lo que hace que
 * un fallo se lea sin adivinar: un 401 en 200 ms dice que la llave está mal, y
 * un tiempo agotado a los 15 s dice que no se llega a la API.
 */
async function request(url, { method = 'GET', body } = {}) {
    const started = Date.now();
    let response;
    try {
        response = await fetch(url, {
            method,
            headers: {
                'api-key': BREVO_KEY,
                'content-type': 'application/json',
                accept: 'application/json',
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (err) {
        // Ni siquiera hubo respuesta. Se conserva el error original en `cause`
        // porque es donde viene el código que dice si se llegó a conectar, y
        // de eso depende si se puede reintentar sin duplicar (ver
        // isDeliveryUnknown).
        throw decorate(new Error(reasonFor(err)), { cause: err, started });
    }

    if (response.ok) return readJson(response);

    // La API contesta el motivo en el cuerpo, y es el dato que convierte «400»
    // en «el remitente no está verificado». Si no viniera, queda el número.
    const detail = await readJson(response).then(
        (data) => (data && (data.message || data.code)) || '',
        () => '',
    );
    throw decorate(new Error(`${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`),
                   { status: response.status, started });
}

function decorate(err, { cause, status, started }) {
    if (cause !== undefined) err.cause = cause;
    if (status !== undefined) err.status = status;
    err.message = `${err.message} (Brevo, tras ${((Date.now() - started) / 1000).toFixed(1)} s)`;
    return err;
}

/** El cuerpo de la respuesta, o null si no era JSON. Nunca lanza. */
async function readJson(response) {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

/** Un motivo legible para un fallo que no llegó a tener respuesta. */
function reasonFor(err) {
    if (err.name === 'TimeoutError') return 'la API no contestó a tiempo';
    if (err.name === 'AbortError') return 'la petición se canceló';
    const code = err.cause?.code || err.code;
    return code ? `no se pudo conectar (${code})` : `no se pudo conectar (${err.message})`;
}

/**
 * ¿Tiene sentido volver a intentarlo?
 *
 * Un 4xx es la API contestando que no, y siempre por algo que repetir no
 * cambia: la llave está mal (401), el remitente no está verificado o el cuerpo
 * está mal armado (400). La excepción es el 429, que es «ahora no» y no «no»:
 * ese es exactamente para lo que existe la escalera de reintentos.
 *
 * Todo lo demás —5xx, tiempos agotados, fallos de red— es pasajero por
 * definición.
 */
function isPermanent(err) {
    return Number.isInteger(err.status) && err.status >= 400 && err.status < 500 && err.status !== 429;
}

// Los códigos que solo aparecen cuando la conexión NO llegó a establecerse. Si
// no hubo conexión, no salió ni un byte del mensaje.
const NEVER_CONNECTED = new Set([
    'ENOTFOUND',               // el nombre no resuelve
    'EAI_AGAIN',               // el DNS no contesta
    'ECONNREFUSED',            // hay ruta, no hay nadie escuchando
    'ENETUNREACH',             // no hay ruta
    'EHOSTUNREACH',            // no se alcanza la máquina
    'UND_ERR_CONNECT_TIMEOUT', // se agotó estableciendo la conexión
    'CERT_HAS_EXPIRED',        // TLS: se rechazó antes de mandar nada
]);

/**
 * ¿Nos quedamos sin saber si el correo se entregó?
 *
 * Con respuesta no hay duda: un 2xx es que Brevo lo aceptó y cualquier otro
 * código es que no. Sin respuesta, depende de dónde se cortó:
 *
 *   - Si no se llegó a conectar, el mensaje no salió. Reintentar es gratis.
 *   - Si se cortó ESPERANDO la respuesta, la petición ya iba de camino y Brevo
 *     puede haberla aceptado: reintentar entregaría el mismo correo dos veces.
 *     Ahí se para, aunque signifique quedarse sin saberlo.
 *
 * Un error que no encaje en ninguno de los dos se reintenta, que es el lado
 * por el que conviene equivocarse: un duplicado se ve y se explica, un correo
 * que no llegó no se ve.
 */
function isDeliveryUnknown(err) {
    if (Number.isInteger(err.status)) return false;
    const code = err.cause?.cause?.code || err.cause?.code;
    if (NEVER_CONNECTED.has(code)) return false;
    const name = err.cause?.name;
    return name === 'TimeoutError' || name === 'AbortError';
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
        to: [data.email],
        // Solo el código, que lo genera el servidor. Nada que haya escrito
        // quien rellenó el formulario entra en el asunto.
        subject: `Tu solicitud en Autocolor — código ${created.id}`,
        text: lines.join('\n'),
        html: mailhtml.customerHtml(created, data, htmlContext()),
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
        to: [SHOP],
        // La placa ya pasó por PLATE_RE y el código lo genera el servidor: los
        // dos son seguros de poner en el asunto.
        subject: `Solicitud ${created.id} — ${data.plate}`,
        text: blocks.filter(Boolean).join('\n\n'),
        html: mailhtml.shopHtml(created, data, htmlContext()),
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
    if (!isConfigured()) return { ok: false, error: 'falta AUTOCOLOR_BREVO_KEY' };

    let detail = null;
    // DOS INTENTOS Y NO UNO. Este renglón del arranque es una alarma, y una
    // alarma que salta de vez en cuando por un tropiezo pasajero deja de
    // mirarse, que es lo único que esta comprobación no se puede permitir.
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            // Se pregunta por la cuenta y no se manda un correo de prueba:
            // comprueba la llave y el camino hasta la API, no gasta uno de los
            // 300 envíos diarios del plan gratuito y no le llega nada a nadie.
            const account = await request(ACCOUNT_URL);
            return { ok: true, account: account && account.email };
        } catch (err) {
            detail = err.message;
            // Una llave mal puesta no mejora repitiéndola.
            if (isPermanent(err)) break;
        }
    }
    return { ok: false, error: detail };
}

/** La configuración del correo, sin la llave. Para /api/staff/whoami. */
function describe() {
    return {
        configured: isConfigured(),
        endpoint: SEND_URL,
        from: SENDER,
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
 * No cierra nada —cada envío es una petición que se acaba sola—; lo que hace
 * es cancelar el reloj de los reintentos y DEJAR DICHO qué se queda sin
 * mandar. Es la contrapartida de tener la cola en memoria: si Render
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
