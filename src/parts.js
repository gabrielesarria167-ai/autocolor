/* =========================================================================
   parts.js — the name each body panel goes by

   The keys are the GLB node names, exactly as they come out of the four
   models (see VEHICLE_MODELS in src/carVisual.js). One flat map serves all
   four because every id they share names the same panel on each. A name
   missing here degrades to the raw node name, so renaming a node in
   carVisual.js without renaming it here is a silent downgrade, not an error.

   It lives in its own file, and not inside the wizard that used to own it,
   because two pages pick panels now: the customer's wizard (src/repair.js)
   and the walk-in form in the workshop panel (src/staff.js). One copy each
   would drift, and the one that drifted would be the one nobody reads.

   Same shape as statuses.js, carModels.js and cities.js: a global on
   `window`, loaded before whatever needs it. The project has no modules to
   share this through.

   ---------------------------------------------------------------------------
   OJO: hay una tercera copia que no puede leer este archivo — la de
   server/mail.js, que nombra las piezas en los dos correos. Las dos tienen
   que decir lo mismo.
   ========================================================================= */

(function () {
    "use strict";

    var LABELS = {
        // Comunes a los cuatro modelos:
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

    window.AUTOCOLOR_PARTS = {
        LABELS: LABELS,

        // El id crudo antes que un hueco en blanco: si un modelo gana una
        // pieza y este archivo todavía no, es mejor leer «rear_hatch» que nada.
        label: function (id) {
            return LABELS[id] || id;
        }
    };
})();
