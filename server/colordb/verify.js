/* Proves the colour database is boxed in.
 *
 *     npm run colordb:verify
 *
 * Connects as the application role — not as the owner — and checks that what
 * should be refused is refused. Run it after every push, and after any change
 * to sql/70 or sql/80: a privilege mistake is silent otherwise, because the
 * page keeps working perfectly well while the door stands open.
 *
 * Reads AUTOCOLOR_COLORDB_URL, the same variable the server uses.
 */

'use strict';

require('../env.js');

const { Pool } = require('pg');
const paints = require('../../src/paints.js');
const catalog = require('../../src/paintCatalog.js');
const colordb = require('../colordb.js');

const URL = process.env.AUTOCOLOR_COLORDB_URL || '';
if (!URL) {
    console.error('AUTOCOLOR_COLORDB_URL is not set. Nothing to verify.');
    process.exit(1);
}

let passed = 0;
const failures = [];

function ok(what, detail) {
    passed += 1;
    console.log(`  ok    ${what}${detail ? '  — ' + detail : ''}`);
}

function fail(what, detail) {
    failures.push(what);
    console.log(`  FAIL  ${what}${detail ? '  — ' + detail : ''}`);
}

function check(what, condition, detail) {
    if (condition) ok(what, detail); else fail(what, detail);
}

// Runs a statement that must be refused, and checks which error came back.
// `codes` are the SQLSTATEs that count as the right refusal; anything else is
// a failure even though it also threw, because the reason matters.
async function refuses(client, what, sql, codes) {
    try {
        await client.query(sql);
        fail(what, 'it was ALLOWED');
    } catch (err) {
        if (codes.includes(err.code)) ok(what, err.code);
        else fail(what, `refused with ${err.code}, expected ${codes.join('/')}`);
    }
}

