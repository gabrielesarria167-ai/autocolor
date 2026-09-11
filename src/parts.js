/* =========================================================================
   parts.js — the name each body panel goes by

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

    var has = Object.prototype.hasOwnProperty;

    return {
        LABELS: LABELS,

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
