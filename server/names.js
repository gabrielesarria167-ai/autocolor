'use strict';

/* =============================================================================
   Worker names from their code.

   A code is the first initial, the surname initial and five digits (AB12345 ->
   A…, B…). See server/auth.js. The names themselves are configured next to the
   codes, in AUTOCOLOR_WORKER_IDS and AUTOCOLOR_BOSS_ID, as `CODE:Name` entries;
   this file is only the lookup.

   It used to invent a name from the code — a table of Peruvian first names and
   surnames indexed by the two initials, so that AB12345 always came out as
   «Andrés Bravo». That was scaffolding for a panel that had nobody real in it
   yet. Now the shop's own people are configured, and a made-up name next to a
   real one would be worse than a bare code.

   It lives on the server and not in the browser on purpose: the panel shows
   the name the API sends it (see server/db.js and server/server.js), so there
   is one place where it is decided and not two that can drift apart.

   A code with no configured name gets an empty string back, and every caller
   falls back to showing the code.
   ========================================================================== */

const auth = require('./auth');

const CODE_RE = /^[A-Z]{2}[0-9]{5}$/;

/**
 * The configured name for a worker code, or an empty string when the code has
 * no name — or no shape: two letters and five digits is what the login form,
 * the database CHECK and this all agree on.
 */
function nameFor(workerId) {
    const code = String(workerId || '').trim().toUpperCase();
    if (!CODE_RE.test(code)) return '';
    return auth.workerName(code);
}

module.exports = { nameFor };
