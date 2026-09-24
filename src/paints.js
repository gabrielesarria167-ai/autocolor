/* =========================================================================
   paints.js: the colour catalogue and the price list behind pgs/paintings.html

   Three things live here, and all three are read both by the page and by the
   server that mails the order out:

     COLOURS   the factory codes, by brand, read from src/paintCatalog.js:
               the Sherwin-Williams colour guides turned into data by
               tools/paint-catalog/. The code and the name are what the
               customer reads on their vehicle's label; the finish decides the
               price, and the hex is only for the swatch on screen (sampled
               from a scanned chip, empty when there was none): a hint of the
               colour, never a proof of the match.
     SIZES     the six containers the shop sells, from a touch-up jar to a
               gallon, each with its volume in millilitres. The fractions are
               of a US gallon (3785.41 ml), which is the gallon the paint
               trade here measures in.
     PRICES    what each container costs, before the finish's surcharge. They
               are referential: the page says so, and the shop closes the
               price when it mixes the colour.

   THE CATALOGUE IS NOT AN INVENTORY. It covers the US-market guides up to
   model year 2018, so newer colours and the models sold only in South America
   are missing. A code that is not here is not a dead end: the page sends
   whoever misses it to the digital reading or to the counter.

   Loads two ways, like src/parts.js: `window.AUTOCOLOR_PAINTS` for the page
   (after src/paintCatalog.js), `module.exports` for server/mail.js, which
   names the same containers and finishes in the order's email.
   ========================================================================= */

