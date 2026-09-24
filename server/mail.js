'use strict';

/* =============================================================================
   mail.js: the two emails that go out with each new request

   When someone finishes the wizard (pgs/repair.html) two notices go out:

     - to the customer: a few lines and the tracking code, which is all they
       need to check their status later.
     - to the workshop: the contact details and the job asked for, to prepare
       the quote without opening the panel.

   They go out through the Brevo API, with an HTTPS request to 443.

   THEY USED TO GO OUT THROUGH GMAIL'S SMTP AND IT DID NOT WORK. Four rounds of
   tests from Render: the notices died on «Connection timeout» against
   smtp.gmail.com, first on 465 (which Render blocks) and then on 587, which
   lets traffic out but not as far as Gmail. It was measured: a healthy
   connection is established in 22 milliseconds, and Render's timed out at
   fifteen thousand with no answer. The caps went up to a minute: nothing. A
   queue with six retries spread over forty-eight minutes went in front:
   nothing either. That made it clear the path is not slow, it is closed, and
   no number of retries opens it.

   Nobody blocks 443, because the whole web goes through it. And Brevo
   verifies A SINGLE ADDRESS instead of a domain, which is what makes it
   possible here: the workshop has no domain of its own (the site lives on a
   Render subdomain, whose DNS is Render's), so providers that require a
   verified domain were out.

   nodemailer is no longer needed, so `pg` is the only dependency again. What
   was hard to write by hand for SMTP was encoding the messages (accents and
   «ñ» mean MIME, quoted-printable and encoded headers), and over HTTPS that
   goes away: the body travels as UTF-8 JSON and Brevo handles the headers.

   NEITHER OF THE TWO CAN BRING A REQUEST DOWN. By the time they are sent, the
   row is already in the database and the customer already has their code on
   screen. An email not going out is a nuisance; losing the request over it
   would be far worse. That is why server.js fires them AFTER answering the
   201 and notifyNewRequest() never throws or rejects: failures get logged
   and that is it.

   THEY DO NOT GO OUT IMMEDIATELY: they go into a queue (OUTBOX) that sends
   them one at a time and retries the ones that fail. The queue was written
   for the Gmail problem and stays now that there is none: an API down for a
   while is something that happens, and trying again twenty minutes later
   costs nobody anything.

   Without AUTOCOLOR_BREVO_KEY nothing is sent and the site works the same.
   That is what happens on the work machine, where no account is needed to
   test the wizard.
   ========================================================================== */

const mailhtml = require('./mailhtml');
// The same file the two pages load with a <script>, required here instead.
// The panel names have to read the same in the email as they did on the
// screen the customer picked them from, and one file is what guarantees it.
const parts = require('../src/parts.js');
// Same for matizado: the containers, finishes and prices are named by
// src/paints.js, and the order email has to say them the way the page where
// they were chosen does.
const paints = require('../src/paints.js');

// The Brevo API key (Brevo > SMTP & API > API keys). It is the only secret
// needed: there is no user or password to store.
const BREVO_KEY = process.env.AUTOCOLOR_BREVO_KEY || '';

// The API's two endpoints. Configurable so tests can point them at a fake
// server without touching code; in production they are not set.
const SEND_URL = process.env.AUTOCOLOR_BREVO_URL || 'https://api.brevo.com/v3/smtp/email';
// Used to check the key without sending any email: see verify().
const ACCOUNT_URL = process.env.AUTOCOLOR_BREVO_ACCOUNT_URL || 'https://api.brevo.com/v3/account';

// How long a whole request is waited for, from sending to the response.
//
// Fifteen seconds is a lot for a JSON of a few kilobytes: if Brevo takes
// longer, something is wrong and the right move is to retry, not to keep
// waiting. And since sending happens after answering the customer, giving up
// early costs nobody anything.
const REQUEST_TIMEOUT_MS = 15000;

// How long to wait before each retry, counted from the previous attempt: six
// attempts in total spread over about 48 minutes.
//
// The ladder was written for the Gmail problem (connections that went through
// one moment and not the next) and with Brevo it should be overkill: over 443
// the first attempt will almost always do. It stays because the case it
// covers does not go away with the provider: an API can be down for a while,
// and trying again twenty minutes later costs nobody anything.
//
// Being late does not matter: when these emails go out, the request is
// already stored and the customer already has their code on screen. A notice
// that arrives half an hour late is infinitely better than one that never does.
const RETRY_DELAYS_MS = [30000, 120000, 300000, 900000, 1800000];

// Queue cap. With mail down and someone insisting on the form, this is what
// is kept before the oldest starts getting dropped. It is not a measured
// figure: it is a ceiling so a mail failure cannot eat the process's memory,
// which is the one thing that cannot happen here.
const MAX_OUTBOX = 100;

// Where the workshop's copy goes. For now the personal Gmail acting as the
// inbox; when the workshop has its own, this is an environment variable and
// not a code change.
const SHOP = process.env.AUTOCOLOR_MAIL_SHOP || 'gabrielesarria167@gmail.com';

