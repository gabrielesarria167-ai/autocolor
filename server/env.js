'use strict';

/* =============================================================================
   Carga el archivo .env de la raíz del proyecto dentro de process.env.

   Existe por una razón concreta: la contraseña del panel del taller vive en
   AUTOCOLOR_STAFF_PASSWORD, y si el único modo de darla es escribirla delante
   de cada arranque…

       AUTOCOLOR_STAFF_PASSWORD='...' npm start

   …basta olvidarla una vez —o arrancar con `npm start` a secas— para que el
   panel responda 503 y parezca roto. Con el .env al lado, `npm start` alcanza.

   Lo que ya viene en el entorno gana: exportar una variable en la terminal, o
   ponerla delante del comando, sigue mandando sobre el archivo. Así el .env es
   el valor de todos los días y no un obstáculo cuando se quiere otro.

   El .env está en .gitignore y no debe salir de la máquina. Importa más de lo
   normal aquí: este repositorio se publica entero en GitHub Pages, así que un
   secreto versionado quedaría a la vista de cualquiera. Ver .env.example.
   ========================================================================== */

const fs = require('node:fs');
const path = require('node:path');

const ENV_PATH = path.join(__dirname, '..', '.env');

function parse(text) {
    const out = new Map();
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        // Comentarios y líneas en blanco.
        if (line === '' || line.startsWith('#')) continue;

        const eq = line.indexOf('=');
        if (eq < 1) continue;

        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();

        // Las comillas son para que la contraseña pueda llevar espacios o un
        // '#' sin que se corte; se quitan solo si envuelven todo el valor.
        const quoted = value.length >= 2 &&
            ((value[0] === '"' && value.endsWith('"')) ||
             (value[0] === "'" && value.endsWith("'")));
        if (quoted) value = value.slice(1, -1);

        out.set(key, value);
    }
    return out;
}

function load() {
    let text;
    try {
        text = fs.readFileSync(ENV_PATH, 'utf8');
    } catch (err) {
        // No tener .env es normal: en producción las variables llegan del
        // entorno. Cualquier otro error sí se avisa, porque un .env que existe
        // pero no se puede leer es un problema que conviene ver.
        if (err.code !== 'ENOENT') {
            console.warn(`No se pudo leer ${ENV_PATH}: ${err.message}`);
        }
        return;
    }

    for (const [key, value] of parse(text)) {
        if (process.env[key] === undefined) process.env[key] = value;
    }
}

// Se ejecuta al requerir el módulo, y una sola vez: la caché de require se
// encarga de que los demás archivos puedan pedirlo sin coordinarse.
load();

module.exports = { ENV_PATH };
