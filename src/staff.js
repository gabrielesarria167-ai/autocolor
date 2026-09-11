/* =========================================================================
   staff.js — panel del taller (pgs/taller.html)

   Lista las solicitudes que entraron por el asistente y deja cambiarles el
   estado, que es lo que antes se hacía a mano en psql.

   Nada de lo que hay aquí protege los datos: la contraseña se comprueba en el
   servidor (server/auth.js) y esta página solo reacciona a lo que responda.
   Un 401 significa «no hay sesión» y saca el formulario de acceso; el listado
   nunca llega al navegador sin la cookie.
   ========================================================================= */

(function () {
    "use strict";

    var app = document.getElementById("staffApp");
    if (!app) return;

    var loadingEl = document.getElementById("staffLoading");
    var loginEl = document.getElementById("staffLogin");
    var loginForm = document.getElementById("staffLoginForm");
    var workerIdInput = document.getElementById("staffWorkerId");
    var passwordInput = document.getElementById("staffPassword");
    var loginSubmit = document.getElementById("staffLoginSubmit");
    var panelEl = document.getElementById("staffPanel");
    var searchEl = document.getElementById("staffSearch");
    var filtersEl = document.getElementById("staffFilters");
    var logoutBtn = document.getElementById("staffLogout");
    var clockEl = document.getElementById("staffClock");
    var rowsEl = document.getElementById("staffRows");
    var countEl = document.getElementById("staffCount");
    var emptyEl = document.getElementById("staffEmpty");
    var errorEl = document.getElementById("staffError");
    var profileEl = document.getElementById("staffProfile");
    var profilePhotoEl = document.getElementById("staffProfilePhoto");
    var profileMainEl = document.getElementById("staffProfileMain");
    var profileNameEl = document.getElementById("staffProfileName");
    var profileCodeEl = document.getElementById("staffProfileCode");
    var notesEl = document.getElementById("staffNotes");
    var notesHintEl = document.getElementById("staffNotesHint");
    var profileRoleEl = document.getElementById("staffProfileRole");
    var profileEnterBtn = document.getElementById("staffProfileEnter");
    var profileMonitorBtn = document.getElementById("staffProfileMonitor");
    var profileBrowseBtn = document.getElementById("staffProfileBrowse");
    var monitorEl = document.getElementById("staffMonitor");
    var monitorListEl = document.getElementById("staffMonitorList");
    var monitorCountEl = document.getElementById("staffMonitorCount");
    var monitorEmptyEl = document.getElementById("staffMonitorEmpty");
    var monitorRefreshBtn = document.getElementById("staffMonitorRefresh");
    var readOnlyEl = document.getElementById("staffReadOnly");
    var readOnlyTextEl = document.getElementById("staffReadOnlyText");
    var readOnlyEnterBtn = document.getElementById("staffReadOnlyEnter");
    var noteEl = document.getElementById("staffNote");

    // Vacío es el mismo origen. El panel solo funciona contra el servidor Node
    // que tiene la base al lado; en una publicación estática (GitHub Pages) no
    // hay API y la primera consulta lo dirá.
    var API_BASE = window.AUTOCOLOR_API_BASE || "";
    var API_MISSING_STATUS = [404, 405, 501];
    var API_MISSING_MESSAGE = "Este sitio se publicó sin la API detrás, así que el panel no tiene de dónde leer.";
    var NETWORK_MESSAGE = "No pudimos conectar con el servidor. Revisa que esté encendido.";

    // Los estados, su orden y sus etiquetas viven en src/statuses.js, que esta
    // página carga antes que este archivo. Son los mismos que admite la
    // columna `status` de la tabla (ver server/schema.sql).
    var STATUS_LABELS = window.AUTOCOLOR_STATUSES.LABELS;
    var STATUS_ORDER = window.AUTOCOLOR_STATUSES.ORDER;
    var FILTER_LABELS = window.AUTOCOLOR_STATUSES.FILTER_LABELS;

    var QUALITY_LABELS = {
        standard: "Económico",
        premium: "Profesional",
        custom: "Alta gama"
    };

    // Lo último que devolvió el servidor, ya filtrado por estado. El buscador
    // sí recorta sobre esto sin volver a preguntar: son como mucho 200 filas ya
    // en memoria, y un viaje al servidor por cada tecla sería peor de todas las
    // formas.
    var allRequests = [];
    var statusFilter = "";
    var searchTerm = "";
    // «Mis vehículos»: recorta a los que tiene ocupados quien está mirando.
    var mineOnly = false;
    var mineBtn = null;

    // Quién entró: lo manda el servidor con el listado (ver /api/staff/requests).
    // Con esto se decide qué filas puede tocar —una ocupada solo la mueve quien
    // la tiene—, pero es solo para la interfaz: la regla de verdad la aplica el
    // servidor, que no se fía de lo que diga el navegador.
    //
    // `isBoss` arrives with the listing and only decides which profile gets
    // painted: the boss gets the monitor where everybody else has «Iniciar
    // sesión». Who may ask for the monitor — and who may take a vehicle — is
    // decided by the server (see requireBoss and refuseBoss in
    // server/server.js), which does not trust any of this.
    var viewer = { workerId: "", name: "", isBoss: false };

    // What is on screen: the login, the worker's profile, the table, or — for
    // the boss only — the monitor. loadRequests brings the data, but does not
    // decide this.
    var view = "login";

    // Se entró a mirar —«Ver solicitudes» en la ficha— y no a trabajar: la
    // tabla se pinta entera pero sin un solo control.
    //
    // Es la interfaz y nada más. El servidor no sabe de estos dos modos: para
    // él hay una sesión, y con ella se puede tomar un vehículo y moverle el
    // estado. Así que esto no encierra a nadie —quien entró a mirar podría
    // cambiar cosas por su cuenta desde la consola—; es la elección de quien
    // entra, no una barrera. Lo que sí impide el servidor es tocar lo que
    // tiene otro (ver server/db.js), y eso vale en los dos modos.
    var readOnly = false;

    /* ---------------------------------------------------------------------
       Reloj

       Solo aparece con el panel a la vista, para que el trabajador tenga a
       mano la hora y sepa cuándo cerrar el turno. No es un cronómetro de
       nada: es la hora del reloj, que se refresca cada segundo.
    --------------------------------------------------------------------- */

    var clockTimer = null;

    function paintClock() {
        // Se arma a mano en vez de toLocaleTimeString: el locale es-PE devuelve
        // «08:15:49 p. m.» —minúsculas, con puntos y espacio—, y aquí se quiere
        // «08:15:49 PM», con AM/PM en mayúsculas y sin puntos.
        var now = new Date();
        var hours = now.getHours();
        var suffix = hours >= 12 ? "PM" : "AM";
        hours = hours % 12;
        if (hours === 0) hours = 12;
        clockEl.textContent = pad(hours) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds()) + " " + suffix;
    }

    function pad(n) {
        return n < 10 ? "0" + n : String(n);
    }

    function startClock() {
        if (clockTimer) return;
        paintClock();
        show(clockEl, true);
        clockTimer = window.setInterval(paintClock, 1000);
    }

    function stopClock() {
        if (clockTimer) {
            window.clearInterval(clockTimer);
            clockTimer = null;
        }
        show(clockEl, false);
    }

    function setError(message) {
        errorEl.textContent = message || "";
        errorEl.hidden = !message;
    }

    function show(el, visible) {
        el.hidden = !visible;
    }

    function formatDate(iso) {
        var date = new Date(iso);
        if (isNaN(date.getTime())) return "";
        return date.toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" });
    }

    function cell(row, text, className) {
        var td = document.createElement("td");
        // textContent y no innerHTML: marca, modelo y nombre los escribió el
        // cliente en el asistente, y aquí se muestran tal cual.
        td.textContent = text == null || text === "" ? "—" : text;
        if (className) td.className = className;
        row.appendChild(td);
        return td;
    }

    /* ---------------------------------------------------------------------
       Filtros y buscador
    --------------------------------------------------------------------- */

    // Un filtro que no es de estado: recorta por quién tiene el vehículo, no
    // por la etapa del trabajo. Por eso es un interruptor aparte y no una
    // opción más del grupo —se combinan: «los míos, en pintura»—, y por eso va
    // al principio de la fila, con su raya y su propio color al encenderse.
    function buildMineFilter() {
        mineBtn = document.createElement("button");
        mineBtn.type = "button";
        mineBtn.className = "staff-chip staff-chip--mine";
        mineBtn.setAttribute("aria-pressed", "false");

        var icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        icon.setAttribute("viewBox", "0 0 24 24");
        icon.setAttribute("fill", "none");
        icon.setAttribute("stroke", "currentColor");
        icon.setAttribute("stroke-width", "2");
        icon.setAttribute("stroke-linecap", "round");
        icon.setAttribute("stroke-linejoin", "round");
        icon.setAttribute("aria-hidden", "true");
        var head = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        head.setAttribute("cx", "12");
        head.setAttribute("cy", "8.5");
        head.setAttribute("r", "3.5");
        var body = document.createElementNS("http://www.w3.org/2000/svg", "path");
        body.setAttribute("d", "M5 20c0-3.31 3.13-5.5 7-5.5s7 2.19 7 5.5");
        icon.appendChild(head);
        icon.appendChild(body);

        mineBtn.appendChild(icon);
        mineBtn.appendChild(document.createTextNode("Mis vehículos"));

        mineBtn.addEventListener("click", function () {
            mineOnly = !mineOnly;
            mineBtn.setAttribute("aria-pressed", String(mineOnly));
            // Se recorta sobre lo que ya está en memoria, como hace el
            // buscador: quién ocupa cada solicitud viene en la propia fila, así
            // que no hay nada que volver a preguntarle al servidor.
            applySearch();
        });

        filtersEl.appendChild(mineBtn);
    }

    function buildFilters() {
        buildMineFilter();

        var choices = [{ value: "", label: "Todas" }];
        STATUS_ORDER.forEach(function (value) {
            choices.push({ value: value, label: FILTER_LABELS[value] || STATUS_LABELS[value] });
        });

        choices.forEach(function (choice) {
            var button = document.createElement("button");
            button.type = "button";
            button.className = "staff-chip";
            button.textContent = choice.label;
            // aria-pressed y no una clase «activo»: son botones que alternan, y
            // así el lector de pantalla anuncia cuál está puesto.
            button.setAttribute("aria-pressed", String(choice.value === statusFilter));
            button.addEventListener("click", function () {
                if (statusFilter === choice.value) return;
                statusFilter = choice.value;
                syncFilters();
                // El estado lo filtra el servidor y no esta función: la
                // consulta trae como mucho 200 filas, así que recortar aquí
                // dejaría fuera las canceladas viejas que sí caben en una
                // consulta pedida solo de canceladas.
                loadRequests();
            });
            button.dataset.value = choice.value;
            filtersEl.appendChild(button);
        });
    }

    function syncFilters() {
        // Solo los de estado: el de «Mis vehículos» no lleva data-value y se
        // enciende por su cuenta.
        var buttons = filtersEl.querySelectorAll(".staff-chip[data-value]");
        Array.prototype.forEach.call(buttons, function (button) {
            button.setAttribute("aria-pressed", String(button.dataset.value === statusFilter));
        });
    }

    // El texto sobre el que busca el buscador. Se arma una vez por fila, al
    // recibirla del servidor (ver loadRequests), y no en cada tecla.
    function haystack(request) {
        return [
            request.id,
            request.plate,
            request.firstName,
            request.lastName,
            request.brand,
            request.model,
            request.phone
        ].filter(Boolean).join(" ").toLowerCase();
    }

    /* ---------------------------------------------------------------------
       Cambiar el estado: píldora con su propio desplegable

       El <select> nativo no deja pintar sus opciones, y aquí la lista
       coloreada es la mitad de para qué sirve. A cambio hay que reponer a
       mano lo que el nativo daba gratis: cerrar al hacer clic fuera, cerrar
       con Escape, moverse con las flechas y devolver el foco al cerrar.
    --------------------------------------------------------------------- */

    // Solo puede haber un menú abierto. Se guarda el de turno para poder
    // cerrarlo desde los escuchas globales de más abajo.
    var openMenu = null;

    function closeMenu(returnFocus) {
        if (!openMenu) return;
        var pill = openMenu.pill;
        openMenu.menu.hidden = true;
        pill.setAttribute("aria-expanded", "false");
        openMenu = null;
        if (returnFocus) pill.focus();
    }

    // El menú es `fixed` (ver styles.css): se escapa así del recorte del
    // contenedor que hace scroll horizontal, pero la posición hay que
    // calcularla, y se recalcula cada vez porque la fila pudo haberse movido.
    function placeMenu(pill, menu) {
        var box = pill.getBoundingClientRect();
        var margin = 8;

        var top = box.bottom + 4;
        // Si abajo no cabe, se abre hacia arriba: en las últimas filas de una
        // lista larga es lo normal.
        if (top + menu.offsetHeight > window.innerHeight - margin) {
            top = Math.max(margin, box.top - menu.offsetHeight - 4);
        }

        var left = box.left;
        if (left + menu.offsetWidth > window.innerWidth - margin) {
            left = Math.max(margin, window.innerWidth - menu.offsetWidth - margin);
        }

        menu.style.top = top + "px";
        menu.style.left = left + "px";
    }

    function buildStatusCell(row, request, editable) {
        var td = document.createElement("td");

        var wrap = document.createElement("span");
        wrap.className = "staff-status";
        wrap.dataset.status = request.status;

        /* --- la píldora --- */
        var pill = document.createElement("button");
        pill.type = "button";
        pill.className = "staff-status__pill";
        pill.setAttribute("aria-haspopup", "listbox");
        pill.setAttribute("aria-expanded", "false");
        pill.setAttribute("aria-label", "Estado de la solicitud " + request.id);

        // Un vehículo ocupado por otro no se toca: la píldora queda inerte. Es
        // solo comodidad —el servidor rechaza el cambio igual (403)—, pero
        // evita el clic que no iba a ninguna parte. Un botón deshabilitado no
        // recibe clic ni teclas, así que no hace falta guardar cada escucha.
        if (!editable) {
            pill.disabled = true;
            pill.classList.add("staff-status__pill--locked");
            // Por qué no se puede: se entró solo a mirar, o —con la sesión
            // iniciada— está libre y hay que tomarlo, o lo tiene otro.
            pill.title = readOnly
                ? "Inicia sesión para cambiar el estado"
                : request.occupiedBy
                    ? "Lo tiene " + (request.occupiedName || "otro trabajador")
                    : "Toma el vehículo para cambiarle el estado";
        }

        var dot = document.createElement("span");
        dot.className = "staff-status__dot";

        var label = document.createElement("span");
        label.textContent = STATUS_LABELS[request.status] || request.status;

        var caret = document.createElement("span");
        caret.className = "staff-status__caret";

        pill.appendChild(dot);
        pill.appendChild(label);
        pill.appendChild(caret);

        /* --- el menú --- */
        var menu = document.createElement("div");
        menu.className = "staff-status__menu";
        menu.setAttribute("role", "listbox");
        menu.hidden = true;

        STATUS_ORDER.forEach(function (value) {
            var option = document.createElement("button");
            option.type = "button";
            option.className = "staff-status__option";
            option.setAttribute("role", "option");
            option.dataset.status = value;
            option.setAttribute("aria-selected", String(value === request.status));

            var optionDot = document.createElement("span");
            optionDot.className = "staff-status__dot";
            option.appendChild(optionDot);
            option.appendChild(document.createTextNode(STATUS_LABELS[value]));

            option.addEventListener("click", function () {
                closeMenu(true);
                choose(value);
            });

            menu.appendChild(option);
        });

        function options() {
            return menu.querySelectorAll(".staff-status__option");
        }

        function open() {
            closeMenu(false);          // el que hubiera abierto en otra fila
            menu.hidden = false;        // visible antes de medirlo
            placeMenu(pill, menu);
            pill.setAttribute("aria-expanded", "true");
            openMenu = { pill: pill, menu: menu, move: move };

            // El foco arranca en el estado actual, que es desde donde uno se
            // mueve con las flechas.
            var current = menu.querySelector('[aria-selected="true"]');
            (current || options()[0]).focus();
        }

        // Flechas dentro del menú, con vuelta circular.
        function move(step) {
            var list = Array.prototype.slice.call(options());
            var index = list.indexOf(document.activeElement);
            if (index === -1) index = 0;
            else index = (index + step + list.length) % list.length;
            list[index].focus();
        }

        pill.addEventListener("click", function () {
            if (openMenu && openMenu.pill === pill) closeMenu(true);
            else open();
        });

        pill.addEventListener("keydown", function (event) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                open();
            }
        });

        /* --- guardar --- */
        function choose(next) {
            var previous = wrap.dataset.status;
            if (next === previous) return;

            wrap.dataset.saving = "1";
            setError("");

            patchStatus(request.id, next)
                .then(function (updated) {
                    wrap.dataset.status = updated.status;
                    label.textContent = STATUS_LABELS[updated.status] || updated.status;
                    Array.prototype.forEach.call(options(), function (option) {
                        option.setAttribute("aria-selected", String(option.dataset.status === updated.status));
                    });
                    // La copia en memoria también, o el próximo filtrado
                    // seguiría creyendo lo anterior.
                    request.status = updated.status;
                    // Con un filtro puesto, la fila deja de pertenecer a la
                    // lista que se está viendo: se vuelve a pedir para no
                    // dejarla ahí contradiciendo al filtro.
                    if (statusFilter && statusFilter !== updated.status) loadRequests();
                })
                .catch(function (err) {
                    // Sesión vencida —o servidor reiniciado, que se lleva las
                    // que tiene en memoria—: sin esto el listado se quedaba a
                    // la vista con los teléfonos de los clientes y cada clic
                    // repetía el mismo error, sin manera de saber que lo que
                    // hace falta es volver a entrar.
                    if (err.unauthorized) {
                        showLogin();
                        setError("Tu sesión venció. Vuelve a entrar para guardar el cambio.");
                        return;
                    }
                    // El cambio no llegó a la base: la píldora se queda como
                    // estaba y el error sale arriba.
                    setError(err.message);
                })
                .then(function () {
                    delete wrap.dataset.saving;
                });
        }

        wrap.appendChild(pill);
        wrap.appendChild(menu);
        td.appendChild(wrap);
        row.appendChild(td);
    }

    /* ---------------------------------------------------------------------
       Ocupar un vehículo

       La columna «Ocupado» dice quién tiene el vehículo entre manos. Un
       vehículo disponible lo toma cualquiera con un clic y pasa a mostrar su
       nombre; a partir de ahí, solo esa persona puede soltarlo (y solo esa
       persona puede cambiarle el estado). Los demás lo ven como texto, sin
       poder tocarlo. La regla la aplica el servidor; esto solo la refleja.
    --------------------------------------------------------------------- */

    // Desplaza la tabla lo justo para que el «Liberar» de una píldora propia se
    // vea entero, cuando la tabla no cabe y esa columna queda contra el borde.
    // `free.scrollWidth` da el ancho de «Liberar» aunque esté plegado (max-width
    // 0 no lo esconde del cálculo), así que no hay que esperar a la transición.
    // Guarda el desplazamiento previo para volver a él al salir.
    function revealRelease(pill, free) {
        var scroller = document.querySelector(".staff-table__scroll");
        if (!scroller) return;
        // Si la tabla cabe entera no hay nada que desplazar: la píldora ya se ve.
        if (scroller.scrollWidth <= scroller.clientWidth) return;
        var edge = 12;                          // aire hasta el borde
        var grow = 8 + free.scrollWidth;        // margen + «Liberar» al estirarse
        var expandedRight = pill.getBoundingClientRect().right + grow;
        if (expandedRight <= scroller.getBoundingClientRect().right - edge) return; // ya se ve
        // «Ocupado» es la última columna y la píldora vive contra el borde de su
        // columna reservada, así que llevar la tabla al tope de la derecha la
        // enseña entera —nombre y «Liberar»— sin depender de una cuenta al píxel
        // que el ancho inestable de la vista volvería frágil. No se vuelve sola
        // al salir: devolver la tabla mientras el ratón sigue encima provoca un
        // vaivén —la píldora se corre bajo el cursor y dispara entrar/salir—, y
        // una vez a la vista la columna, pasar por otra píldora ya no mueve nada
        // (esta comprobación de «ya se ve» corta antes). La barra horizontal
        // sigue ahí para volver a mano.
        scroller.scrollTo({ left: scroller.scrollWidth - scroller.clientWidth, behavior: "smooth" });
    }

    // Abrir «Liberar» (clase, no :hover, para que no se cierre mientras la tabla
    // se mueve) y correr la tabla para que se vea entero.
    function startPeek(td, pill, free) {
        // revealRelease mide la píldora aún sin estirar (su borde ya estirado es
        // el actual más `8 + free.scrollWidth`, que suma), así que se llama antes
        // de abrir el «Liberar»; si no, contaría el estirón dos veces.
        revealRelease(pill, free);
        td.classList.add("is-peeking");
    }

    function endPeek(td) {
        td.classList.remove("is-peeking");
    }

    function buildOccupiedCell(row, request) {
        var td = document.createElement("td");
        td.className = "staff-occupied";

        // A mirar y nada más: quién lo tiene, en texto. Un botón aquí
        // prometería un cambio que este modo no hace.
        if (readOnly) {
            var seen = document.createElement("span");
            seen.className = "staff-occupied__other";
            seen.textContent = request.occupiedBy
                ? (request.occupiedName || request.occupiedBy)
                : "Disponible";
            td.appendChild(seen);
            row.appendChild(td);
            return;
        }

        if (!request.occupiedBy) {
            // Disponible: un botón para tomarlo.
            var claim = document.createElement("button");
            claim.type = "button";
            claim.className = "staff-occupied__claim";
            claim.textContent = "Disponible";
            claim.setAttribute("aria-label", "Tomar el vehículo de la solicitud " + request.id);
            claim.addEventListener("click", function () { setOccupied(request, true); });
            td.appendChild(claim);
        } else if (request.occupiedBy === viewer.workerId) {
            // Lo tengo yo: mi nombre, y al hacer clic lo suelto.
            var mine = document.createElement("button");
            mine.type = "button";
            mine.className = "staff-occupied__mine";
            // Sin title: la píldora ya muestra «Liberar» al pasar por encima, y
            // el globo nativo encima de eso sobra y tapa.
            mine.setAttribute("aria-label", "Liberar el vehículo de la solicitud " + request.id);

            var name = document.createElement("span");
            name.textContent = request.occupiedName || viewer.name || viewer.workerId;
            mine.appendChild(name);

            var free = document.createElement("span");
            free.className = "staff-occupied__free";
            free.textContent = "Liberar";
            mine.appendChild(free);

            mine.addEventListener("click", function () { setOccupied(request, false); });
            td.appendChild(mine);
            // Al ser la última columna, el «Liberar» que sale al pasar por
            // encima puede quedar tapado por el borde derecho cuando la tabla no
            // cabe entera. Se desplaza la tabla a la derecha para enseñarlo y se
            // vuelve al salir. Los escuchas van en la CELDA, no en la píldora:
            // al desplazar, la píldora se corre bajo el cursor, y en la píldora
            // el mouseleave saltaría y desharía el gesto —la celda, más ancha,
            // aguanta el puntero—. Y el «Liberar» se abre con una clase, no con
            // :hover, para que no se cierre mientras la tabla se mueve.
            td.addEventListener("mouseenter", function () { startPeek(td, mine, free); });
            td.addEventListener("mouseleave", function () { endPeek(td); });
            mine.addEventListener("focus", function () { startPeek(td, mine, free); });
            mine.addEventListener("blur", function () { endPeek(td); });
        } else {
            // Lo tiene otro: solo el nombre, sin tocar.
            var other = document.createElement("span");
            other.className = "staff-occupied__other";
            other.textContent = request.occupiedName || request.occupiedBy;
            td.appendChild(other);
        }

        row.appendChild(td);
    }

    function setOccupied(request, occupied) {
        setError("");
        patchOccupancy(request.id, occupied)
            .then(function (updated) {
                request.occupiedBy = updated.occupiedBy;
                request.occupiedName = updated.occupiedName;
                rebuildRow(request);
            })
            .catch(function (err) {
                if (err.unauthorized) {
                    showLogin();
                    setError("Tu sesión venció. Vuelve a entrar.");
                    return;
                }
                setError(err.message);
                // La ocupación cambió por debajo —otro lo tomó, o ya no lo
                // teníamos—: se vuelve a pedir la lista para que la columna
                // muestre quién lo tiene de verdad y no un estado inventado.
                loadRequests();
            });
    }

    function patchOccupancy(id, occupied) {
        return fetch(API_BASE + "/api/staff/requests/" + id + "/occupancy", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ occupied: occupied })
        }).then(function (response) {
            return response.json().catch(function () { return null; }).then(function (body) {
                if (!response.ok) {
                    var error = new Error((body && body.error) || "No pudimos cambiar la ocupación.");
                    if (response.status === 401) error.unauthorized = true;
                    throw error;
                }
                return body;
            });
        }, function () {
            throw new Error(NETWORK_MESSAGE);
        });
    }

    // Los escuchas van una sola vez en el documento y no uno por fila: con
    // doscientas solicitudes serían doscientos escuchas haciendo lo mismo.
    document.addEventListener("click", function (event) {
        if (!openMenu) return;
        if (openMenu.pill.contains(event.target) || openMenu.menu.contains(event.target)) return;
        closeMenu(false);
    });

    document.addEventListener("keydown", function (event) {
        if (!openMenu) return;
        if (event.key === "Escape") {
            event.preventDefault();
            closeMenu(true);
        } else if (event.key === "ArrowDown") {
            event.preventDefault();
            openMenu.move(1);
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            openMenu.move(-1);
        } else if (event.key === "Tab") {
            // Salir del menú con el tabulador lo cierra, como haría cualquier
            // desplegable; si no, quedaría abierto y flotando.
            closeMenu(false);
        }
    });

    // Al ser `fixed`, el menú no acompaña a la fila cuando algo se desplaza:
    // se cierra, que es lo que hace el desplegable nativo. En captura para
    // enterarse también del scroll de la tabla, que no llega a window.
    window.addEventListener("scroll", function () { closeMenu(false); }, true);
    window.addEventListener("resize", function () { closeMenu(false); });

    function patchStatus(id, status) {
        return fetch(API_BASE + "/api/staff/requests/" + id, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ status: status })
        }).then(function (response) {
            return response.json().catch(function () { return null; }).then(function (body) {
                if (!response.ok) {
                    var error = new Error((body && body.error) || "No pudimos guardar el estado.");
                    // Marcado para que quien llama saque el formulario de
                    // acceso, como hace loadRequests con su propio 401.
                    if (response.status === 401) error.unauthorized = true;
                    throw error;
                }
                return body;
            });
        }, function () {
            throw new Error(NETWORK_MESSAGE);
        });
    }

    /* ---------------------------------------------------------------------
       Listado
    --------------------------------------------------------------------- */

    // El buscador solo esconde y muestra las filas que ya están hechas. Antes
    // llamaba a render(), que las rehace todas: con doscientas solicitudes eran
    // unas dos mil doscientas opciones de estado —cada una con su escucha— por
    // cada carácter escrito.
    function applySearch() {
        // Un menú abierto en una fila que se acaba de esconder quedaría
        // flotando: es `fixed` y no acompaña a su fila.
        closeMenu(false);

        var term = searchTerm.trim().toLowerCase();
        var shown = 0;
        allRequests.forEach(function (request) {
            var visible = !term || request.searchText.indexOf(term) !== -1;
            if (visible && mineOnly) {
                visible = !!viewer.workerId && request.occupiedBy === viewer.workerId;
            }
            if (request.row) request.row.hidden = !visible;
            if (visible) shown++;
        });

        show(emptyEl, shown === 0);

        // «N de M» solo cuando el buscador recorta; con todo a la vista,
        // repetir el número dos veces no dice nada. M es lo que trajo la
        // consulta, que ya viene filtrada por el estado elegido.
        var total = allRequests.length;
        var noun = total === 1 ? "solicitud" : "solicitudes";
        countEl.textContent = shown === total
            ? total + " " + noun
            : shown + " de " + total + " " + noun;
    }

    // Solo se le cambia el estado a un vehículo que uno mismo ocupa: ni a los
    // libres (hay que tomarlos primero) ni a los de otro. Ocupar sí queda
    // abierto: un vehículo disponible lo toma cualquiera desde la columna
    // «Ocupado». El servidor aplica la misma regla (ver server/db.js).
    function canEditStatus(request) {
        if (readOnly) return false;
        return !!viewer.workerId && request.occupiedBy === viewer.workerId;
    }

    function makeRow(request) {
        var row = document.createElement("tr");
        cell(row, request.id, "staff-table__code");

        var plateTd = document.createElement("td");
        if (request.plate) {
            var plate = document.createElement("span");
            plate.className = "staff-table__plate";
            plate.textContent = request.plate;
            plateTd.appendChild(plate);
        } else {
            plateTd.textContent = "—";
        }
        row.appendChild(plateTd);

        cell(row, [request.firstName, request.lastName].filter(Boolean).join(" "));
        cell(row, request.phone, "staff-table__nowrap");
        cell(row, [request.brand, request.model].filter(Boolean).join(" "));
        cell(row, formatDate(request.createdAt), "staff-table__muted");
        cell(row, request.partCount, "staff-table__num");
        cell(row, QUALITY_LABELS[request.quality] || request.quality, "staff-table__nowrap");
        buildStatusCell(row, request, canEditStatus(request));
        buildOccupiedCell(row, request);
        // Guardada para que el buscador la esconda en vez de rehacerla, y para
        // poder rehacerla sola cuando cambia la ocupación (ver rebuildRow).
        request.row = row;
        return row;
    }

    function render() {
        // Las filas se rehacen enteras: un menú abierto quedaría apuntando a
        // un nodo que ya no está en la página.
        closeMenu(false);

        rowsEl.textContent = "";
        allRequests.forEach(function (request) {
            rowsEl.appendChild(makeRow(request));
        });

        applySearch();
    }

    // Al ocupar o liberar cambia también si la píldora de estado se puede tocar,
    // así que se rehace la fila entera en vez de parchear la celda: es un clic
    // deliberado y de vez en cuando, no el buscador tecleando.
    function rebuildRow(request) {
        if (!request.row || !request.row.parentNode) return;
        var fresh = makeRow(request);
        request.row.parentNode.replaceChild(fresh, request.row);
        // makeRow ya dejó request.row apuntando a `fresh`. applySearch repone la
        // visibilidad y el contador, que el reemplazo no conserva.
        applySearch();
    }

    /* ---------------------------------------------------------------------
       Las tres vistas: acceso, ficha y tabla

       Una sola función enseña y esconde, para que no haya dos sitios que
       puedan dejar media pantalla puesta.
    --------------------------------------------------------------------- */

    function paintView() {
        show(loadingEl, false);
        show(loginEl, view === "login");
        show(profileEl, view === "profile");
        show(monitorEl, view === "monitor");
        show(panelEl, view === "panel");

        // El botón de arriba a la derecha dice en cada pantalla lo que hace.
        // Solo en la ficha cierra la sesión; desde la tabla nunca se sale del
        // todo, se vuelve a la ficha —y la sesión sigue abierta, que es lo que
        // deja entrar otra vez sin la contraseña—. En modo consulta ni siquiera
        // se había empezado un turno: ahí lo único que cabe es volver.
        show(logoutBtn, view !== "login");
        logoutBtn.textContent = view === "login" || view === "profile"
            ? "Salir"
            : view === "monitor" || readOnly ? "Volver al perfil" : "Terminar sesión";
        if (view === "login") stopClock();
        else startClock();

        // The monitor repaints itself only while on screen, and not outside it:
        // somebody back on their profile does not need the occupancy asked of
        // the server every half minute.
        if (view === "monitor") startMonitorTimer();
        else stopMonitorTimer();

        show(readOnlyEl, view === "panel" && readOnly);
        // For the boss the table is for looking at and nothing else: there is no
        // working mode to switch into, so the notice says so and loses its
        // button. The server would refuse the change anyway (see refuseBoss in
        // server/server.js); this is about not offering what cannot be done.
        readOnlyTextEl.textContent = viewer.isBoss
            ? "El jefe del taller ve las solicitudes, pero no toma vehículos ni les cambia el estado."
            : "Estás viendo las solicitudes sin iniciar sesión: no puedes tomar vehículos ni cambiarles el estado.";
        show(readOnlyEnterBtn, !viewer.isBoss);
        // «Mis vehículos» goes too: the boss takes none, so that filter could
        // only ever empty the table.
        if (mineBtn) show(mineBtn, !viewer.isBoss);
        // Sin controles no hay nada que se guarde solo.
        show(noteEl, view === "panel" && !readOnly);
    }

    function showLogin() {
        view = "login";
        readOnly = false;
        // El siguiente que entre empieza con la fila de filtros limpia.
        mineOnly = false;
        if (mineBtn) mineBtn.setAttribute("aria-pressed", "false");
        paintView();
        workerIdInput.focus();
    }

    // De vuelta a la ficha. El modo se olvida: al entrar otra vez se vuelve a
    // elegir con cuál de los dos botones.
    function showProfile() {
        view = "profile";
        readOnly = false;
        paintView();
        // Se mide con la ficha ya visible: escondida no ocupa y daría cero.
        sizePhoto();
    }

    // The monitor, where the boss's profile leads instead of to the table. It
    // is painted empty and filled once the server answers: asking first and
    // showing afterwards would leave the profile up for the length of the trip.
    function showMonitor() {
        saveNotes();
        readOnly = false;
        view = "monitor";
        paintView();
        loadWorkers();
    }

    // Se llega aquí desde la ficha, con las solicitudes ya cargadas: se elige
    // el modo y se repinta la tabla, que es lo que decide si las filas llevan
    // controles o no.
    function showPanel(browseOnly) {
        saveNotes();
        readOnly = !!browseOnly;
        view = "panel";
        paintView();
        render();
        searchEl.focus();
    }

    /* ---------------------------------------------------------------------
       Ficha del trabajador

       Las notas son recordatorios suyos, no datos del taller: se quedan en
       este navegador, guardadas bajo su código, y no pasan por el servidor
       —que hoy no tiene dónde ponerlas—. Cambiar de máquina es empezar una
       libreta nueva.
    --------------------------------------------------------------------- */

    /* La foto es tan alta como la columna de al lado —nombre, código y notas—,
       hasta un tope, y guarda la proporción de un retrato. Las dos medidas se
       escriben aquí; el CSS solo pone de qué tamaño se ve si esto no corre.

       Se escriben las dos y no solo el ancho, y la fila alinea arriba y no
       estira, porque estirando había un trinquete: una caja estirada mide lo
       que mide la fila, no su propio contenido, y la fila la estaba levantando
       la propia foto a través de su `aspect-ratio`. Así, al borrar las notas la
       medida seguía siendo la de antes y la foto no volvía a bajar nunca. Con
       el alto puesto a mano —y siempre menor o igual que el de la columna— la
       foto ya no puede inflar lo que la mide.

       El tope es lo que impide que una lista larga de recordatorios convierta
       la foto en un cartel. La caja de notas tiene el suyo (ver styles.css) y
       este cubre lo que quede.

       Al estrechar la foto, la columna de al lado se ensancha y su texto puede
       recolocarse, y entonces el alto ya no es el que se midió. Por eso se
       repite hasta que deje de moverse, con un límite de vueltas: el caso
       corriente cierra a la primera. */
    var PHOTO_RATIO = 4 / 5;
    var PHOTO_MAX_HEIGHT = 420;
    var PHOTO_STACKED = "(max-width: 700px)";

    function sizePhoto() {
        // Sin la ficha a la vista no hay nada que medir: las cajas escondidas
        // no ocupan, y saldría cero.
        if (view !== "profile") return;
        // Apilada, la foto tiene sus medidas en el CSS: se le devuelven.
        if (window.matchMedia(PHOTO_STACKED).matches) {
            profilePhotoEl.style.width = "";
            profilePhotoEl.style.height = "";
            return;
        }
        for (var pass = 0; pass < 3; pass++) {
            var column = profileMainEl.getBoundingClientRect().height;
            if (!column) return;
            var height = Math.round(Math.min(column, PHOTO_MAX_HEIGHT));
            if (Math.abs(height - profilePhotoEl.getBoundingClientRect().height) < 2) return;
            profilePhotoEl.style.height = height + "px";
            profilePhotoEl.style.width = Math.round(height * PHOTO_RATIO) + "px";
        }
    }

    window.addEventListener("resize", sizePhoto);

    var NOTES_PREFIX = "autocolor.taller.notas.";
    var notesTimer = null;
    // Lo último que se guardó, para no reescribir lo mismo cada vez que se sale
    // de la ficha ni anunciar un guardado que no hizo falta.
    var notesSaved = "";

    function notesKey() {
        return viewer.workerId ? NOTES_PREFIX + viewer.workerId : "";
    }

    function paintProfile() {
        profileNameEl.textContent = viewer.name || viewer.workerId || "Trabajador";
        profileCodeEl.textContent = viewer.workerId || "";

        // The boss's profile differs by one button: where everybody else starts
        // their shift, he opens the monitor. The rest — the photo, the code, the
        // notepad — is the same, because it is his too.
        show(profileRoleEl, !!viewer.isBoss);
        show(profileMonitorBtn, !!viewer.isBoss);
        show(profileEnterBtn, !viewer.isBoss);

        var key = notesKey();
        var saved = "";
        // El navegador puede tener el almacenamiento cerrado (ventana privada,
        // ajustes): sin notas se sigue trabajando igual, así que no se avisa de
        // nada que el trabajador no pueda arreglar.
        if (key) {
            try {
                saved = window.localStorage.getItem(key) || "";
            } catch (err) {
                saved = "";
            }
        }
        notesEl.value = saved;
        notesSaved = saved;
        notesHintEl.textContent = "Se guardan en este dispositivo, bajo tu código.";
    }

    function saveNotes() {
        if (notesTimer) {
            window.clearTimeout(notesTimer);
            notesTimer = null;
        }
        var key = notesKey();
        if (!key || notesEl.value === notesSaved) return;
        try {
            window.localStorage.setItem(key, notesEl.value);
            notesSaved = notesEl.value;
            notesHintEl.textContent = "Guardado.";
        } catch (err) {
            notesHintEl.textContent = "No pudimos guardar las notas en este navegador.";
        }
    }

    // Al escribir no se guarda en cada tecla: se espera a que pare.
    notesEl.addEventListener("input", function () {
        if (notesTimer) window.clearTimeout(notesTimer);
        notesTimer = window.setTimeout(saveNotes, 600);
        // La caja de notas crece con lo escrito (ver `field-sizing` en
        // styles.css), así que la foto tiene que seguirla.
        sizePhoto();
    });

    profileEnterBtn.addEventListener("click", function () { showPanel(false); });
    profileMonitorBtn.addEventListener("click", showMonitor);
    profileBrowseBtn.addEventListener("click", function () { showPanel(true); });

    // Desde el aviso del modo consulta se pasa a trabajar sin volver a pedir
    // nada: la sesión ya está abierta, lo que faltaba era decidirlo.
    readOnlyEnterBtn.addEventListener("click", function () { showPanel(false); });

    /* ---------------------------------------------------------------------
       The boss's monitor

       One card per worker with the vehicles they are holding right now. It is
       not a record of shifts — the workshop keeps none: it is the table's
       «Ocupado» column read the other way round, by person instead of by
       vehicle.

       It is asked for separately rather than derived from the listing already
       in memory because that listing brings at most 200 rows and may arrive
       trimmed by a status filter: an occupied vehicle left out of it would make
       its worker look free.
    --------------------------------------------------------------------- */

    // Half a minute. Occupancy changes while the boss watches — somebody takes a
    // vehicle, somebody drops another — and a stale board is worse than none.
    var MONITOR_MS = 30000;
    var monitorTimer = null;

    function startMonitorTimer() {
        if (monitorTimer) return;
        monitorTimer = window.setInterval(function () { loadWorkers(); }, MONITOR_MS);
    }

    function stopMonitorTimer() {
        if (!monitorTimer) return;
        window.clearInterval(monitorTimer);
        monitorTimer = null;
    }

    // The monitor's status badge. Not the table's pill — nothing changes here —
    // but it carries the same `data-status`, which is where the colours of the
    // eleven statuses come from (see styles.css).
    function statusBadge(status) {
        var badge = document.createElement("span");
        badge.className = "staff-monitor__status";
        badge.dataset.status = status;

        var dot = document.createElement("span");
        dot.className = "staff-status__dot";
        badge.appendChild(dot);
        badge.appendChild(document.createTextNode(STATUS_LABELS[status] || status));
        return badge;
    }

    function monitorVehicle(request) {
        var item = document.createElement("li");
        item.className = "staff-monitor__vehicle";

        var plate = document.createElement("span");
        plate.className = "staff-table__plate";
        plate.textContent = request.plate || "Sin placa";
        item.appendChild(plate);

        var model = document.createElement("span");
        model.className = "staff-monitor__model";
        // textContent and not innerHTML: brand and model were typed by the
        // customer in the wizard, same as in the table.
        model.textContent = [request.brand, request.model].filter(Boolean).join(" ") || "—";
        item.appendChild(model);

        var code = document.createElement("span");
        code.className = "staff-monitor__code";
        code.textContent = request.id;
        item.appendChild(code);

        item.appendChild(statusBadge(request.status));
        return item;
    }

    function monitorCard(worker) {
        var card = document.createElement("article");
        card.className = "staff-monitor__card";
        // With no vehicles the card dims: at a glance you see who is on
        // something and who is not, which is what this screen is for.
        if (worker.requests.length === 0) card.classList.add("staff-monitor__card--idle");

        var head = document.createElement("header");
        head.className = "staff-monitor__worker";

        var name = document.createElement("h2");
        name.textContent = worker.name || worker.workerId;
        head.appendChild(name);

        var code = document.createElement("p");
        code.textContent = worker.workerId;
        head.appendChild(code);

        var count = document.createElement("span");
        count.className = "staff-monitor__count";
        count.textContent = worker.requests.length === 1
            ? "1 vehículo"
            : worker.requests.length + " vehículos";
        head.appendChild(count);

        card.appendChild(head);

        if (worker.requests.length === 0) {
            var idle = document.createElement("p");
            idle.className = "staff-monitor__idle";
            idle.textContent = "Sin vehículos";
            card.appendChild(idle);
            return card;
        }

        var list = document.createElement("ul");
        list.className = "staff-monitor__vehicles";
        worker.requests.forEach(function (request) {
            list.appendChild(monitorVehicle(request));
        });
        card.appendChild(list);
        return card;
    }

    function renderWorkers(workers) {
        monitorListEl.textContent = "";
        workers.forEach(function (worker) {
            monitorListEl.appendChild(monitorCard(worker));
        });
        show(monitorEmptyEl, workers.length === 0);

        // How many people are on something, not how many there are: that is what
        // the boss looks at.
        var busy = workers.filter(function (worker) { return worker.requests.length > 0; }).length;
        monitorCountEl.textContent = workers.length === 0
            ? ""
            : busy === 0
                ? "Nadie tiene un vehículo ahora mismo"
                : busy + " de " + workers.length + " con vehículo";
    }

    function loadWorkers() {
        return fetch(API_BASE + "/api/staff/workers", { credentials: "same-origin" })
            .then(function (response) {
                return response.json().catch(function () { return null; }).then(function (body) {
                    if (response.status === 401) {
                        showLogin();
                        setError("Tu sesión venció. Vuelve a entrar.");
                        return null;
                    }
                    if (!body && API_MISSING_STATUS.indexOf(response.status) !== -1) {
                        throw new Error(API_MISSING_MESSAGE);
                    }
                    if (!response.ok) {
                        throw new Error((body && body.error) || "No pudimos cargar a los trabajadores.");
                    }
                    setError("");
                    renderWorkers(body.workers || []);
                    return body;
                });
            })
            .catch(function (err) {
                setError(err instanceof TypeError ? NETWORK_MESSAGE : err.message);
            });
    }

    monitorRefreshBtn.addEventListener("click", function () { loadWorkers(); });

    function loadRequests() {
        var query = statusFilter ? "?status=" + encodeURIComponent(statusFilter) : "";
        return fetch(API_BASE + "/api/staff/requests" + query, { credentials: "same-origin" })
            .then(function (response) {
                return response.json().catch(function () { return null; }).then(function (body) {
                    if (response.status === 401) {
                        showLogin();
                        return null;
                    }
                    if (!body && API_MISSING_STATUS.indexOf(response.status) !== -1) {
                        throw new Error(API_MISSING_MESSAGE);
                    }
                    if (!response.ok) {
                        throw new Error((body && body.error) || "No pudimos cargar las solicitudes.");
                    }
                    setError("");
                    // Quién entró, para decidir qué filas puede tocar. Si el
                    // servidor no lo mandó, queda vacío y todo se ve como de
                    // otro —el servidor rechazaría el cambio igual—.
                    viewer = body.viewer || { workerId: "", name: "" };
                    allRequests = body.requests || [];
                    allRequests.forEach(function (request) {
                        request.searchText = haystack(request);
                    });
                    paintProfile();
                    // Recién entrado —o recién abierta la página con la sesión
                    // puesta— se pasa por la ficha, que es donde se elige cómo
                    // seguir. Si ya se estaba en la tabla —un filtro, un
                    // reintento— no se mueve de ahí.
                    if (view !== "panel" && view !== "monitor") view = "profile";
                    paintView();
                    // Después de pintar: la ficha escondida no ocupa y la foto
                    // saldría de cero.
                    sizePhoto();
                    render();
                    return body;
                });
            })
            .catch(function (err) {
                show(loadingEl, false);
                setError(err instanceof TypeError ? NETWORK_MESSAGE : err.message);
            });
    }

    /* ---------------------------------------------------------------------
       Acceso
    --------------------------------------------------------------------- */

    // Dos letras y cinco dígitos. La comprobación de verdad la hace el
    // servidor contra la lista de códigos; esto solo evita un viaje cuando lo
    // que se escribió ni siquiera tiene la forma.
    var WORKER_ID_RE = /^[A-Za-z]{2}[0-9]{5}$/;

    loginForm.addEventListener("submit", function (event) {
        event.preventDefault();
        // Se normaliza igual que en el servidor: sin espacios y en mayúsculas,
        // para que «ab12345» entre igual que «AB12345».
        var workerId = workerIdInput.value.trim().toUpperCase();
        var password = passwordInput.value;
        if (!workerId) {
            setError("Escribe tu código de trabajador.");
            workerIdInput.focus();
            return;
        }
        if (!WORKER_ID_RE.test(workerId)) {
            setError("El código de trabajador es dos letras y cinco dígitos (ej. AB12345).");
            workerIdInput.focus();
            return;
        }
        if (!password) {
            setError("Escribe la contraseña del taller.");
            passwordInput.focus();
            return;
        }

        loginSubmit.disabled = true;
        loginSubmit.textContent = "Entrando…";
        setError("");

        fetch(API_BASE + "/api/staff/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ workerId: workerId, password: password })
        })
            .then(function (response) {
                return response.json().catch(function () { return null; }).then(function (body) {
                    if (!response.ok) {
                        throw new Error((body && body.error) || "No pudimos iniciar sesión.");
                    }
                    // Ni el código ni la contraseña se quedan escritos.
                    workerIdInput.value = "";
                    passwordInput.value = "";
                    return loadRequests();
                });
            })
            .catch(function (err) {
                setError(err instanceof TypeError ? NETWORK_MESSAGE : err.message);
            })
            .then(function () {
                loginSubmit.disabled = false;
                loginSubmit.textContent = "Entrar";
            });
    });

    logoutBtn.addEventListener("click", function () {
        // Desde la tabla no se sale de la sesión: se termina el turno y se
        // vuelve a la ficha. Los datos de los clientes dejan de verse, que es
        // lo que importa de un vistazo, y volver a la tabla no pide contraseña.
        if (view === "panel" || view === "monitor") {
            showProfile();
            return;
        }

        // Desde la ficha sí. El listado se quita llegue o no la petición al
        // servidor: el clic es para dejar de tener los datos de los clientes a
        // la vista, y una red caída no es razón para dejarlos ahí creyendo que
        // se salió.
        var clear = function () {
            saveNotes();
            allRequests = [];
            rowsEl.textContent = "";
            setError("");
            showLogin();
        };
        fetch(API_BASE + "/api/staff/logout", { method: "POST", credentials: "same-origin" })
            .then(clear, clear);
    });

    searchEl.addEventListener("input", function () {
        searchTerm = searchEl.value;
        applySearch();
    });

    buildFilters();

    // Al abrir la página no se sabe si hay sesión: se pregunta, y el 401 —si
    // llega— es lo que decide mostrar el formulario de acceso.
    loadRequests();
})();