// Who signs both emails.
//
// THE ADDRESS HAS TO BE VERIFIED IN BREVO (Brevo > Senders), or the API
// answers 400 and sends nothing. Verifying means receiving a confirmation
// email and clicking the link, so verify an address that can be opened: by
// default the workshop's own, which already acts as the inbox.
//
// The display name is free: it is what is read in the inbox.
const SENDER = {
    name: process.env.AUTOCOLOR_MAIL_FROM_NAME || 'Autocolor',
    email: process.env.AUTOCOLOR_MAIL_FROM || SHOP,
};

// For the links in the emails. The host sets RENDER_EXTERNAL_URL itself; on
// the work machine there is none and the links are left out, which beats
// sending an http://localhost:3000 that helps nobody.
const SITE_URL = (process.env.AUTOCOLOR_SITE_URL || process.env.RENDER_EXTERNAL_URL || '')
    .replace(/\/+$/, '');

// The logo, served from the site itself. There are TWO: the stacked lockup in
// the logo's ink for light clients, and the same in white for dark ones.
// mailhtml.js shows whichever fits the reader's system. Both are rendered by
// tools/tracelogo.py.
//
// IT USED TO BE ATTACHED TO THE MESSAGE AND NOW IT CANNOT BE. A logo inside
// the email is referenced by its identifier (cid:), and that is a MIME header
// the Brevo API does not expose: its attachment list takes a named file, not
// an inline attachment. A data: URI will not do either (Gmail strips it), so
// what remains is the URL, which is what nearly every email one gets does.
//
// THEY ARE PNGs WITH TRANSPARENCY, NOT JPEGs as before. The JPEG carried its
// white background, and clients that invert colours on their own (Gmail on a
// phone, for one) leave images alone: the card went dark and the logo stayed
// as a white brick in the middle. With no background it sits well on
// anything. They also weigh less: 5 and 6 KB against the JPEG's 18, because
// the drawing is three inks and fits a palette.
//
// The site is public and serves /imgs/ (see serveStatic in server/server.js).
//
// If the mail client does not download remote images, the alt text shows and
// that is it; and with no known site (the work machine) there is no URL to
// put, so mailhtml.js writes the workshop's name instead.
const LOGO_URL = SITE_URL ? `${SITE_URL}/imgs/brand/logo-email.png` : '';
const LOGO_DARK_URL = SITE_URL ? `${SITE_URL}/imgs/brand/logo-email-white.png` : '';

// A copy of src/staff.js. There are two and they cannot read each other (one
// runs in the browser and the other here), so both have to say the same, the
// same way as the statuses (see the note in src/statuses.js).
const QUALITY_LABELS = {
    standard: 'Económico',
    premium: 'Profesional',
    custom: 'Alta gama',
};

// A copy of src/carModels.js (BODY_TYPES) and src/lookup.js (VEHICLE_LABELS).
// Without them the workshop email said «sedan» and «wagon» (the catalogue's
// identifiers) where the rest of the site says «Sedán» and «Familiar».
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

// Object.hasOwn and not `MAP[id] || id`: without it, `id` being 'constructor'
// or 'toString' pulls out what the object inherits from Object.prototype, and
// the workshop email asked for a quote on «function Object() { [native code] }».
// The parts come from the form, so whoever fills it in picks the `id`; the
// maps down here are closed, but they are read the same way so the trap is
// not left set for the next map that does come from outside. The same guard
// is in label() in src/parts.js, which is what names the parts.
function label(map, id) {
    return Object.hasOwn(map, id) ? map[id] : id;
}

// From src/parts.js, which is where the panel names live for all three places
// that name them. Its label() guards against the same thing label() above
// does, and for the same reason.
function partLabel(id) {
    return parts.label(id);
}

function bodyTypeLabel(id) {
    return label(BODY_TYPE_LABELS, id);
}

function vehicleLabel(id) {
    return label(VEHICLE_LABELS, id);
}

/**
 * '+51935646304' -> '+51 935 646 304'. Nine digits in a row cannot be read
 * or dictated; the site shows it this way everywhere.
 */
function formatPhone(value) {
    const match = /^\+51(\d{3})(\d{3})(\d{3})$/.exec(oneLine(value));
    return match ? `+51 ${match[1]} ${match[2]} ${match[3]}` : oneLine(value);
}

function qualityLabel(id) {
    return label(QUALITY_LABELS, id);
}

/**
 * 85000 -> «85,000 km», and nothing if they left it out.
 *
 * It exists as a function because both bodies (the text one and the HTML)
 * need it, and while they were two copied expressions they drifted apart: one
 * checked only `null` and the other `null` and `undefined`, so a missing
 * mileage built the HTML fine and blew up the text. The same goes for
 * zoneLabel() and vehicleName().
 */
