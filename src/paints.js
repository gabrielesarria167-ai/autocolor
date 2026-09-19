/* =========================================================================
   paints.js — the colour catalogue and the price list behind pgs/paintings.html

   Three things live here, and all three are read both by the page and by the
   server that mails the order out:

     COLOURS   the factory codes, by brand, read from src/paintCatalog.js —
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
   are missing; a code that is not here is not a dead end — the page sends
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

    // Cómo se comporta la pintura, y cuánto encarece el matizado. Un sólido es
    // un color plano; un metálico lleva aluminio y un perlado mica, así que hay
    // que orientar las partículas al aplicarlo; un tricapa se pinta en tres
    // manos (base, perla y barniz) y es el que más producto y más tiempo pide.
    var FINISHES = {
        solido:   { label: "Sólido",   factor: 1,    note: "Color plano, de una sola capa." },
        metalico: { label: "Metálico", factor: 1.15, note: "Lleva aluminio: cambia con la luz." },
        perlado:  { label: "Perlado",  factor: 1.35, note: "Lleva mica: destella según el ángulo." },
        tricapa:  { label: "Tricapa",  factor: 1.6,  note: "Tres manos: base, perla y barniz." }
    };

    // Un galón estadounidense. Es el que usa el rubro aquí, y el que convierte
    // 1/4 en los 946 ml del envase que más se vende.
    var GALLON_ML = 3785.41;

    // Los seis envases. `use` es para qué alcanza cada uno — es lo que de
    // verdad decide la compra, más que el número de mililitros.
    var SIZES = [
        { id: "1_32", fraction: "1/32", label: "1/32 galón", price: 28,  use: "Retoques muy pequeños" },
        { id: "1_16", fraction: "1/16", label: "1/16 galón", price: 45,  use: "Una pieza chica (espejo, moldura)" },
        { id: "1_8",  fraction: "1/8",  label: "1/8 galón",  price: 72,  use: "Una o dos piezas pequeñas" },
        { id: "1_4",  fraction: "1/4",  label: "1/4 galón",  price: 118, use: "Varias piezas medianas" },
        { id: "1_2",  fraction: "1/2",  label: "1/2 galón",  price: 205, use: "Trabajo grande, varias piezas" },
        { id: "1_1",  fraction: "1",    label: "1 galón",    price: 360, use: "Pintado amplio o completo" }
    ];

    // Cuántos envases iguales admite un pedido. No es un límite del taller: es
    // el punto en el que un pedido deja de ser una compra y pasa a ser un
    // acuerdo que se conversa por teléfono, y la página lo dice así.
    var MAX_UNITS = 20;

    // El volumen de cada envase, calculado una vez. En mililitros hasta el
    // medio galón y en litros de ahí para arriba, que es como se lee mejor:
    // «946 ml» y «1.89 L», no «0.946 L» ni «3785 ml».
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

    // Los nombres de marca que enseña la página. Salen de aquí y no de
    // src/carModels.js porque el servidor también los necesita —para el correo
    // del pedido—, y aquel archivo describe vehículos, no pinturas.
    var BRAND_NAMES = {
        toyota: "Toyota", chevrolet: "Chevrolet", ford: "Ford", subaru: "Subaru",
        nissan: "Nissan", bmw: "BMW", audi: "Audi", mercedes: "Mercedes-Benz",
        fiat: "Fiat", jeep: "Jeep"
    };

    /* ---------------------------------------------------------------------
       Búsqueda por código

       Se compara sin mayúsculas, sin espacios y sin guiones: la etiqueta del
       vehículo escribe «1F7», «1f7» y «C/TR: 1F7-0» para el mismo color, y
       quien lo copia trae lo que tenga delante.
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
     * El color de un código, dentro de una marca.
     *
     * La marca es obligatoria a propósito: «040» es el blanco de Toyota y
     * también el negro de Mercedes-Benz, así que un código suelto no
     * identifica nada. Devuelve null cuando no está en el catálogo, que es un
     * caso normal y no un error: el catálogo no es el inventario del taller.
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
     * list the model at all — they only carry the colours with a
     * compatibility note, so even a list that exists can be short; the page
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

    /** Todos los colores de una marca, para enseñarlos cuando el código falla. */
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
       Lectura digital

       Un espectrofotómetro entrega el color en CIELAB: L* (claridad, 0–100),
       a* (verde–rojo) y b* (azul–amarillo). Para encontrar el más parecido del
       catálogo hay que llevar cada hex a ese mismo espacio y comparar
       distancias, que es lo que hacen las tres funciones de abajo.

       La diferencia se mide con ΔE*ab (CIE76): la distancia euclídea entre dos
       colores en Lab. Es la fórmula vieja —hay otras que corrigen mejor cómo
       ve el ojo— y es suficiente para lo que aquí se decide, que no es aprobar
       un matizado sino ordenar el catálogo y decir cuán cerca queda el primero.
       QUIEN APRUEBA EL COLOR ES LA PLANCHA DE PRUEBA, y la página lo dice en
       el paso 1.
       --------------------------------------------------------------------- */

    // sRGB (0–255) a lineal. El 2.4 y el 0.055 son la curva de sRGB, no una
    // gamma de 2.2 aproximada.
    function toLinear(channel) {
        var c = channel / 255;
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }

    // Blanco D65 a 2°, que es el iluminante con el que se miden los colores de
    // un vehículo y el que asume sRGB.
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
     * Los colores del catálogo más parecidos a una lectura, el más cercano
     * primero. `limit` recorta la lista; sin él vienen los tres primeros,
     * que es lo que cabe en la ficha del paso 1.
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
     * Cómo de cerca queda una coincidencia, en palabras. Los cortes son los
     * que usa el rubro: por debajo de 1 la diferencia no se ve, hasta 2 no se
     * ve en la pieza montada, y de ahí en adelante hay que ajustar la fórmula.
     */
    function matchQuality(delta) {
        if (delta < 1) return { level: "exact",  label: "Coincidencia exacta" };
        if (delta < 2) return { level: "close",  label: "Muy cercano" };
        if (delta < 5) return { level: "near",   label: "Aproximado" };
        return { level: "far", label: "Lejano" };
    }

    /* ---------------------------------------------------------------------
       Precio
       --------------------------------------------------------------------- */

    var soles = typeof Intl !== "undefined" && Intl.NumberFormat
        ? new Intl.NumberFormat("es-PE", { maximumFractionDigits: 0 })
        : null;

    /**
     * Lo que cuesta un envase de un acabado, en soles enteros. null cuando no
     * se reconoce el envase o el acabado, para que la página enseñe el pedido
     * sin precio antes que un total inventado.
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

        // «S/ 1,250», como los escribe el resto del sitio (ver src/parts.js).
        formatSoles: function (amount) {
            return "S/ " + (soles ? soles.format(amount) : String(amount));
        }
    };
});
