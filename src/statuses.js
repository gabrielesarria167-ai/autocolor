/* =========================================================================
   statuses.js — el vocabulario de estados de una solicitud

   Es la única lista del lado del cliente. La consulta por código
   (src/lookup.js) y el panel del taller (src/staff.js) la leen de aquí en vez
   de llevar cada uno su copia, que es como estaba y como se desincroniza.

   Sigue el patrón que ya usan carModels.js y cities.js: un global en `window`,
   cargado antes que el script que lo necesita. El proyecto no usa módulos, así
   que no hay otro sitio donde compartir esto sin inventar uno nuevo.

   ---------------------------------------------------------------------------
   OJO: hay otras dos copias que no pueden leer este archivo, y las tres tienen
   que decir lo mismo:

     - server/server.js  (STATUSES)  valida lo que entra por PATCH
     - server/schema.sql (el CHECK de la columna `status`) es la última palabra

   Agregar un estado son cuatro sitios: los dos de arriba, este archivo, y la
   migración que amplíe el CHECK sobre la base que ya existe.
   ========================================================================= */

(function () {
    "use strict";

    // El orden es el del recorrido real de un trabajo, no alfabético: así se
    // lee el desplegable del taller como una línea de tiempo.
    var ORDER = ["recibido", "presupuestado", "en_taller", "listo", "entregado", "cancelado"];

    // Lo que ve el cliente al consultar su código, y lo que lleva la píldora
    // del panel. En femenino porque el sujeto es «la solicitud».
    var LABELS = {
        recibido: "Recibida",
        presupuestado: "Presupuestada",
        en_taller: "En el taller",
        listo: "Lista para recoger",
        entregado: "Entregada",
        cancelado: "Cancelada"
    };

    // Los filtros del panel van más cortos: en una fila de siete botones,
    // «Lista para recoger» ocuparía el ancho de tres.
    var FILTER_LABELS = {
        recibido: "Recibidas",
        presupuestado: "Presupuestadas",
        en_taller: "En taller",
        listo: "Listas",
        entregado: "Entregadas",
        cancelado: "Canceladas"
    };

    window.AUTOCOLOR_STATUSES = {
        ORDER: ORDER,
        LABELS: LABELS,
        FILTER_LABELS: FILTER_LABELS,

        // Un estado que no esté en la lista se muestra en crudo antes que
        // dejar el hueco en blanco: si la base gana un estado y el cliente
        // todavía no, es mejor ver «en_pintura» que nada.
        label: function (status) {
            return LABELS[status] || status;
        }
    };
})();