function mileageLabel(value) {
    return value === null || value === undefined ? '' : `${value.toLocaleString('es-PE')} km`;
}

/** «Ayacucho / Huamanga». */
function zoneLabel(data) {
    return [oneLine(data.department), oneLine(data.province)].filter(Boolean).join(' / ');
}

/**
 * Make and model («Toyota Corolla»), with the year if asked for.
 *
 * `orSilhouette` is for the customer's email. A vehicle registered at the
 * counter may carry neither make nor model (the boss picks the silhouette and
 * skips the catalogue), and with no fallback the «Vehículo» line came out
 * empty and detailRows dropped it, so the email named no vehicle at all. The
 * workshop's does not ask for it: it already has its own «Silueta 3D» row
 * right below, and with the fallback it said «SUV» twice in a row.
 */
function vehicleName(data, withYear, orSilhouette) {
    const parts = [oneLine(data.brand), oneLine(data.model)];
    if (withYear) parts.push(data.year);
    const named = parts.filter(Boolean).join(' ');
    return named || (orSilhouette ? vehicleLabel(data.vehicle) : '');
}

// What mailhtml.js needs from here to build the two layouts. Passed in rather
// than importing half a module there: that way the labels and the site
// address keep living in one place.
function htmlContext() {
    return { oneLine, partLabel, qualityLabel, bodyTypeLabel, vehicleLabel,
             formatPhone, mileageLabel, zoneLabel, vehicleName,
             siteUrl: SITE_URL, logoUrl: LOGO_URL, logoDarkUrl: LOGO_DARK_URL,
             customerSteps,
             partsLabel: (parts) => parts.map(partLabel).join(', ') };
}

// When the request came in, as the shop's clock reads it: «15 de setiembre a
// las 21:30». The server runs in UTC on Render, so the zone is set here and
// not left to the machine.
const RECEIVED_AT = new Intl.DateTimeFormat('es-PE', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    hour12: false, timeZone: 'America/Lima',
});

/**
 * What happens after the customer's email arrives, one step per line. The
 * HTML draws them as a track (mailhtml.js timeline) and the text lists them,
 * so the copy lives here once. `state` is what the track paints: `done`, the
 * step in progress (`now`) or one still ahead (`next`).
 *
 * The promises are the site's own, word for word where it can be: 24 hours
 * and a closed price from the home page's four steps, WhatsApp updates from
 * its «Seguimiento» fact, 5 years of written guarantee from its description.
 * A walk-in skips the quote and the drop-off, which already happened.
 */
function customerSteps(created, walkIn) {
    const when = created.createdAt ? RECEIVED_AT.format(new Date(created.createdAt)) : '';
    const pickUp = { state: 'next', title: 'Lo recoges pintado', detail: 'Con 5 años de garantía por escrito.' };
    if (walkIn) {
        return [
            { state: 'done', title: 'Recibimos tu vehículo', detail: when },
            { state: 'now', title: 'Lo trabajamos en el taller', detail: 'Te avisamos por WhatsApp en cada etapa, con fotos del avance.' },
            pickUp,
        ];
    }
    return [
        { state: 'done', title: 'Recibimos tu solicitud', detail: when },
        { state: 'now', title: 'Te llamamos con el presupuesto', detail: 'En las próximas 24 horas: precio cerrado y fecha de entrega.' },
        { state: 'next', title: 'Traes el vehículo', detail: 'Solo si apruebas el presupuesto.' },
        pickUp,
    ];
}

function isConfigured() {
    return BREVO_KEY.length > 0;
}

/**
 * A form value on a single line.
 *
 * validateRequest() trims the ends but leaves the inside alone, so a name
 * pasted from elsewhere can carry line breaks. In a plain-text body that only
 * misaligns the details list (there are no headers to inject: the message
 * travels as JSON and Brevo builds the headers), but an aligned email reads
 * better.
 */
function oneLine(value) {
    if (value === undefined || value === null || value === '') return '';
    return String(value).replace(/\s+/g, ' ').trim();
}

// The width of the label column in the text body. It fits the longest
// («Código de color») with a space to spare.
const LABEL_WIDTH = 16;

/** «  Teléfono          +51935646304», or nothing if the value did not come. */
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
 * One send attempt: one request to the Brevo API.
 *
 * Rejects if the key is missing, if the API cannot be reached or if the API
 * says no. The caller decides whether to retry (drain() does) or give up.
 */
async function attemptSend(message) {
    if (!isConfigured()) throw new Error('Falta AUTOCOLOR_BREVO_KEY');
    await request(SEND_URL, { method: 'POST', body: brevoBody(message) });
}

/**
 * The message, in the shape the API asks for.
 *
 * The bodies are built as before and translated here: that way the rest of
 * the file (and all of mailhtml.js) does not know how the emails go out,
 * which is what made switching transport a matter of this one piece.
 */
