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
    var passwordInput = document.getElementById("staffPassword");
    var loginSubmit = document.getElementById("staffLoginSubmit");
    var panelEl = document.getElementById("staffPanel");
    var searchEl = document.getElementById("staffSearch");
    var filtersEl = document.getElementById("staffFilters");
    var logoutBtn = document.getElementById("staffLogout");
    var rowsEl = document.getElementById("staffRows");
    var countEl = document.getElementById("staffCount");
    var emptyEl = document.getElementById("staffEmpty");
    var errorEl = document.getElementById("staffError");

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

    function buildFilters() {
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
        var buttons = filtersEl.querySelectorAll(".staff-chip");
        Array.prototype.forEach.call(buttons, function (button) {
            button.setAttribute("aria-pressed", String(button.dataset.value === statusFilter));
        });
    }

    // El texto sobre el que busca el buscador. Se arma una vez por fila en vez
    // de recomponerlo en cada tecla.
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

    function visibleRequests() {
        var term = searchTerm.trim().toLowerCase();
        if (!term) return allRequests;
        return allRequests.filter(function (request) {
            return haystack(request).indexOf(term) !== -1;
        });
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

    function buildStatusCell(row, request) {
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
                    throw new Error((body && body.error) || "No pudimos guardar el estado.");
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

    function render() {
        var requests = visibleRequests();

        // Las filas se rehacen enteras: un menú abierto quedaría apuntando a
        // un nodo que ya no está en la página.
        closeMenu(false);

        rowsEl.textContent = "";
        requests.forEach(function (request) {
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
            buildStatusCell(row, request);
            rowsEl.appendChild(row);
        });

        show(emptyEl, requests.length === 0);

        // «N de M» solo cuando el buscador recorta; con todo a la vista,
        // repetir el número dos veces no dice nada. M es lo que trajo la
        // consulta, que ya viene filtrada por el estado elegido.
        var total = allRequests.length;
        var noun = total === 1 ? "solicitud" : "solicitudes";
        countEl.textContent = requests.length === total
            ? total + " " + noun
            : requests.length + " de " + total + " " + noun;
    }

    function showLogin() {
        show(loadingEl, false);
        show(panelEl, false);
        show(logoutBtn, false);
        show(loginEl, true);
        passwordInput.focus();
    }

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
                    show(loadingEl, false);
                    show(loginEl, false);
                    show(panelEl, true);
                    show(logoutBtn, true);
                    setError("");
                    allRequests = body.requests || [];
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

    loginForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var password = passwordInput.value;
        if (!password) {
            setError("Escribe la contraseña del taller.");
            return;
        }

        loginSubmit.disabled = true;
        loginSubmit.textContent = "Entrando…";
        setError("");

        fetch(API_BASE + "/api/staff/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ password: password })
        })
            .then(function (response) {
                return response.json().catch(function () { return null; }).then(function (body) {
                    if (!response.ok) {
                        throw new Error((body && body.error) || "No pudimos iniciar sesión.");
                    }
                    // La contraseña no se queda escrita en el formulario.
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
        fetch(API_BASE + "/api/staff/logout", { method: "POST", credentials: "same-origin" })
            .then(function () {
                allRequests = [];
                rowsEl.textContent = "";
                setError("");
                showLogin();
            });
    });

    searchEl.addEventListener("input", function () {
        searchTerm = searchEl.value;
        render();
    });

    buildFilters();

    // Al abrir la página no se sabe si hay sesión: se pregunta, y el 401 —si
    // llega— es lo que decide mostrar el formulario de acceso.
    loadRequests();
})();
