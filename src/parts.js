/* =========================================================================
   parts.js — the name each body panel goes by, and what painting it costs

   The keys are the GLB node names, exactly as they come out of the four
   models (see VEHICLE_MODELS in src/carVisual.js). One flat map serves all
   four because every id they share names the same panel on each. A name
   missing here degrades to the raw node name, so renaming a node in
   carVisual.js without renaming it here is a silent downgrade, not an error.

   It lives in its own file, and not inside the wizard that used to own it,
   because three places name these panels: the customer's wizard
   (src/repair.js), the walk-in form in the workshop panel (src/staff.js) and
   the two emails (server/mail.js). One copy each would drift, and the one
   that drifted would be the one nobody reads — the email, which is the piece
   the customer keeps.

   Reaching all three means this file has to load two ways, so it exports
   twice: `window.AUTOCOLOR_PARTS` for the pages, which load it with a plain
   <script> like statuses.js, carModels.js and cities.js, and `module.exports`
   for the server, which requires it. Nothing else here depends on which of
   the two it got.
   ========================================================================= */

(function (root, factory) {
    "use strict";
    var api = factory();
    if (typeof module === "object" && module && module.exports) module.exports = api;
    else root.AUTOCOLOR_PARTS = api;
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    var LABELS = {
        // Shared by all four models:
        "hood": "Capó",
        "roof": "Techo",
        // Only-on-the-pickup:
        "front_bumper": "Parachoques delantero",
        "tonneau": "Platón y portón",
        // Only-on-the-SUV, which names its tailgate 'tailgate' where the
        // familiar says 'rear_hatch', and its rear bumper 'rear_bumper'
        // where the familiar says 'back_bumper':
        "tailgate": "Portón trasero",
        "rear_bumper": "Parachoques trasero",
        // Only-on-the-furgoneta (its sliding doors, and its own spelling of
        // the front fenders / rear quarter panels):
        "back_door_left": "Puerta corrediza izquierda",
        "back_door_right": "Puerta corrediza derecha",
        "left_fender": "Guardabarros delantero izquierdo",
        "right_fender": "Guardabarros delantero derecho",
        "rear_window_left": "Panel lateral trasero izquierdo",
        "rear_window_right": "Panel lateral trasero derecho",
        // Only-on-the-familiar:
        "back_bumper": "Parachoques trasero",
        "Object_26": "Moldura trasera del techo",
        // Shared by two or more models:
        "bumper": "Parachoques delantero",
        "front_door_left": "Puerta delantera izquierda",
        "front_door_right": "Puerta delantera derecha",
        "rear_door_left": "Puerta trasera izquierda",
        "rear_door_right": "Puerta trasera derecha",
        "fender_left": "Guardabarros delantero izquierdo",
        "fender_right": "Guardabarros delantero derecho",
        "quarter_panel_left": "Guardabarros trasero izquierdo",
        "quarter_panel_right": "Guardabarros trasero derecho",
        "side_skirt_left": "Faldón lateral izquierdo",
        "side_skirt_right": "Faldón lateral derecho",
        "rear_hatch": "Portón trasero"
    };

    // Which panels each vehicle offers, in the order the viewer declares them.
    // A copy of VEHICLE_MODELS[*].parts in src/carVisual.js, and it has to be:
    // the wizard's checklist (src/repair.js) is the way to pick parts when that
    // module, three.js or the model failed to load, or when the customer cannot
    // use a pointer, so it cannot read the list out of the module. The copy is
    // checked: tools/verify-3d.mjs fails when the two disagree.
    var BY_VEHICLE = {
        van: [
            "hood", "roof",
            "front_door_left", "front_door_right",
            "back_door_left", "back_door_right",
            "left_fender", "right_fender",
            "rear_window_left", "rear_window_right",
            "quarter_panel_left", "quarter_panel_right",
            "side_skirt_left", "side_skirt_right",
            "rear_hatch"
        ],
        wagon: [
            "hood", "roof",
            "front_door_left", "front_door_right",
            "rear_door_left", "rear_door_right",
            "fender_left", "fender_right",
            "quarter_panel_left", "quarter_panel_right",
            "side_skirt_left", "side_skirt_right",
            "rear_hatch",
            "bumper", "back_bumper",
            "Object_26"
        ],
        pickup: [
            "hood", "roof", "front_bumper",
            "front_door_left", "front_door_right",
            "rear_door_left", "rear_door_right",
            "fender_left", "fender_right",
            "tonneau"
        ],
        suv: [
            "hood", "roof",
            "front_door_left", "front_door_right",
            "rear_door_left", "rear_door_right",
            "fender_left", "fender_right",
            "quarter_panel_left", "quarter_panel_right",
            "side_skirt_left", "side_skirt_right",
            "tailgate",
            "bumper", "rear_bumper"
        ]
    };

    // What painting one panel costs, in soles, per finish (the `quality` ids
    // the wizard and server/server.js use: standard = Económico, premium =
    // Profesional, custom = Alta gama). The workshop prices by kind of panel,
    // not by model, so each row is a kind and PRICE_GROUP_OF files every node
    // name under one.
    var PRICES = {
        bumper_front: { label: "Parachoque delantero", standard: 250, premium: 300, custom: 400 },
        bumper_rear:  { label: "Parachoque posterior", standard: 250, premium: 300, custom: 400 },
        fender_front: { label: "Guardafango delantero", standard: 250, premium: 300, custom: 400 },
        fender_rear:  { label: "Guardafango posterior", standard: 250, premium: 300, custom: 400 },
        door:         { label: "Puerta", standard: 250, premium: 300, custom: 400 },
        hood:         { label: "Capó", standard: 350, premium: 400, custom: 550 },
        roof:         { label: "Techo", standard: 350, premium: 400, custom: 550 },
        trunk:        { label: "Maletera", standard: 300, premium: 350, custom: 450 },
        sill:         { label: "Estribo", standard: 250, premium: 300, custom: 400 }
    };

    // The workshop's price list names nine kinds of panel; the models name
    // twenty-six nodes. The ones that needed a call:
    //   - the van's rear_window_* are the body panels behind its sliding
    //     doors, which is where a car has its rear quarter panel;
    //   - the pickup's tonneau (bed and tailgate) and the SUV's tailgate are
    //     priced as the trunk, the rear opening of the other bodies;
    //   - the wagon's Object_26, the trim at the back of the roof, is not on
    //     the list; it takes the lowest row, like every other small panel.
    // tools/verify-3d.mjs fails when a part in BY_VEHICLE has no group here.
    var PRICE_GROUP_OF = {
        hood: "hood",
        roof: "roof",
        Object_26: "sill",
        bumper: "bumper_front",
        front_bumper: "bumper_front",
        back_bumper: "bumper_rear",
        rear_bumper: "bumper_rear",
        fender_left: "fender_front",
        fender_right: "fender_front",
        left_fender: "fender_front",
        right_fender: "fender_front",
        quarter_panel_left: "fender_rear",
        quarter_panel_right: "fender_rear",
        rear_window_left: "fender_rear",
        rear_window_right: "fender_rear",
        front_door_left: "door",
        front_door_right: "door",
        rear_door_left: "door",
        rear_door_right: "door",
        back_door_left: "door",
        back_door_right: "door",
        rear_hatch: "trunk",
        tailgate: "trunk",
        tonneau: "trunk",
        side_skirt_left: "sill",
        side_skirt_right: "sill"
    };

    // The multi-part discount, in percent, indexed by how many priced panels
    // the request has: none for one, then 5, 7 and 9, and 10 from five panels
    // up (the last step is the cap). It comes off the subtotal, not off each
    // panel, so the list keeps showing list prices. The home page spells the
    // steps out in its #acabados section, so a change here goes there too.
    var DISCOUNT_STEPS = [0, 0, 5, 7, 9, 10];

    function discountRate(count) {
        if (!(count > 0)) return 0;
        return DISCOUNT_STEPS[Math.min(count, DISCOUNT_STEPS.length - 1)];
    }

    var has = Object.prototype.hasOwnProperty;

    var QUALITY_NAMES = { standard: "Económico", premium: "Profesional", custom: "Alta gama" };
    var soles = typeof Intl !== "undefined" ? new Intl.NumberFormat("es-PE") : null;

    // The price of one panel at one finish, or null when either is unknown.
    // hasOwnProperty throughout for the reason given at label() below.
    function price(id, quality) {
        if (!has.call(PRICE_GROUP_OF, id)) return null;
        var row = PRICES[PRICE_GROUP_OF[id]];
        if (quality !== "standard" && quality !== "premium" && quality !== "custom") return null;
        return row[quality];
    }

    return {
        LABELS: LABELS,
        BY_VEHICLE: BY_VEHICLE,
        PRICES: PRICES,
        PRICE_GROUP_OF: PRICE_GROUP_OF,
        price: price,
        DISCOUNT_STEPS: DISCOUNT_STEPS,
        discountRate: discountRate,
        QUALITY_NAMES: QUALITY_NAMES,

        // «S/ 1,250»: soles the way Peru writes them.
        formatSoles: function (amount) {
            return "S/ " + (soles ? soles.format(amount) : String(amount));
        },

        // The line over the estimate: what one more panel would earn, or that
        // the cap is reached. Worded here so the wizard and the walk-in form
        // say it the same way. Empty for no panels.
        discountHint: function (count) {
            if (!(count > 0)) return "";
            var next = discountRate(count + 1);
            if (next === discountRate(count)) {
                return "Tienes el descuento máximo por varias piezas: " + next + "%.";
            }
            return count === 1
                ? "Pinta 2 piezas o más y te descontamos " + next + "%."
                : "Agrega 1 pieza más y el descuento sube a " + next + "%.";
        },

        // The sum of the priced panels, the discount their count earns (in
        // whole soles), and how many had no price: a total that silently
        // skipped a panel would read as the whole bill. Unpriced panels do not
        // count towards the discount either, since it comes off what they add.
        estimate: function (ids, quality) {
            var subtotal = 0;
            var priced = 0;
            var unpriced = 0;
            (ids || []).forEach(function (id) {
                var value = price(id, quality);
                if (value === null) unpriced++;
                else { subtotal += value; priced++; }
            });
            var rate = discountRate(priced);
            var discount = Math.round(subtotal * rate / 100);
            return {
                subtotal: subtotal,
                priced: priced,
                rate: rate,
                discount: discount,
                total: subtotal - discount,
                unpriced: unpriced
            };
        },

        // The raw id before a blank: if a model gains a panel and this file
        // has not caught up, reading «rear_hatch» beats reading nothing.
        //
        // hasOwnProperty and not `LABELS[id] || id`: without it, an `id` of
        // 'constructor' or 'toString' returns what the object inherits from
        // Object.prototype, and the workshop's email asked for a quote on
        // «function Object() { [native code] }». The ids travel through the
        // request body, so whoever sends one picks the `id` (PART_RE in
        // server/server.js accepts both of those words).
        label: function (id) {
            return has.call(LABELS, id) ? LABELS[id] : id;
        }
    };
});