function brevoBody(message) {
    const body = {
        sender: SENDER,
        to: message.to.map((email) => ({ email })),
        subject: message.subject,
        // Both bodies travel together and Brevo builds the multipart/alternative.
        // The text one is not a leftover: it is what shows in clients that do
        // not render HTML and in watch or phone notifications.
        htmlContent: message.html,
        textContent: message.text,
    };
    if (message.replyTo) body.replyTo = { email: message.replyTo };
    return body;
}

/**
 * A request to the API, with its time cap and its errors already interpreted.
 *
 * The error comes out saying what the API answered and how long it took,
 * which is what makes a failure readable without guessing: a 401 in 200 ms
 * says the key is wrong, and a timeout at 15 s says the API cannot be reached.
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
        // There was not even a response. The original error is kept in `cause`
        // because that is where the code saying whether a connection was made
        // lives, and whether a retry can happen without duplicating depends on
        // it (see isDeliveryUnknown).
        throw decorate(new Error(reasonFor(err)), { cause: err, started });
    }

    if (response.ok) return readJson(response);

    // The API gives the reason in the body, and that is what turns «400» into
    // «the sender is not verified». If it is missing, the number remains.
    const detail = await readJson(response).then(
        (data) => (data && (data.message || data.code)) || '',
        () => '',
    );
    throw decorate(new Error(`${response.status} ${response.statusText}${detail ? `: ${detail}` : ''}`),
                   { status: response.status, started });
}

function decorate(err, { cause, status, started }) {
    if (cause !== undefined) err.cause = cause;
    if (status !== undefined) err.status = status;
    err.message = `${err.message} (Brevo, tras ${((Date.now() - started) / 1000).toFixed(1)} s)`;
    return err;
}

/** The response body, or null if it was not JSON. Never throws. */
async function readJson(response) {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

/** A readable reason for a failure that never got a response. */
function reasonFor(err) {
    if (err.name === 'TimeoutError') return 'la API no contestó a tiempo';
    if (err.name === 'AbortError') return 'la petición se canceló';
    const code = err.cause?.code || err.code;
    return code ? `no se pudo conectar (${code})` : `no se pudo conectar (${err.message})`;
}

/**
 * Is it worth trying again?
 *
 * A 4xx is the API saying no, and always for something repeating will not
 * change: the key is wrong (401), the sender is not verified or the body is
 * malformed (400). The exception is 429, which means «not now» rather than
 * «no»: that is exactly what the retry ladder exists for.
 *
 * Everything else (5xx, timeouts, network failures) is transient by
 * definition.
 */
function isPermanent(err) {
    return Number.isInteger(err.status) && err.status >= 400 && err.status < 500 && err.status !== 429;
}

// The codes that only appear when the connection was NOT established. With
// no connection, not a single byte of the message went out.
const NEVER_CONNECTED = new Set([
    'ENOTFOUND',               // the name does not resolve
    'EAI_AGAIN',               // DNS does not answer
    'ECONNREFUSED',            // there is a route, nobody is listening
    'ENETUNREACH',             // there is no route
    'EHOSTUNREACH',            // the machine cannot be reached
    'UND_ERR_CONNECT_TIMEOUT', // timed out establishing the connection
    'CERT_HAS_EXPIRED',        // TLS: refused before sending anything
]);

/**
 * Are we left not knowing whether the email was delivered?
 *
 * With a response there is no doubt: a 2xx means Brevo accepted it and any
 * other code means it did not. Without a response, it depends on where it
 * was cut:
 *
 *   - If the connection was never made, the message did not go out. Retrying is free.
 *   - If it was cut WAITING for the response, the request was already on its
 *     way and Brevo may have accepted it: retrying would deliver the same
 *     email twice. There it stops, even if that means never knowing.
 *
 * An error that fits neither is retried, which is the side to err on: a
 * duplicate shows and can be explained, an email that never arrived does not show.
 */
function isDeliveryUnknown(err) {
    if (Number.isInteger(err.status)) return false;
    const code = err.cause?.cause?.code || err.cause?.code;
    if (NEVER_CONNECTED.has(code)) return false;
    const name = err.cause?.name;
    return name === 'TimeoutError' || name === 'AbortError';
}

/* -----------------------------------------------------------------------------
   The two messages
-------------------------------------------------------------------------- */

function customerMessage(created, data, walkIn) {
    const name = oneLine(data.firstName);
    const greeting = name ? `Hola ${name},` : 'Hola,';
    const lines = [
        greeting,
        '',
        // Somebody who drove to the shop was not promised a quote in 24 hours
        // and did not send a request from a website: telling them otherwise
        // reads as a form letter that did not notice they were there.
        ...(walkIn
            ? ['Recibimos tu vehículo en el taller y ya está registrado. Esto es lo que',
               'sigue; cualquier cosa que necesitemos consultarte, te llamamos.']
            : ['Recibimos tu solicitud de pintura. Esto es lo que sigue; no tienes que',
               'hacer nada hasta que te llamemos.']),
        '',
        // The same steps the HTML draws as a track, as a numbered list.
        ...customerSteps(created, walkIn).map((step, i) =>
            `  ${i + 1}. ${step.title}${step.detail ? `: ${step.detail}` : ''}`),
        '',
        'Tu código de seguimiento es:',
        '',
        `    ${created.id}`,
        '',
    ];

    // The same text as the wizard's success screen, so the email does not say
    // something different from what they just read on the site.
    lines.push(SITE_URL
        ? `Guárdalo: con este código puedes ver el estado de tu ${walkIn ? 'vehículo' : 'solicitud'} en\n${SITE_URL}/pgs/repair.html#consulta`
        : `Guárdalo: con este código puedes ver el estado de tu ${walkIn ? 'vehículo' : 'solicitud'} en nuestro sitio.`);

    lines.push('', 'Autocolor');

    return {
        to: [data.email],
        // Only the code, which the server generates. Nothing typed by whoever
        // filled in the form goes into the subject.
        subject: walkIn
            ? `Tu vehículo en Autocolor: código ${created.id}`
            : `Tu solicitud en Autocolor: código ${created.id}`,
        text: lines.join('\n'),
        html: mailhtml.customerHtml(created, data, htmlContext(), walkIn),
    };
}

function shopMessage(created, data, walkIn) {
    const vehicle = vehicleName(data, false);
    const zone = zoneLabel(data);
    const quality = qualityLabel(data.quality);

    const blocks = [
        walkIn
            ? 'Vehículo registrado en el local, desde el panel del taller.'
            : 'Nueva solicitud desde el asistente del sitio.',
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
            // The 3D viewer's silhouette does not always match the real body
            // (the catalogue has four silhouettes and eight bodies), so it
            // goes separately and not in place of the one above.
            row('Silueta 3D', vehicleLabel(data.vehicle)),
        ]),
        block('TRABAJO', [
            row('Acabado', quality),
            // No parts only happens on rows from before both forms required
            // them. «(0)» on its own would read as data that got lost.
            row('Piezas', data.parts.length
                ? `(${data.parts.length}) ${data.parts.map(partLabel).join(', ')}`
                : 'Sin definir'),
        ]),
        // The notes are left as the customer wrote them, with their line
        // breaks: they are the only part of the form where formatting says something.
        data.notes ? `NOTAS\n${data.notes}` : null,
        SITE_URL ? `Panel del taller: ${SITE_URL}/pgs/taller.html` : null,
    ];

    const message = {
        to: [SHOP],
        // The plate has already passed PLATE_RE and the server generates the
        // code: both are safe to put in the subject. With no plate (only rows
        // from before walk-ins required one) the code is left, which always exists.
        subject: data.plate
            ? `Solicitud ${created.id}, placa ${data.plate}`
            : `Solicitud ${created.id}`,
        text: blocks.filter(Boolean).join('\n\n'),
        html: mailhtml.shopHtml(created, data, htmlContext(), walkIn),
    };

    // Replying to the workshop email writes to the customer, which is what
    // one wants to do on reading it.
    if (data.email) message.replyTo = data.email;

    return message;
}

