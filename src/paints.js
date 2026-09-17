/* =========================================================================
   paints.js — the colour catalogue and the price list behind pgs/paintings.html

   Three things live here, and all three are read both by the page and by the
   server that mails the order out:

     COLOURS   the factory codes the shop can mix, by brand. The code and the
               name are what the customer reads on their vehicle's plate; the
               finish decides the price, and the hex is only for the swatch on
               screen — a screen cannot show a metallic, so it is a hint of the
               colour, never a proof of the match.
     SIZES     the six containers the shop sells, from a touch-up jar to a
               gallon, each with its volume in millilitres. The fractions are
               of a US gallon (3785.41 ml), which is the gallon the paint
               trade here measures in.
     PRICES    what each container costs, before the finish's surcharge. They
               are referential: the page says so, and the shop closes the
               price when it mixes the colour.

   THE CATALOGUE IS A STARTING POINT, NOT AN INVENTORY. It carries the codes
   the shop sees most, so the search has something to find on the day the page
   goes up; completing it is a matter of adding rows, and a code that is not
   here is not a dead end — the page sends whoever misses it to the digital
   reading or to the counter.

   Loads two ways, like src/parts.js: `window.AUTOCOLOR_PAINTS` for the page,
   `module.exports` for server/mail.js, which names the same containers and
   finishes in the order's email.
   ========================================================================= */

