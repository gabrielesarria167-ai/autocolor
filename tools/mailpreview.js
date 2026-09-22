#!/usr/bin/env node
'use strict';

/* =============================================================================
   Imprime los dos correos de una solicitud sin mandar nada.

       node tools/mailpreview.js

   server/mail.js arma los cuerpos y los manda en el mismo módulo, así que sin
   esto la única forma de ver cómo queda un correo era enviarlo de verdad —a
   un cliente inventado y con la cuenta de correo puesta—. Aquí se ven los dos
   con datos de mentira, incluido el caso de quien no dejó su correo.

   Toma la solicitud de ejemplo tal como sale de validateRequest(): con sus
   `null` donde el formulario venía vacío, que es lo que recibe mail.js en
   producción.
   ========================================================================== */

// El logotipo y los botones de los correos salen de la dirección del sitio, y
// en la máquina de trabajo no hay ninguna: sin esto la vista previa enseña el
// nombre escrito y ningún enlace, que es justo lo que no se quiere mirar. Se
// apunta al repositorio, que un navegador abre igual. Se pone ANTES de cargar
// server/mail.js, que lee la variable al cargarse.
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

// Lo mínimo que HOY puede llegar: sin kilometraje, sin código de color y sin
// notas, que son los tres campos que el asistente sigue dejando vacíos. El
// correo, el departamento y la provincia ya no pueden faltar —validateRequest
// los exige—, así que ponerlos a null probaba una carga imposible.
const MINIMAL = {
    ...FULL,
    mileage: null,
    colorCode: null,
    notes: null,
    parts: ['hood'],
};

// Una fila anterior a que el correo fuera obligatorio. No sale del asistente,
// pero sí de la base, y mail.js tiene una guarda para ella (el `if (data.email)`
// de notifyNewRequest): esto es lo que se ve al reenviar una de esas.
const LEGACY = {
    ...MINIMAL,
    department: null,
    province: null,
    email: null,
};

// Un vehículo que llegó al local y se registró desde el panel del taller
// (POST /api/staff/requests). El jefe contesta seis cosas, así que casi todo lo
// demás llega vacío: sin marca, sin modelo, sin placa, sin piezas y sin zona.
// La silueta 3D y el acabado sí, que son de las seis. Es el caso que prueba que
// el correo sigue nombrando el vehículo cuando no hay marca ni modelo.
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

// El HTML se escribe a disco además de resumirse: mirarlo en un navegador es
// la única forma de ver si la maqueta quedó bien, y `node tools/mailpreview.js`
// no puede enseñar una tarjeta de 600 px en la terminal.
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
// El tercer argumento es lo único que separa un vehículo del local de una
// solicitud del sitio: los dos mensajes salen igual, con otra redacción.
const walkInCustomer = mail.customerMessage(CREATED, WALK_IN, true);
const walkInShop = mail.shopMessage(CREATED, WALK_IN, true);

// Los dos correos de un pedido de matizado (pgs/paintings.html), tal como
// salen de validatePaintOrder(). Dos casos, que son los dos que existen: un
// pedido con su color y su envase, y una visita al taller, que llega sin
// ninguna de las dos cosas y por eso tiene su propia redacción.
const PAINT_ORDER = {
    method: 'code',
    brand: 'Toyota',
    colorCode: '1F7',
    colorName: 'Plata Metálico',
    finish: 'metalico',
    // El hex que confirmColour() (server/server.js) resuelve contra la base de
    // colores al guardar el pedido. Antes no viajaba y colourHex() lo buscaba
    // en el catálogo local; ahora el correo pinta esta muestra directamente.
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

// Una lectura del espectrofotómetro del cliente: el caso que prueba que los
// tres valores CIELAB llegan al correo del taller, que es quien los usa.
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

show('AL CLIENTE — solicitud completa', customer);
show('AL TALLER — solicitud completa', shop);
show('AL TALLER — sin los datos opcionales', shopMinimal);
show('AL TALLER — fila antigua, sin correo ni zona', shopLegacy);
show('AL CLIENTE — vehículo registrado en el local', walkInCustomer);
show('AL TALLER — vehículo registrado en el local', walkInShop);
show('AL CLIENTE — pedido de matizado', paintCustomer);
show('AL TALLER — pedido de matizado', paintShop);
show('AL CLIENTE — visita para medir el color', paintVisitCustomer);
show('AL TALLER — matizado con lectura del cliente', paintReadingShop);

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