/* -----------------------------------------------------------------------------
   What server.js calls
-------------------------------------------------------------------------- */

// The outbox: the emails still to send, each with the attempt it is on and
// the moment from which it can be retried.
//
// It lives in memory, and that is a decision, not an oversight: storing it in
// Postgres would need a table and a hand-run migration (see render.yaml) to
// protect a case (Render shutting the instance down right in the half hour
// mail is down) in which nothing important is lost anyway: the request is in
// the database and the workshop panel shows it just the same. What it does do
// is SAY SO on shutdown (see close()), so a notice that did not go out does
// not leave silently.
const OUTBOX = [];

// The queue is walked one at a time (see also oneAtATime, which also
// serialises with the startup check).
let draining = false;
let retryTimer = null;

/* -----------------------------------------------------------------------------
   Matizado orders (pgs/paintings.html)

   The same two emails (one to the customer with their code, another to the
   workshop with the order sheet) for the site's other form. The labels come
   from src/paints.js, the file the page reads to draw the cards: that way
   the email says «1/4 galón (946 ml)» where the screen said the same.
-------------------------------------------------------------------------- */

const PAINT_METHOD_LABELS = {
    code: 'Por código de color',
    model: 'Elegido por modelo y año (sin ver la etiqueta: confirmar)',
    reading: 'Lectura digital del cliente',
    in_person: 'Lectura en el taller',
};

function methodLabel(id) {
    return label(PAINT_METHOD_LABELS, id);
}

function finishLabel(id) {
    return id ? paints.finishLabel(id) : '';
}

/** «Toyota 1F7, Plata Metálico», or whatever of that there is. */
function colourName(data) {
    const code = [oneLine(data.brand), oneLine(data.colorCode)].filter(Boolean).join(' ');
    return [code, oneLine(data.colorName)].filter(Boolean).join(', ');
}

