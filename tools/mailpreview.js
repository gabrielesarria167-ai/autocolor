#!/usr/bin/env node
'use strict';

/* =============================================================================
   Prints the two emails of a request without sending anything.

       node tools/mailpreview.js

   server/mail.js builds the bodies and sends them in the same module, so
   without this the only way to see how an email looks was to really send it
   (to a made-up customer, with the mail account configured). Here both are
   shown with fake data, including the case of someone who left no email.

   It takes the sample request exactly as it comes out of validateRequest():
   with its `null`s where the form was empty, which is what mail.js receives
   in production.
   ========================================================================== */

// The logo and the buttons in the emails come from the site's address, and
// the work machine has none: without this the preview shows the name written
// out and no links, which is exactly what we do not want to look at. It
// points at the repository, which a browser opens just the same. It is set
// BEFORE loading server/mail.js, which reads the variable on load.
process.env.AUTOCOLOR_SITE_URL = process.env.AUTOCOLOR_SITE_URL
    || `file://${require('node:path').join(__dirname, '..')}`;

const mail = require('../server/mail');

const CREATED = { id: '4820175639', status: 'recibido', createdAt: new Date() };

const FULL = {
    brand: 'Toyota',
    model: 'Corolla',
    bodyType: 'sedan',
    year: 2020,
    plate: 'ABC-123',
    mileage: 85000,
    colorCode: '1F7',
    vehicle: 'wagon',
    quality: 'premium',
    parts: ['hood', 'front_door_left', 'roof'],
    firstName: 'Juan',
    lastName: 'Pérez',
    department: 'Ayacucho',
    province: 'Huamanga',
    phone: '+51935646304',
    email: 'juan@ejemplo.com',
    notes: 'El capó tiene un rayón profundo.\nEl techo solo necesita pulido.',
};

// The minimum that can arrive TODAY: no mileage, no colour code and no notes,
// the three fields the wizard still leaves empty. Email, department and
// province can no longer be missing (validateRequest requires them), so
// setting them to null tested an impossible payload.
const MINIMAL = {
    ...FULL,
    mileage: null,
    colorCode: null,
    notes: null,
    parts: ['hood'],
};

// A row from before email was required. It does not come from the wizard,
// but it does from the database, and mail.js has a guard for it (the
// `if (data.email)` in notifyNewRequest): this is what resending one looks like.
const LEGACY = {
    ...MINIMAL,
    department: null,
    province: null,
    email: null,
};

// A vehicle that arrived at the shop and was registered from the workshop
// panel (POST /api/staff/requests). The boss answers six things, so almost
// everything else arrives empty: no make, no model, no plate, no panels and
// no zone. The 3D silhouette and the finish do, being among the six. It is the
// case that proves the email still names the vehicle with no make or model.
const WALK_IN = {
    brand: null,
    model: null,
    bodyType: null,
    year: null,
    plate: null,
    mileage: null,
    colorCode: null,
    vehicle: 'suv',
    quality: 'standard',
    parts: [],
    firstName: 'Lucía',
    lastName: 'Mendoza',
    department: null,
    province: null,
    phone: '+51987333444',
    email: 'lucia@ejemplo.com',
    notes: 'Rayón en la puerta derecha.',
};

// The HTML is written to disk as well as summarised: looking at it in a
// browser is the only way to see whether the layout came out right, and
// `node tools/mailpreview.js` cannot show a 600 px card in the terminal.
const OUT_DIR = process.env.MAILPREVIEW_OUT || require('node:os').tmpdir();

function writeHtml(name, message) {
    if (!message.html) return null;
    const file = require('node:path').join(OUT_DIR, name);
    require('node:fs').writeFileSync(file, message.html);
    return file;
}

function show(title, message) {
    console.log(`\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}`);
    const from = mail.describe().from;
    console.log(`De:       ${from.name} <${from.email}>`);
    console.log(`Para:     ${message.to.join(', ')}`);
    if (message.replyTo) console.log(`Responder: ${message.replyTo}`);
    console.log(`Asunto:   ${message.subject}`);
    console.log(`${'-'.repeat(72)}\n${message.text}`);
}

const customer = mail.customerMessage(CREATED, FULL);
const shop = mail.shopMessage(CREATED, FULL);
const shopMinimal = mail.shopMessage(CREATED, MINIMAL);
const shopLegacy = mail.shopMessage(CREATED, LEGACY);
// The third argument is all that separates a vehicle from the shop from a
// request from the site: both messages go out the same, with other wording.
const walkInCustomer = mail.customerMessage(CREATED, WALK_IN, true);
const walkInShop = mail.shopMessage(CREATED, WALK_IN, true);

