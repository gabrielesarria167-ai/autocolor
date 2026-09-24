'use strict';

/* =============================================================================
   Loads the .env file at the project root into process.env.

   It exists for one concrete reason: the workshop panel password lives in
   AUTOCOLOR_STAFF_PASSWORD, and if the only way to provide it is typing it
   in front of every start:

       AUTOCOLOR_STAFF_PASSWORD='...' npm start

   then forgetting it once (or starting with a bare `npm start`) is enough for
   the panel to answer 503 and look broken. With the .env alongside, `npm
   start` is enough.

   Whatever the environment already has wins: exporting a variable in the
   terminal, or putting it in front of the command, still overrides the file.
   That way the .env is the everyday value and not an obstacle when another
   one is wanted.

   The .env is in .gitignore and must not leave the machine. It matters more
   than usual here: the repository is public on GitHub, so a committed secret
   would be in plain view. See .env.example.
   ========================================================================== */

const fs = require('node:fs');
const path = require('node:path');

const ENV_PATH = path.join(__dirname, '..', '.env');

function parse(text) {
    const out = new Map();
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        // Comments and blank lines.
        if (line === '' || line.startsWith('#')) continue;

        const eq = line.indexOf('=');
        if (eq < 1) continue;

        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();

        // Quotes let the password carry spaces or a '#' without being cut;
        // they are only stripped if they wrap the whole value.
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
        // Having no .env is normal: in production the variables come from
        // the environment. Any other error is reported, because a .env that
        // exists but cannot be read is a problem worth seeing.
        if (err.code !== 'ENOENT') {
            console.warn(`No se pudo leer ${ENV_PATH}: ${err.message}`);
        }
        return;
    }

    for (const [key, value] of parse(text)) {
        if (process.env[key] === undefined) process.env[key] = value;
    }
}

// Runs when the module is required, and only once: the require cache makes
// sure the other files can ask for it without coordinating.
load();

module.exports = { ENV_PATH };