/** «1/4 galón (946 ml) × 2», or nothing when the container is decided at the workshop. */
function orderLine(data) {
    const size = data.size ? paints.size(data.size) : null;
    if (!size) return '';
    const units = data.units || 1;
    return `${size.label} (${size.volume})${units > 1 ? ` × ${units}` : ''}`;
}

function priceLabel(price) {
    return price === null || price === undefined ? '' : `${paints.formatSoles(price)} (referencial)`;
}

function readingLabel(reading) {
    if (!reading) return '';
    return `L* ${reading.L}, a* ${reading.a}, b* ${reading.b}`;
}

/**
 * The swatch's hex.
 *
 * First the one the server already resolved against the colour database when
 * confirming the order (confirmColour in server/server.js leaves data.hex):
 * it is the swatch of the exact colour the customer picked, including the
 * database's 693k colours the local catalogue lacks. That was the bug: many
 * colours came out without a swatch because only the local catalogue was
 * searched here.
 *
 * Without it (a local catalogue colour, the colour database off, or an old
 * order resent without going through confirmColour) it falls back to the
 * local catalogue as before. Empty when it is not there either; the email
 * builds the same, without a swatch.
 */
function colourHex(data) {
    if (data.hex) return data.hex;
    if (!data.colorCode || !data.brand) return '';
    const wanted = oneLine(data.brand).toLowerCase();
    const brandId = Object.keys(paints.BRAND_NAMES)
        .find((id) => paints.BRAND_NAMES[id].toLowerCase() === wanted);
    if (!brandId) return '';
    const colour = paints.findColour(brandId, data.colorCode);
    return colour ? colour.hex : '';
}

function paintContext() {
    return { oneLine, formatPhone, zoneLabel, methodLabel, finishLabel,
             colourName, orderLine, priceLabel, readingLabel, colourHex,
             siteUrl: SITE_URL, logoUrl: LOGO_URL, logoDarkUrl: LOGO_DARK_URL };
}

function paintCustomerMessage(created, data) {
    const name = oneLine(data.firstName);
    const inPerson = data.method === 'in_person';
    const lines = [
        name ? `Hola ${name},` : 'Hola,',
        '',
        ...(inPerson
            ? ['Anotamos tu visita. Trae el vehículo o una pieza suelta y medimos el',
               'color con el espectrofotómetro delante de ti; con el color aprobado',
               'decidimos ahí mismo el envase y el precio.']
            : ['Recibimos tu pedido de matizado. Preparamos la fórmula y te avisamos',
               'en cuanto esté lista para recoger.']),
        '',
        // The next step is ours: we write on WhatsApp within 24 h to arrange
        // the appointment or the pickup and settle the details.
        ...(inPerson
            ? ['Te escribimos por WhatsApp dentro de las próximas 24 horas para',
               'coordinar la cita y ver los detalles.']
            : ['Te escribimos por WhatsApp dentro de las próximas 24 horas para',
               'coordinar la entrega y ver los detalles.']),
        '',
    ];

    // With no colour or container yet, the block cannot be called «tu
    // pedido»: what there is is a visit, and the only line that can be
    // written about the colour is where it will be measured.
    const rows = [
        row('Nombre taller', data.company),
        row('Color', inPerson ? 'Se mide en el taller' : colourName(data)),
        row('Acabado', finishLabel(data.finish)),
        row('Envase', orderLine(data)),
        row('Total', priceLabel(data.price)),
    ];
    const summary = block(inPerson ? 'TU VISITA' : 'TU PEDIDO', rows);
    if (summary) lines.push(summary, '');

    lines.push('Tu código de pedido es:', '', `    ${created.id}`, '');
    lines.push(inPerson
        ? 'Guárdalo: con él te atendemos en el mostrador sin repetir los datos.'
        : 'Guárdalo: con él te atendemos en el mostrador y por WhatsApp.');

    if (!inPerson) {
        lines.push('', 'El precio es referencial. El taller lo cierra al matizar el color, y el',
            'color se aprueba con plancha de prueba antes de entregarlo.');
    }

    lines.push('', 'Autocolor');

    return {
        to: [data.email],
        subject: inPerson
            ? `Tu visita a Autocolor: código ${created.id}`
            : `Tu pedido de matizado en Autocolor: código ${created.id}`,
        text: lines.join('\n'),
        html: mailhtml.paintCustomerHtml(created, data, paintContext()),
    };
}