(function (root, factory) {
    "use strict";
    var api = factory();
    if (typeof module === "object" && module && module.exports) module.exports = api;
    else root.AUTOCOLOR_PAINTS = api;
})(typeof self !== "undefined" ? self : this, function () {
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
       Los colores, por marca.

       `code` es el de fábrica, tal como viene en la etiqueta del vehículo —
       en el marco de la puerta, bajo el capó o en la tapa del maletero—, y es
       lo único que identifica un color sin lugar a dudas: dos marcas usan el
       mismo «040» para dos blancos distintos, así que el código se busca
       siempre junto a su marca.

       `hex` es una aproximación para la muestra en pantalla. Un metálico o un
       perlado no se pueden enseñar en un rectángulo de color, y por eso la
       ficha del paso 1 lleva escrito que la muestra es referencial.
       --------------------------------------------------------------------- */
    var COLOURS = {
        toyota: [
            { code: "040", name: "Blanco Súper Puro",   finish: "solido",   hex: "#f2f3f2" },
            { code: "070", name: "Blanco Perlado",      finish: "tricapa",  hex: "#eceae4" },
            { code: "202", name: "Negro Ónix",          finish: "solido",   hex: "#15171a" },
            { code: "218", name: "Negro Atitude",       finish: "perlado",  hex: "#1b1d22" },
            { code: "1F7", name: "Plata Metálico",      finish: "metalico", hex: "#c6c9cd" },
            { code: "1G3", name: "Gris Magnético",      finish: "metalico", hex: "#6d7176" },
            { code: "3R3", name: "Rojo Barcelona",      finish: "metalico", hex: "#95121b" },
            { code: "8X8", name: "Azul Nebula",         finish: "metalico", hex: "#2c3b56" }
        ],
        chevrolet: [
            { code: "GAZ", name: "Blanco Summit",       finish: "solido",   hex: "#f1f2f1" },
            { code: "GBA", name: "Negro",               finish: "solido",   hex: "#141618" },
            { code: "GAN", name: "Plata Switchblade",   finish: "metalico", hex: "#b9bcc0" },
            { code: "GXD", name: "Gris Satin Steel",    finish: "metalico", hex: "#8d9196" },
            { code: "G7E", name: "Rojo Intenso",        finish: "metalico", hex: "#9c1119" }
        ],
        ford: [
            { code: "YZ",  name: "Blanco Oxford",       finish: "solido",   hex: "#f0f1ee" },
            { code: "UM",  name: "Negro Sombra",        finish: "solido",   hex: "#131518" },
            { code: "JS",  name: "Plata Ingot",         finish: "metalico", hex: "#b6b9bd" },
            { code: "J7",  name: "Gris Magnético",      finish: "metalico", hex: "#6b6f74" },
            { code: "RR",  name: "Rojo Race",           finish: "solido",   hex: "#a2131a" }
        ],
        subaru: [
            { code: "37J", name: "Blanco Cristal Perla", finish: "tricapa", hex: "#eeeeea" },
            { code: "K1X", name: "Negro Cristal Silica", finish: "perlado", hex: "#17191c" },
            { code: "G1U", name: "Plata Ice",            finish: "metalico", hex: "#c0c3c7" },
            { code: "M7Y", name: "Gris Magnetite",       finish: "metalico", hex: "#5f6469" }
        ],
        nissan: [
            { code: "QM1", name: "Blanco Perla",        finish: "tricapa",  hex: "#efeeea" },
            { code: "KH3", name: "Negro Súper",         finish: "solido",   hex: "#141517" },
            { code: "KAD", name: "Plata Gris",          finish: "metalico", hex: "#a9acb0" },
            { code: "K23", name: "Plata Brillante",     finish: "metalico", hex: "#c3c6ca" },
            { code: "NAH", name: "Rojo Cayenne",        finish: "perlado",  hex: "#8e1520" }
        ],
        bmw: [
            { code: "300", name: "Blanco Alpino",       finish: "solido",   hex: "#f2f3f3" },
            { code: "A96", name: "Blanco Mineral",      finish: "perlado",  hex: "#e9e9e6" },
            { code: "475", name: "Negro Zafiro",        finish: "metalico", hex: "#18191c" },
            { code: "B39", name: "Gris Mineral",        finish: "metalico", hex: "#7e8287" },
            { code: "C10", name: "Azul Portimao",       finish: "metalico", hex: "#2a4a7a" }
        ],
        audi: [
            { code: "LY9C", name: "Blanco Ibis",        finish: "solido",   hex: "#f3f4f2" },
            { code: "LY9B", name: "Negro Brillante",    finish: "solido",   hex: "#141517" },
            { code: "LX7R", name: "Plata Florett",      finish: "metalico", hex: "#b4b7bb" },
            { code: "LY7J", name: "Gris Daytona",       finish: "perlado",  hex: "#63676c" },
            { code: "LZ3F", name: "Rojo Tango",         finish: "metalico", hex: "#a11418" }
        ],
        mercedes: [
            { code: "149", name: "Blanco Polar",        finish: "solido",   hex: "#f2f3f2" },
            { code: "197", name: "Negro Obsidiana",     finish: "metalico", hex: "#151619" },
            { code: "744", name: "Plata Iridio",        finish: "metalico", hex: "#b1b4b8" },
            { code: "992", name: "Gris Selenita",       finish: "metalico", hex: "#75797e" }
        ],
        fiat: [
            { code: "249", name: "Blanco Banchisa",     finish: "solido",   hex: "#f1f2ef" },
            { code: "601", name: "Negro",               finish: "solido",   hex: "#141517" },
            { code: "693", name: "Gris Moda",           finish: "metalico", hex: "#83878c" },
            { code: "111", name: "Rojo Pasión",         finish: "solido",   hex: "#a5131a" }
        ],
        jeep: [
            { code: "PW7", name: "Blanco Brillante",    finish: "solido",   hex: "#f1f2f1" },
            { code: "PX8", name: "Negro Brillante",     finish: "solido",   hex: "#141517" },
            { code: "PSC", name: "Plata Billet",        finish: "metalico", hex: "#a8abaf" },
            { code: "PAU", name: "Gris Granite",        finish: "perlado",  hex: "#5c6065" },
            { code: "PRV", name: "Rojo Firecracker",    finish: "solido",   hex: "#a4151b" }
        ]
    };

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
            hex: colour.hex
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
        return null;
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

        brands: brands,
        coloursOf: coloursOf,
        findColour: findColour,
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
