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

// El HTML se escribe a disco además de resumirse: mirarlo en un navegador es
// la única forma de ver si la maqueta quedó bien, y `node tools/mailpreview.js`
// no puede enseñar una tarjeta de 600 px en la terminal.
const OUT_DIR = process.env.MAILPREVIEW_OUT || require('node:os').tmpdir();

function writeHtml(name, message) {
    if (!message.html) return null;
    const file = require('node:path').join(OUT_DIR, name);
    // El logotipo viaja pegado al correo (cid:), que un navegador no resuelve.
    // Para mirarlo se apunta al archivo del repositorio.
    const logo = 'file://' + require('node:path').join(__dirname, '..', 'imgs', 'logoEmail.jpg');
    // El identificador termina donde termina el atributo, no en la siguiente
    // comilla: los cuerpos van escapados, así que un `[^"]+` no encontraba
    // dónde parar y se llevaba por delante medio `<img>`. Y el reemplazo va en
    // una función porque en una cadena los `$` significan otra cosa.
    require('node:fs').writeFileSync(file, message.html.replace(/cid:[^"'\s>]+/g, () => logo));
    return file;
}

function show(title, message) {
    console.log(`\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}`);
    // Sin cuenta configurada el remitente sale vacío, que es exactamente lo
    // que pasaría al mandar: se dice, en vez de enseñar un renglón en blanco.
    console.log(`De:       ${message.from || '(sin configurar: saldría «Autocolor <AUTOCOLOR_SMTP_USER>»)'}`);
    console.log(`Para:     ${message.to.join(', ')}`);
    if (message.replyTo) console.log(`Responder: ${message.replyTo}`);
    console.log(`Asunto:   ${message.subject}`);
    console.log(`${'-'.repeat(72)}\n${message.text}`);
}

const customer = mail.customerMessage(CREATED, FULL);
const shop = mail.shopMessage(CREATED, FULL);
const shopMinimal = mail.shopMessage(CREATED, MINIMAL);
const shopLegacy = mail.shopMessage(CREATED, LEGACY);

show('AL CLIENTE — solicitud completa', customer);
show('AL TALLER — solicitud completa', shop);
show('AL TALLER — sin los datos opcionales', shopMinimal);
show('AL TALLER — fila antigua, sin correo ni zona', shopLegacy);

const written = [
    ['cliente', writeHtml('autocolor-cliente.html', customer)],
    ['taller', writeHtml('autocolor-taller.html', shop)],
    ['taller (mínimo)', writeHtml('autocolor-taller-min.html', shopMinimal)],
    ['taller (antiguo)', writeHtml('autocolor-taller-legacy.html', shopLegacy)],
].filter(([, file]) => file);
if (written.length) {
    console.log(`\n${'='.repeat(72)}\nHTML para mirar en el navegador\n${'='.repeat(72)}`);
    for (const [name, file] of written) console.log(`  ${name.padEnd(16)} ${file}`);
}
console.log(`\n(Con la cuenta de correo puesta, notifyNewRequest() mandaría estos.)`);
console.log(`Configurado ahora mismo: ${mail.isConfigured() ? 'sí' : 'no'}\n`);