function paintShopMessage(created, data) {
    const blocks = [
        data.method === 'in_person'
            ? 'Visita para medir un color, desde la página de venta de matizado.'
            : 'Nuevo pedido de matizado desde el sitio.',
        block('CLIENTE', [
            row('Nombre taller', data.company),
            row('Contacto', `${oneLine(data.firstName)} ${oneLine(data.lastName)}`),
            row('Teléfono', formatPhone(data.phone)),
            row('Email', data.email),
        ]),
        block('PEDIDO', [
            row('Identificado', methodLabel(data.method)),
            row('Marca', data.brand),
            row('Código', data.colorCode),
            row('Color', data.colorName),
            row('Acabado', finishLabel(data.finish)),
            row('Lectura', readingLabel(data.reading)),
            row('Envase', orderLine(data)),
            row('Precio', priceLabel(data.price)),
        ]),
        data.notes ? `NOTAS DEL CLIENTE\n  ${oneLine(data.notes)}` : null,
        `Pedido ${created.id}`,
    ];

    return {
        to: [SHOP],
        // Replying to the email writes to the customer, which is what this is
        // for: confirming the colour or saying it is ready.
        replyTo: data.email || undefined,
        subject: `Matizado ${created.id}, ${oneLine(data.company)}`,
        text: blocks.filter(Boolean).join('\n\n'),
        html: mailhtml.paintShopHtml(created, data, paintContext()),
    };
}

/**
 * Announces a new matizado order. Same rules as notifyNewRequest(): it does
 * not throw, it queues both messages and returns as soon as they are queued.
 */
function notifyNewPaintOrder(created, data) {
    if (!isConfigured()) return { customer: false };

    if (withinDailyCap('shop', '')) {
        enqueue(`aviso al taller del matizado ${created.id}`, () => paintShopMessage(created, data));
    }

    let customer = false;
    if (data.email && withinDailyCap('customer', data.email)) {
        enqueue(`confirmación al cliente del matizado ${created.id}`, () => paintCustomerMessage(created, data));
        customer = true;
    }

    kick();
    return { customer };
}

/**
 * Announces a new request by email. IT NEVER THROWS OR REJECTS, not even if
 * building the messages fails: it is called without `await` and without
 * `.catch()` from the POST /api/requests handler, which already sent its 201.
 *
 * Returns as soon as the messages are queued. How long they take to go out is
 * drain()'s business.
 */
function notifyNewRequest(created, data, options) {
    if (!isConfigured()) return { customer: false };
    // Registered at the counter rather than sent from the website. Only the
    // wording changes (both messages go out the same way, to the same two
    // places) but a walk-in told «te contactaremos en 24 horas con tu
    // presupuesto» would read as a letter that did not notice they came in.
    const walkIn = !!(options && options.walkIn);

    // Each one separately: the workshop's failing to build cannot leave the
    // customer without their code, nor the other way round.
    if (withinDailyCap('shop', '')) {
        enqueue(`aviso al taller de ${created.id}`, () => shopMessage(created, data, walkIn));
    }

    // The wizard already requires it, but the guard stays: the database holds
    // requests from before email was required, and without it resending one
    // of those would send a message to `undefined`.
    let customer = false;
    if (data.email && withinDailyCap('customer', data.email)) {
        enqueue(`confirmación al cliente de ${created.id}`, () => customerMessage(created, data, walkIn));
        customer = true;
    }

    kick();
    // Whether the customer's confirmation was queued, so the staff panel does
    // not promise an email that was never going to be sent.
    return { customer };
}

/* -----------------------------------------------------------------------------
   Daily caps

   The customer confirmation is the one message whose recipient is chosen by
   whoever calls the public API. Without a ceiling a script could send the
   shop's branded mail to any address and use up Brevo's free quota (300 a
   day) within minutes, after which real customers stop getting their tracking
   code and the account's sender reputation takes the blame.

   The counters live in memory and reset at midnight UTC or on restart, which is
   enough: this is a ceiling against abuse, not accounting.
-------------------------------------------------------------------------- */

const DAILY_CAP = Number(process.env.AUTOCOLOR_MAIL_DAILY_CAP) || 280;
const CUSTOMER_DAILY_CAP = Number(process.env.AUTOCOLOR_MAIL_CUSTOMER_DAILY_CAP) || 120;
const PER_ADDRESS_DAILY_CAP = 3;

const today = { day: '', total: 0, customer: 0, perAddress: new Map(), warned: new Set() };

function withinDailyCap(kind, address) {
    const day = new Date().toISOString().slice(0, 10);
    if (today.day !== day) {
        Object.assign(today, { day, total: 0, customer: 0, perAddress: new Map(), warned: new Set() });
    }
    const refuse = (reason) => {
        // Once per reason per day: under attack this would otherwise be one
        // log line per request.
        if (!today.warned.has(reason)) {
            today.warned.add(reason);
            console.warn(`[mail] daily cap reached (${reason}); further messages of this kind are skipped until midnight UTC`);
        }
        return false;
    };

    if (today.total >= DAILY_CAP) return refuse(`all mail, ${DAILY_CAP}`);
    if (kind === 'customer') {
        const key = address.trim().toLowerCase();
        const sent = today.perAddress.get(key) || 0;
        // Per address, silently: three confirmations to one inbox in a day is
        // already more than a real customer needs.
        if (sent >= PER_ADDRESS_DAILY_CAP) return false;
        if (today.customer >= CUSTOMER_DAILY_CAP) return refuse(`customer confirmations, ${CUSTOMER_DAILY_CAP}`);
        today.perAddress.set(key, sent + 1);
        today.customer += 1;
    }
    today.total += 1;
    return true;
}

