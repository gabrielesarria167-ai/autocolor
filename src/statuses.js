/* =========================================================================
   statuses.js: the status vocabulary of a request

   This is the only list on the client side. The code lookup (src/lookup.js)
   and the workshop panel (src/staff.js) read it from here instead of each
   carrying its own copy, which is how it used to be and how it drifts.

   It follows the pattern carModels.js and cities.js already use: a global on
   `window`, loaded before the script that needs it. The project uses no
   modules, so there is nowhere else to share this without inventing one.

   ---------------------------------------------------------------------------
   CAREFUL: two other copies cannot read this file, and all three have to say
   the same thing:

     - server/server.js  (STATUSES)  validates what comes in through PATCH
     - server/schema.sql (the CHECK on the `status` column) has the last word

   Adding a status touches four places: the two above, this file, and the
   migration that widens the CHECK on the existing database.
   ========================================================================= */

(function () {
    "use strict";

    // Between «recibido» and «listo» there is no longer a single "in the
    // workshop" status but the seven stages the job goes through inside the
    // shop. The order is the one the workshop gave when asking for them, so
    // the dropdown reads the way they name them there.
    var ORDER = [
        "recibido",
        "planchado",
        "desmontaje_montaje",
        "pintura",
        "preparacion",
        "cuadrada",
        "cristales",
        "finitura",
        "listo",
        "entregado",
        "cancelado"
    ];

    // What the customer sees when looking up their code, and what the panel's
    // pill carries. The four original statuses are feminine because the
    // subject is «la solicitud»; the seven workshop stages keep their own
    // name, a noun that agrees with nothing.
    var LABELS = {
        recibido: "Recibida",
        planchado: "Planchado",
        desmontaje_montaje: "Desmontaje y montaje",
        pintura: "Pintura",
        preparacion: "Preparación",
        cuadrada: "Cuadrada",
        cristales: "Cristales",
        finitura: "Finitura",
        listo: "Lista para recoger",
        entregado: "Entregada",
        cancelado: "Cancelada"
    };

    // The panel filters are shorter: in a row of twelve buttons, «Lista para
    // recoger» would take the width of three. The seven stages use the
    // abbreviation the workshop calls them by, which is also the one that fits.
    var FILTER_LABELS = {
        recibido: "Recibidas",
        planchado: "PL",
        desmontaje_montaje: "D/M",
        pintura: "PI",
        preparacion: "PRE",
        cuadrada: "CU",
        cristales: "CRI",
        finitura: "FI",
        listo: "Listas",
        entregado: "Entregadas",
        cancelado: "Canceladas"
    };

    // Paint orders (table `paint_orders`) have their own, shorter list: a can
    // is received, prepared, ready and handed over, without going through
    // panel beating or the oven. Its other copies are PAINT_STATUSES in
    // server/server.js and the CHECK on `paint_orders.status`. They are
    // masculine because the subject is «el pedido».
    var PAINT_ORDER = ["recibido", "preparacion", "listo", "entregado", "cancelado"];

    var PAINT_LABELS = {
        recibido: "Recibido",
        preparacion: "En preparación",
        listo: "Listo para recoger",
        entregado: "Entregado",
        cancelado: "Cancelado"
    };

    var PAINT_FILTER_LABELS = {
        recibido: "Recibidos",
        preparacion: "En preparación",
        listo: "Listos",
        entregado: "Entregados",
        cancelado: "Cancelados"
    };

    window.AUTOCOLOR_STATUSES = {
        ORDER: ORDER,
        LABELS: LABELS,
        FILTER_LABELS: FILTER_LABELS,
        PAINT_ORDER: PAINT_ORDER,
        PAINT_LABELS: PAINT_LABELS,
        PAINT_FILTER_LABELS: PAINT_FILTER_LABELS,

        // A status missing from the list shows raw rather than leaving a
        // blank: if the database gains a status before the client does,
        // «en_pintura» beats nothing.
        label: function (status) {
            return LABELS[status] || status;
        }
    };
})();