async function main() {
    console.log(`\nVerifying ${colordb.describe()}\n`);

    console.log('The connection');
    const complaint = colordb.sslComplaint(URL);
    check('the URL demands sslmode=verify-full', complaint === '', complaint || undefined);
    check('sslComplaint rejects sslmode=require',
        colordb.sslComplaint('postgresql://u:p@host.neon.tech/db?sslmode=require') !== '');
    check('sslComplaint rejects sslmode=disable',
        colordb.sslComplaint('postgresql://u:p@host.neon.tech/db?sslmode=disable') !== '');
    check('sslComplaint accepts sslmode=verify-full',
        colordb.sslComplaint('postgresql://u:p@host.neon.tech/db?sslmode=verify-full') === '');

    const pool = new Pool({ connectionString: URL, max: 2, connectionTimeoutMillis: 20_000 });
    const client = await pool.connect();
    const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(URL);
    try {
        const encrypted = Boolean(client.connection
            && client.connection.stream
            && client.connection.stream.encrypted);
        if (local) ok('TLS on the wire', 'skipped: loopback');
        else check('TLS on the wire', encrypted);

        const who = await client.query('SELECT current_user AS u');
        check('connected as colordb_app, not the owner',
            who.rows[0].u === 'colordb_app', who.rows[0].u);

        console.log('\nWhat the role must not be able to do');
        await refuses(client, 'read colour.vehicle_colour directly',
            'SELECT 1 FROM colour.vehicle_colour LIMIT 1', ['42501', '3F000']);
        await refuses(client, 'read colour.colour directly',
            'SELECT 1 FROM colour.colour LIMIT 1', ['42501', '3F000']);
        await refuses(client, 'read colour.make directly',
            'SELECT 1 FROM colour.make LIMIT 1', ['42501', '3F000']);
        await refuses(client, 'write anything',
            'CREATE TABLE public.t (x int)', ['42501', '25006', '3F000']);
        await refuses(client, 'read a file off the host',
            "SELECT pg_read_file('/etc/passwd')", ['42501']);

        console.log('\nThe formulas are not here at all');
        for (const t of ['formulas', 'formula_ingredients', 'products', 'color_usage_notes']) {
            await refuses(client, `${t} does not exist`, `SELECT 1 FROM ${t}`, ['42P01', '3F000']);
        }

        console.log('\nSession defaults');
        const ro = await client.query('SELECT current_setting($1) AS v', ['transaction_read_only']);
        check('the session is read only', ro.rows[0].v === 'on', ro.rows[0].v);
        const sp = await client.query('SELECT current_setting($1) AS v', ['search_path']);
        // Postgres renders an empty search_path as the two characters "" .
        check('search_path is empty, so calls must be qualified',
            sp.rows[0].v === '' || sp.rows[0].v === '""', `${sp.rows[0].v}`);
        const st = await client.query('SELECT current_setting($1) AS v', ['statement_timeout']);
        check('a statement timeout is set', st.rows[0].v !== '0', st.rows[0].v);

        const vis = await client.query(
            "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'colour'");
        check('the data schema is invisible in information_schema', vis.rows[0].n === 0,
            `${vis.rows[0].n} tables visible`);

        console.log('\nThe functions hold their own limits');
        const stats = (await client.query('SELECT * FROM api.stats()')).rows[0];
        check('api.stats() answers', Boolean(stats),
            stats && `${stats.colours} colours, ${stats.links} links, built ${new Date(stats.built_at).toISOString().slice(0, 10)}`);

        const makes = (await client.query('SELECT * FROM api.makes()')).rows;
        check('api.makes() returns the grouped brands', makes.length === stats.makes, `${makes.length}`);
        check('the shop brands sort first',
            makes.slice(0, 10).every((m) => m.sort_key <= 10),
            makes.slice(0, 10).map((m) => m.label).join(', '));

        const toyota = makes.find((m) => m.label === 'Toyota');
        check('Toyota is one make, not several', Boolean(toyota));

        const far = await client.query('SELECT * FROM api.colours_for($1, NULL, NULL, $2)',
            [toyota.make_id, 999999]);
        check('a wild offset is clamped inside the function', far.rows.length <= 61,
            `${far.rows.length} rows`);
        const page = await client.query('SELECT * FROM api.colours_for($1)', [toyota.make_id]);
        check('a page is never more than 61 rows', page.rows.length <= 61, `${page.rows.length} rows`);

        // One tile per paint. The grid used to emit a row per factory code, so
        // Jeep's JAZZ BLUE PEARL arrived twice -- once as KBX, once as PBX --
        // and a page of 61 was not 61 colours.
        const swCodes = new Set(page.rows.map((r) => r.sw_code));
        check('a page of tiles is that many distinct colours',
            swCodes.size === page.rows.length,
            `${page.rows.length} rows, ${swCodes.size} colours`);

        // Every colour carries a screen colour, mixed from its own formula by
        // sql/35_hex.sql. A blank tile reads as a broken page.
        const noHex = page.rows.filter((r) => !/^#[0-9a-f]{6}$/.test(r.hex || ''));
        check('every colour has a hex to render',
            noHex.length === 0,
            noHex.length ? `${noHex.length} without one: ${noHex[0].oem_name}` : `${page.rows.length} of ${page.rows.length}`);

        for (const [label, code] of [['a one-character', 'A'], ['a wildcard', '%'], ['an empty', '']]) {
            await refuses(client, `${label} code is refused`,
                `SELECT * FROM api.colour_by_code(${toyota.make_id}, '${code}')`, ['22023']);
        }
        check('an integer literal resolves against the signature', true,
            'no undefined_function above');

        // Case and punctuation only. Digging a code out of a longer label
        // would be a substring search, which is what the API refuses to be.
        const plain = await client.query('SELECT * FROM api.colour_by_code($1, $2)', [toyota.make_id, '1F7']);
        const messy = await client.query('SELECT * FROM api.colour_by_code($1, $2)', [toyota.make_id, '1-f-7']);
        check('a code is normalised the way the page normalises it',
            plain.rows.length > 0 && messy.rows.length === plain.rows.length,
            plain.rows.length ? `1F7 and 1-f-7 both → ${plain.rows[0].oem_name}` : 'no rows for 1F7');

        // Sherwin's own code is a second way in: 5,782 colours carry no factory
        // code at all and were unreachable before.
        const byOwn = await client.query('SELECT * FROM api.colour_by_code($1, $2)',
            [toyota.make_id, plain.rows.length ? plain.rows[0].sw_code : '0']);
        check('a Sherwin colour code also finds the colour',
            plain.rows.length === 0 || byOwn.rows.some((r) => r.sw_code === plain.rows[0].sw_code),
            plain.rows.length ? `${plain.rows[0].sw_code} → ${byOwn.rows.length} row(s)` : 'skipped');

        console.log('\nThe page keeps working');
        const labels = new Set(makes.map((m) => m.label));
        const missing = Object.values(paints.BRAND_NAMES).filter((n) => !labels.has(n));
        check('every BRAND_NAMES label exists as a make', missing.length === 0,
            missing.length ? `missing: ${missing.join(', ')}` : '10 of 10');

        const norm = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
        let tried = 0;
        let found = 0;
        for (const brand of Object.keys(catalog.colours)) {
            const make = makes.find((m) => m.label === paints.BRAND_NAMES[brand]);
            if (!make) continue;
            for (const row of catalog.colours[brand]) {
                tried += 1;
                const codes = [row[0]].concat(row[7] || []).map(norm).filter((c) => c.length >= 2);
                for (const c of codes) {
                    const r = await client.query(
                        'SELECT 1 FROM api.colour_by_code($1, $2) LIMIT 1', [make.make_id, c]);
                    if (r.rows.length) { found += 1; break; }
                }
            }
        }
        // 746 of 777 is what the make grouping was measured to give. Below that
        // and something in sql/10_makes.sql has regressed.
        check('the sidecar still resolves into the database', found >= 746,
            `${found} of ${tried}, ${(100 * found / tried).toFixed(1)}%`);
    } finally {
        client.release();
        await pool.end();
    }

    console.log(`\n${passed} checks passed, ${failures.length} failed.`);
    if (failures.length) {
        console.log('Failed: ' + failures.join('; '));
        process.exitCode = 1;
    }
}

main().catch((err) => {
    console.error('\nverify could not run:', err.message);
    process.exitCode = 1;
});
