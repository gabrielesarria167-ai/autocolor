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

    // Entre «recibido» y «listo» ya no hay un solo estado de «en taller», sino
    // las siete etapas por las que pasa el trabajo dentro del local. El orden
    // es el que dio el taller al pedirlas, para que el desplegable se lea como
    // se nombran allí.
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

    // Lo que ve el cliente al consultar su código, y lo que lleva la píldora
    // del panel. Los cuatro estados de siempre van en femenino porque el sujeto
    // es «la solicitud»; las siete etapas del taller llevan su propio nombre,
    // que es un sustantivo y no concuerda con nada.
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

    // Los filtros del panel van más cortos: en una fila de doce botones,
    // «Lista para recoger» ocuparía el ancho de tres. Las siete etapas usan la
    // sigla con la que las nombra el taller, que es además la que cabe.
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