/**
 * Puts an email in the queue. The message is built HERE and not outside, so
 * a failure while building it dies inside this try.
 *
 * notifyNewRequest() used to be `async` and was called without `.catch()`: an
 * error building a body became an unhandled rejected promise, and Node takes
 * the whole process down for that (with the 201 already sent and every panel
 * session inside it).
 */
function enqueue(what, build) {
    let message;
    try {
        message = build();
    } catch (err) {
        console.error(`[mail] no se pudo armar ${what}: ${err.message}`);
        return;
    }
    // `retryAt` at 0 and not Date.now(): it can go right away.
    OUTBOX.push({ what, message, attempt: 0, retryAt: 0 });
    while (OUTBOX.length > MAX_OUTBOX) {
        const dropped = OUTBOX.shift();
        console.error(`[mail] cola llena (${MAX_OUTBOX}), se descarta ${dropped.what}`);
    }
}

/** drain() with nobody awaiting it, which is how it is always called. */
function kick() {
    drain().catch((err) => console.error(`[mail] fallo inesperado en la cola: ${err.message}`));
}

/**
 * Sends whatever is due, one at a time, and schedules the next retry if
 * something was left along the way.
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
                // Addresses are not logged: the host's log is no place for a
                // customer's contact details. The request code is enough to
                // follow the trail.
                const which = item.attempt > 0 ? ` (al intento ${item.attempt + 1})` : '';
                console.log(`[mail] salió ${item.what}${which}`);
            } catch (err) {
                // The conversation was cut without knowing whether the message
                // got in. Retrying could deliver it twice, so it stops and
                // says so, which is the only honest thing: it may have arrived.
                if (isDeliveryUnknown(err)) {
                    console.error(`[mail] ${item.what}: se cortó sin respuesta y puede haber llegado; no se reintenta para no duplicarlo: ${err.message}`);
                    continue;
                }
                // `undefined` when the attempts ran out.
                const delay = isPermanent(err) ? undefined : RETRY_DELAYS_MS[item.attempt];
                if (delay === undefined) {
                    // Nothing more to do: either they ran out, or the server
                    // said no and repeating it will not change that.
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

    // A pending email cannot be the reason the process does not end. The
    // server keeps the event loop alive while it is listening; once it stops,
    // whatever is left in the queue is announced in close() instead of holding
    // the shutdown for half an hour.
    retryTimer.unref();
}

/**
 * Checks that it can connect and authenticate, without sending anything. It
 * is what server.js reports at startup.
 *
 * It exists because a mail failure is invisible: requests keep being stored
 * and the site looks perfect, so without this the first sign that the
 * account is wrong is someone not getting their code, days later. Asking at
 * startup turns that into a line in the deploy log, which is where people look.
 *
 * Returns { ok: true } or { ok: false, error }; it does not throw.
 */
async function verify() {
    if (!isConfigured()) return { ok: false, error: 'falta AUTOCOLOR_BREVO_KEY' };

    let detail = null;
    // TWO ATTEMPTS, NOT ONE. This startup line is an alarm, and an alarm that
    // goes off now and then over a passing stumble stops being looked at,
    // which is the one thing this check cannot afford.
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            // It asks about the account instead of sending a test email: it
            // checks the key and the path to the API, does not spend one of the
            // free plan's 300 daily sends and reaches nobody.
            const account = await request(ACCOUNT_URL);
            return { ok: true, account: account && account.email };
        } catch (err) {
            detail = err.message;
            // A wrong key does not get better by repeating it.
            if (isPermanent(err)) break;
        }
    }
    return { ok: false, error: detail };
}

/** The mail configuration, without the key. For /api/staff/whoami. */
function describe() {
    return {
        configured: isConfigured(),
        endpoint: SEND_URL,
        from: SENDER,
        shop: SHOP,
        // How many notices are waiting their turn or their retry. A number
        // that does not go down between two checks is the sign mail is down,
        // without having to dig for it in the deploy log.
        pending: OUTBOX.length,
    };
}

/**
 * Drops the queue. ONLY the orderly shutdown in server.js calls it, and after
 * server.close(): the queue belongs to nobody else.
 *
 * It closes nothing (each send is a request that finishes on its own); what
 * it does is cancel the retry clock and PUT ON RECORD what is left unsent.
 * It is the flip side of keeping the queue in memory: if Render shuts the
 * instance down with pending notices, they are lost, and the deploy log has
 * to say which ones so nobody finds out through a phone call.
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
    notifyNewPaintOrder,
    close,
    // Exported so the bodies can be reviewed without sending anything (see
    // tools/mailpreview.js).
    customerMessage,
    shopMessage,
    paintCustomerMessage,
    paintShopMessage,
};
