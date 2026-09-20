/* Reconciles the mixed hex with the colour's own name.
 *
 *     node server/colordb/reconcile-hex.js      (load.sh runs it for you)
 *
 * sql/35_hex.sql mixes a screen colour out of each colour's tinting formula.
 * That is the best evidence available -- it is the recipe the shop would
 * actually pour -- and measured against the scanned chips in
 * src/paintCatalog.js it lands within a median dE76 of about 14, which for a
 * swatch is close. But the model is a weighted subtractive mix, not
 * Kubelka-Munk: it has no absorption and scattering coefficients, so it gets
 * two things wrong in a way that shows.
 *
 * A transparent tint over a metallic ground is read as though it were the
 * surface colour. AUTUM GOLD MET. is 47% VERM. TRANSPARENTE over aluminium
 * and mixed to #a84231, a brick red, where the paint is a warm gold.
 *
 * And a ground coat is sometimes not the colour at all. ROJO PEARL./CL is a
 * tricoat whose ground is brown and gold, with no red pigment in it; mixed
 * straight it came out #b58837, and a tile labelled ROJO that renders gold is
 * worse than no tile.
 *
 * So where the mix lands in a different colour family than the name states,
 * the hue is turned back into the family the name promises and the lightness
 * and saturation the formula produced are kept. It moves 1 colour in 8. It is
 * a correction, not a measurement, which is why the page says the swatch is
 * orientative and the colour is approved against a test panel.
 *
 * Reads and rewrites export/colour.csv, so it corrects exactly what ships.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, 'export', 'colour.csv');

/* The hue each family's name promises, as a band in degrees. Families that
 * name a lightness rather than a hue -- blanco, negro, plata, gris -- are not
 * here: a grey has no hue to correct, and 'otro' makes no claim at all.
 * marron is left out on purpose too. Brown is a dark, unsaturated orange, so
 * the band would catch every warm neutral the mix gets right. */
const BANDS = {
    rojo:     [345, 15],   // wraps through 0
    naranja:  [18, 45],
    amarillo: [45, 72],
    verde:    [80, 165],
    azul:     [185, 260],
    morado:   [265, 335],
};

// Below this there is no hue worth arguing about: the colour is a neutral,
// and a dark olive that mixed to near-grey is reporting something true.
const MIN_CHROMA = 0.12;

function toHsl(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    const d = mx - mn;
    if (!d) return { h: 0, s: 0, l };
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = mx === r ? 60 * (((g - b) / d) % 6)
          : mx === g ? 60 * ((b - r) / d + 2)
          :            60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
    return { h, s, l };
}

function toHex({ h, s, l }) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hp = h / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    const m = l - c / 2;
    const [r, g, b] =
          hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x]
        : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
    const byte = (v) => Math.max(0, Math.min(255, Math.round(255 * (v + m))))
        .toString(16).padStart(2, '0');
    return `#${byte(r)}${byte(g)}${byte(b)}`;
}

// Degrees between two hues, the short way round the circle.
function apart(a, b) {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
}

function inBand(h, [lo, hi]) {
    return lo <= hi ? h >= lo && h <= hi : h >= lo || h <= hi;
}

/* The nearest edge, not the middle of the band: a colour that is barely
 * outside should barely move. */
function intoBand(h, [lo, hi]) {
    return apart(h, lo) <= apart(h, hi) ? lo : hi;
}

function splitCsvLine(line) {
    const out = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (quoted) {
            if (ch === '"') {
                if (line[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
            } else field += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ',') { out.push(field); field = ''; }
        else field += ch;
    }
    out.push(field);
    return out;
}

function quote(v) {
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function main() {
    const text = fs.readFileSync(FILE, 'utf8');
    const lines = text.split('\n');
    const header = splitCsvLine(lines[0]);
    const iFamily = header.indexOf('family');
    const iHex = header.indexOf('hex');
    if (iFamily < 0 || iHex < 0) {
        throw new Error('export/colour.csv has no family or hex column');
    }

    let moved = 0;
    let total = 0;
    const byFamily = {};

    for (let i = 1; i < lines.length; i += 1) {
        if (!lines[i]) continue;
        const row = splitCsvLine(lines[i]);
        const band = BANDS[row[iFamily]];
        const hex = row[iHex];
        if (!band || !/^#[0-9a-f]{6}$/.test(hex)) continue;
        total += 1;
        const c = toHsl(hex);
        if (c.s < MIN_CHROMA || inBand(c.h, band)) continue;
        row[iHex] = toHex({ h: intoBand(c.h, band), s: c.s, l: c.l });
        lines[i] = row.map(quote).join(',');
        moved += 1;
        byFamily[row[iFamily]] = (byFamily[row[iFamily]] || 0) + 1;
    }

    fs.writeFileSync(FILE, lines.join('\n'));
    const pct = total ? (100 * moved / total).toFixed(1) : '0.0';
    console.log(`export/colour.csv: ${moved} of ${total} named colours turned back `
        + `into their own family (${pct}%)`);
    for (const f of Object.keys(byFamily).sort((a, b) => byFamily[b] - byFamily[a])) {
        console.log(`  ${f.padEnd(9)} ${byFamily[f]}`);
    }
}

main();
