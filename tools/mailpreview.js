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
    parts: ['hood', 'door_front_left', 'roof'],
    firstName: 'Juan',
    lastName: 'Pérez',
    department: 'Ayacucho',
    province: 'Huamanga',
    phone: '+51935646304',
    email: 'juan@ejemplo.com',
    notes: 'El capó tiene un rayón profundo.\nEl techo solo necesita pulido.',
};

// Lo mínimo que valida el asistente: sin correo, sin kilometraje, sin código
// de color, sin zona y sin notas.
const MINIMAL = {
    ...FULL,
    mileage: null,
    colorCode: null,
    department: null,
    province: null,
    email: null,
    notes: null,
    parts: ['hood'],
};

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

show('AL CLIENTE — solicitud completa', mail.customerMessage(CREATED, FULL));
show('AL TALLER — solicitud completa', mail.shopMessage(CREATED, FULL));
show('AL TALLER — sin correo ni datos opcionales', mail.shopMessage(CREATED, MINIMAL));
console.log(`\n(Con la cuenta de correo puesta, notifyNewRequest() mandaría estos.)`);
console.log(`Configurado ahora mismo: ${mail.isConfigured() ? 'sí' : 'no'}\n`);