(function (root, factory) {
    "use strict";
    var isNode = typeof module === "object" && module && module.exports;
    var catalog = isNode ? require("./paintCatalog.js") : root.AUTOCOLOR_PAINT_CATALOG;
    var api = factory(catalog || { colours: {}, models: {} });
    if (typeof module === "object" && module && module.exports) module.exports = api;
    else root.AUTOCOLOR_PAINTS = api;
})(typeof self !== "undefined" ? self : this, function (CATALOG) {
    "use strict";

    var has = Object.prototype.hasOwnProperty;

    // How the paint behaves, and how much it adds to the matizado. A solid is
    // a flat colour; a metallic carries aluminium and a pearl carries mica, so
    // the particles have to be oriented as it goes on; a tri-coat is sprayed
    // in three coats (base, pearl and clear) and asks for the most product
    // and the most time.
    var FINISHES = {
        solido:   { label: "Sólido",   factor: 1,    note: "Color plano, de una sola capa." },
        metalico: { label: "Metálico", factor: 1.15, note: "Lleva aluminio: cambia con la luz." },
        perlado:  { label: "Perlado",  factor: 1.35, note: "Lleva mica: destella según el ángulo." },
        tricapa:  { label: "Tricapa",  factor: 1.6,  note: "Tres manos: base, perla y barniz." }
    };

    // A US gallon. It is the one the trade uses here, and the one that turns
    // 1/4 into the 946 ml of the best-selling container.
    var GALLON_ML = 3785.41;

    // The six containers. `use` says what each one covers, which is what
    // really decides the purchase, more than the millilitres.
    var SIZES = [
        { id: "1_32", fraction: "1/32", label: "1/32 galón", price: 28,  use: "Retoques muy pequeños" },
        { id: "1_16", fraction: "1/16", label: "1/16 galón", price: 45,  use: "Una pieza chica (espejo, moldura)" },
        { id: "1_8",  fraction: "1/8",  label: "1/8 galón",  price: 72,  use: "Una o dos piezas pequeñas" },
        { id: "1_4",  fraction: "1/4",  label: "1/4 galón",  price: 118, use: "Varias piezas medianas" },
        { id: "1_2",  fraction: "1/2",  label: "1/2 galón",  price: 205, use: "Trabajo grande, varias piezas" },
        { id: "1_1",  fraction: "1",    label: "1 galón",    price: 360, use: "Pintado amplio o completo" }
    ];

    // How many identical containers an order accepts. It is not a workshop
    // limit: it is the point where an order stops being a purchase and
    // becomes a deal agreed over the phone, and the page says so.
    var MAX_UNITS = 20;

    // Each container's volume, worked out once. In millilitres up to half a
    // gallon and in litres from there up, which reads best: «946 ml» and
    // «1.89 L», not «0.946 L» or «3785 ml».
    SIZES.forEach(function (size) {
        var parts = size.fraction.split("/");
        var value = parts.length === 2 ? Number(parts[0]) / Number(parts[1]) : Number(parts[0]);
        size.gallons = value;
        size.ml = Math.round(GALLON_ML * value);
        size.volume = size.ml >= 1000
            ? (size.ml / 1000).toFixed(2).replace(/0$/, "") + " L"
            : size.ml + " ml";
    });

    var SIZE_BY_ID = {};
    SIZES.forEach(function (size) { SIZE_BY_ID[size.id] = size; });

    /* ---------------------------------------------------------------------
       The colours, by brand.

       `code` is the factory one, as printed on the vehicle's label, and it
       only identifies a colour together with its brand: Toyota's "040" is a
       white and Mercedes-Benz's "040" a black. `alt` holds the other codes
       the same paint goes by (GM prints "GAZ", "8624" and "WA8624" for one
       white; Chrysler a P- and a second-letter code). `years` is the span of
       model years the guides saw it in, and `family` the colour group the
       finder filters by.
       --------------------------------------------------------------------- */
    var COLOURS = {};
    Object.keys(CATALOG.colours || {}).forEach(function (brandId) {
        COLOURS[brandId] = CATALOG.colours[brandId].map(function (row) {
            return {
                code: row[0], name: row[1], finish: row[2], hex: row[3] || null,
                years: [row[4], row[5]], family: row[6], alt: row[7] || []
            };
        });
    });

    // Colour groups for the finder's filter, in the order they are offered.
    var FAMILIES = [
        { id: "blanco", label: "Blancos" }, { id: "negro", label: "Negros" },
        { id: "plata", label: "Platas" }, { id: "gris", label: "Grises" },
        { id: "rojo", label: "Rojos" }, { id: "azul", label: "Azules" },
        { id: "verde", label: "Verdes" }, { id: "marron", label: "Marrones y beiges" },
        { id: "amarillo", label: "Amarillos y dorados" }, { id: "naranja", label: "Naranjas" },
        { id: "morado", label: "Morados" }, { id: "otro", label: "Otros" }
    ];

    // The brand names the page shows. They come from here and not from
    // src/carModels.js because the server needs them too (for the order
    // email), and that file describes vehicles, not paints.
    var BRAND_NAMES = {
        toyota: "Toyota", chevrolet: "Chevrolet", ford: "Ford", subaru: "Subaru",
        nissan: "Nissan", bmw: "BMW", audi: "Audi", mercedes: "Mercedes-Benz",
        fiat: "Fiat", jeep: "Jeep"
    };

    /* ---------------------------------------------------------------------
       Search by code

       Compared without case, spaces or dashes: the vehicle label writes
       «1F7», «1f7» and «C/TR: 1F7-0» for the same colour, and whoever copies
       it brings whatever is in front of them.
       --------------------------------------------------------------------- */
    function normalizeCode(value) {
        return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    }

    function withBrand(brandId, colour) {
        return {
            brandId: brandId,
            brand: has.call(BRAND_NAMES, brandId) ? BRAND_NAMES[brandId] : brandId,
            code: colour.code,
            name: colour.name,
            finish: colour.finish,
            hex: colour.hex,
            years: colour.years,
            family: colour.family,
            alt: colour.alt
        };
    }

    /**
     * The colour for a code, within a brand.
     *
     * The brand is mandatory on purpose: «040» is Toyota's white and also
     * Mercedes-Benz's black, so a bare code identifies nothing. Returns null
     * when it is not in the catalogue, which is a normal case and not an
     * error: the catalogue is not the workshop's inventory.
     */
    function findColour(brandId, code) {
        var list = has.call(COLOURS, brandId) ? COLOURS[brandId] : null;
        if (!list) return null;
        var wanted = normalizeCode(code);
        if (!wanted) return null;
        for (var i = 0; i < list.length; i++) {
            if (normalizeCode(list[i].code) === wanted) return withBrand(brandId, list[i]);
        }
        // Then the other codes the same paint goes by: whoever copies "GAZ"
        // off a Chevrolet label is asking for the same white as "8624".
        for (var j = 0; j < list.length; j++) {
            for (var k = 0; k < list[j].alt.length; k++) {
                if (normalizeCode(list[j].alt[k]) === wanted) return withBrand(brandId, list[j]);
            }
        }
        return null;
    }

    /**
     * The colours a model wore, newest first, each with the model years it
     * was offered on that model (`modelYears`). null when the guides do not
     * list the model at all. They only carry the colours with a
     * says so and offers the brand's colours of that year too.
     */
    function modelColours(brandId, modelId) {
        var models = (CATALOG.models || {})[brandId];
        var rows = models && has.call(models, modelId) ? models[modelId] : null;
        if (!rows || rows.length === 0) return null;
        var out = [];
        rows.forEach(function (row) {
            var colour = findColour(brandId, row[0]);
            if (!colour) return;
            colour.modelYears = [row[1], row[2]];
            out.push(colour);
        });
        return out.length ? out : null;
    }

    /** The span of model years the catalogue covers, for the page to say so. */
    function coverage() {
        var min = Infinity, max = -Infinity;
        Object.keys(COLOURS).forEach(function (brandId) {
            COLOURS[brandId].forEach(function (c) {
                if (c.years[0] < min) min = c.years[0];
                if (c.years[1] > max) max = c.years[1];
            });
        });
        return { from: min, to: max };
    }

    /** Every colour of a brand, to show them when the code misses. */
    function coloursOf(brandId) {
        var list = has.call(COLOURS, brandId) ? COLOURS[brandId] : [];
        return list.map(function (colour) { return withBrand(brandId, colour); });
    }

    function brands() {
        return Object.keys(COLOURS).map(function (id) {
            return { id: id, name: BRAND_NAMES[id], count: COLOURS[id].length };
        });
    }

    /* ---------------------------------------------------------------------
       Digital reading

       A spectrophotometer gives the colour in CIELAB: L* (lightness, 0 to
       100), a* (green to red) and b* (blue to yellow). To find the closest
       one in the catalogue, each hex has to be taken to that same space and
       the distances compared, which is what the three functions below do.

       The difference is measured with ΔE*ab (CIE76): the Euclidean distance
       between two colours in Lab. It is the old formula (others model the
       eye better) and it is enough for what is decided here, which is not
       approving a matizado but ordering the catalogue and saying how close
       the first one lands. THE TEST PANEL IS WHAT APPROVES THE COLOUR, and
       the page says so in step 1.
       --------------------------------------------------------------------- */

    // sRGB (0 to 255) to linear. The 2.4 and the 0.055 are the sRGB curve,
    // not an approximate 2.2 gamma.
    function toLinear(channel) {
        var c = channel / 255;
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }

    // D65 white at 2°, the illuminant vehicle colours are measured under and
    // the one sRGB assumes.
    var WHITE = { x: 95.047, y: 100.0, z: 108.883 };

    function hexToLab(hex) {
        var clean = String(hex || "").replace("#", "");
        if (clean.length !== 6) return null;
        var r = toLinear(parseInt(clean.slice(0, 2), 16));
        var g = toLinear(parseInt(clean.slice(2, 4), 16));
        var b = toLinear(parseInt(clean.slice(4, 6), 16));

        var x = (r * 0.4124 + g * 0.3576 + b * 0.1805) * 100;
        var y = (r * 0.2126 + g * 0.7152 + b * 0.0722) * 100;
        var z = (r * 0.0193 + g * 0.1192 + b * 0.9505) * 100;

        var f = function (t) {
            return t > 0.008856 ? Math.pow(t, 1 / 3) : (7.787 * t) + (16 / 116);
        };
        var fx = f(x / WHITE.x);
        var fy = f(y / WHITE.y);
        var fz = f(z / WHITE.z);

        return { L: (116 * fy) - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
    }

    function deltaE(first, second) {
        var dL = first.L - second.L;
        var da = first.a - second.a;
        var db = first.b - second.b;
        return Math.sqrt(dL * dL + da * da + db * db);
    }

    /**
     * The catalogue colours closest to a reading, nearest first. `limit`
     * trims the list; without it the first three come back, which is what
     * fits on the step 1 card.
     */
    function nearest(reading, limit) {
        var matches = [];
        Object.keys(COLOURS).forEach(function (brandId) {
            COLOURS[brandId].forEach(function (colour) {
                var lab = hexToLab(colour.hex);
                if (!lab) return;
                var match = withBrand(brandId, colour);
                match.delta = deltaE(reading, lab);
                matches.push(match);
            });
        });
        matches.sort(function (a, b) { return a.delta - b.delta; });
        return matches.slice(0, limit || 3);
    }

    /**
     * How close a match lands, in words. The cut-offs are the trade's: below
     * 1 the difference cannot be seen, up to 2 it cannot be seen on the
     * mounted panel, and from there on the formula needs adjusting.
     */
    function matchQuality(delta) {
        if (delta < 1) return { level: "exact",  label: "Coincidencia exacta" };
        if (delta < 2) return { level: "close",  label: "Muy cercano" };
        if (delta < 5) return { level: "near",   label: "Aproximado" };
        return { level: "far", label: "Lejano" };
    }

    /* ---------------------------------------------------------------------
       Price
       --------------------------------------------------------------------- */

    var soles = typeof Intl !== "undefined" && Intl.NumberFormat
        ? new Intl.NumberFormat("es-PE", { maximumFractionDigits: 0 })
        : null;

    /**
     * What one container of a finish costs, in whole soles. null when the
     * container or the finish is not recognised, so the page shows the order
     * without a price rather than an invented total.
     */
    function price(sizeId, finish) {
        if (!has.call(SIZE_BY_ID, sizeId)) return null;
        if (!has.call(FINISHES, finish)) return null;
        return Math.round(SIZE_BY_ID[sizeId].price * FINISHES[finish].factor);
    }

    return {
        FINISHES: FINISHES,
        SIZES: SIZES,
        MAX_UNITS: MAX_UNITS,
        GALLON_ML: GALLON_ML,
        COLOURS: COLOURS,
        BRAND_NAMES: BRAND_NAMES,

        FAMILIES: FAMILIES,

        brands: brands,
        coloursOf: coloursOf,
        findColour: findColour,
        modelColours: modelColours,
        coverage: coverage,
        normalizeCode: normalizeCode,

        hexToLab: hexToLab,
        deltaE: deltaE,
        nearest: nearest,
        matchQuality: matchQuality,

        price: price,
        size: function (id) { return has.call(SIZE_BY_ID, id) ? SIZE_BY_ID[id] : null; },
        finishLabel: function (id) { return has.call(FINISHES, id) ? FINISHES[id].label : id; },
        brandName: function (id) { return has.call(BRAND_NAMES, id) ? BRAND_NAMES[id] : id; },

        // «S/ 1,250», the way the rest of the site writes it (see src/parts.js).
        formatSoles: function (amount) {
            return "S/ " + (soles ? soles.format(amount) : String(amount));
        }
    };
});