// The two emails of a matizado order (pgs/paintings.html), as they come out
// of validatePaintOrder(). Two cases, the only two there are: an order with
// its colour and container, and a workshop visit, which arrives with neither
// and so has its own wording.
const PAINT_ORDER = {
    method: 'code',
    brand: 'Toyota',
    colorCode: '1F7',
    colorName: 'Plata Metálico',
    finish: 'metalico',
    // The hex confirmColour() (server/server.js) resolves against the colour
    // database when storing the order. It used to not travel and colourHex()
    // looked it up in the local catalogue; now the email paints this swatch directly.
    hex: '#bdc7c8',
    reading: null,
    size: '1_4',
    units: 2,
    price: 272,
    company: 'Taller Los Andes S.A.C.',
    ruc: '20123456789',
    firstName: 'Gabriela',
    lastName: 'Quispe',
    department: 'Ayacucho',
    province: 'Huamanga',
    phone: '+51935646304',
    email: 'compras@ejemplo.com',
    notes: 'Necesitamos la entrega el viernes por la mañana.',
};

const PAINT_VISIT = {
    method: 'in_person',
    brand: null,
    colorCode: null,
    colorName: null,
    finish: null,
    reading: null,
    size: null,
    units: null,
    price: null,
    company: 'Concesionaria Sur E.I.R.L.',
    ruc: '20456789123',
    firstName: 'Luis',
    lastName: 'Mendoza',
    department: 'Lima',
    province: 'Lima',
    phone: '+51912345678',
    email: 'taller@ejemplo.com',
    notes: null,
};

// A reading from the customer's spectrophotometer: the case that proves the
// three CIELAB values reach the workshop email, which is the one that uses them.
const PAINT_READING = {
    ...PAINT_ORDER,
    method: 'reading',
    brand: 'Jeep',
    colorCode: 'PAU',
    colorName: 'Gris Granite',
    finish: 'perlado',
    reading: { L: 35.2, a: 12.8, b: -4.1 },
    size: '1_8',
    units: 3,
    price: 291,
    notes: null,
};

const paintCustomer = mail.paintCustomerMessage(CREATED, PAINT_ORDER);
const paintShop = mail.paintShopMessage(CREATED, PAINT_ORDER);
const paintVisitCustomer = mail.paintCustomerMessage(CREATED, PAINT_VISIT);
const paintReadingShop = mail.paintShopMessage(CREATED, PAINT_READING);

show('AL CLIENTE: solicitud completa', customer);
show('AL TALLER: solicitud completa', shop);
show('AL TALLER: sin los datos opcionales', shopMinimal);
show('AL TALLER: fila antigua, sin correo ni zona', shopLegacy);
show('AL CLIENTE: vehículo registrado en el local', walkInCustomer);
show('AL TALLER: vehículo registrado en el local', walkInShop);
show('AL CLIENTE: pedido de matizado', paintCustomer);
show('AL TALLER: pedido de matizado', paintShop);
show('AL CLIENTE: visita para medir el color', paintVisitCustomer);
show('AL TALLER: matizado con lectura del cliente', paintReadingShop);

const written = [
    ['cliente', writeHtml('autocolor-cliente.html', customer)],
    ['taller', writeHtml('autocolor-taller.html', shop)],
    ['taller (mínimo)', writeHtml('autocolor-taller-min.html', shopMinimal)],
    ['taller (antiguo)', writeHtml('autocolor-taller-legacy.html', shopLegacy)],
    ['cliente (local)', writeHtml('autocolor-cliente-local.html', walkInCustomer)],
    ['taller (local)', writeHtml('autocolor-taller-local.html', walkInShop)],
    ['cliente (matizado)', writeHtml('autocolor-cliente-matizado.html', paintCustomer)],
    ['taller (matizado)', writeHtml('autocolor-taller-matizado.html', paintShop)],
    ['cliente (visita)', writeHtml('autocolor-cliente-visita.html', paintVisitCustomer)],
    ['taller (lectura)', writeHtml('autocolor-taller-lectura.html', paintReadingShop)],
].filter(([, file]) => file);
if (written.length) {
    console.log(`\n${'='.repeat(72)}\nHTML para mirar en el navegador\n${'='.repeat(72)}`);
    for (const [name, file] of written) console.log(`  ${name.padEnd(16)} ${file}`);
}
console.log(`\n(Con AUTOCOLOR_BREVO_KEY puesta, notifyNewRequest() mandaría estos.)`);
console.log(`Configurado ahora mismo: ${mail.isConfigured() ? 'sí' : 'no'}\n`);
