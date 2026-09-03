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
    var filterEl = document.getElementById("staffFilter");
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

    // Los mismos estados que la columna `status` de la tabla `requests` (ver
    // server/schema.sql) y las mismas etiquetas que ve el cliente en la
    // consulta por código (src/lookup.js). Si allí cambian, aquí también.
    var STATUS_LABELS = {
        recibido: "Recibida",
        presupuestado: "Presupuestada",
        en_taller: "En el taller",
        listo: "Lista para recoger",
        entregado: "Entregada",
        cancelado: "Cancelada"
    };
    var STATUS_ORDER = ["recibido", "presupuestado", "en_taller", "listo", "entregado", "cancelado"];

    var QUALITY_LABELS = {
        standard: "Económico",
        premium: "Profesional",
        custom: "Alta gama"
    };

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
        return date.toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" }) +
            " · " + date.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" });
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
       Cambiar el estado de una solicitud
    --------------------------------------------------------------------- */

    function buildStatusCell(row, request) {
        var td = document.createElement("td");

        var pill = document.createElement("span");
        pill.className = "status-pill";
        pill.dataset.status = request.status;
        pill.textContent = STATUS_LABELS[request.status] || request.status;

        var select = document.createElement("select");
        select.className = "staff-status__select";
        select.setAttribute("aria-label", "Estado de la solicitud " + request.id);
        STATUS_ORDER.forEach(function (value) {
            var option = document.createElement("option");
            option.value = value;
            option.textContent = STATUS_LABELS[value];
            if (value === request.status) option.selected = true;
            select.appendChild(option);
        });

        select.addEventListener("change", function () {
            var next = select.value;
            var previous = pill.dataset.status;
            if (next === previous) return;

            select.disabled = true;
            setError("");

            patchStatus(request.id, next)
                .then(function (updated) {
                    pill.dataset.status = updated.status;
                    pill.textContent = STATUS_LABELS[updated.status] || updated.status;
                    // Con un filtro puesto, la fila deja de pertenecer a la
                    // lista que se está viendo: se recarga para no dejarla ahí
                    // contradiciendo al filtro.
                    if (filterEl.value && filterEl.value !== updated.status) loadRequests();
                })
                .catch(function (err) {
                    // El cambio no llegó a la base, así que el desplegable
                    // vuelve a lo que la fila dice de verdad.
                    select.value = previous;
                    setError(err.message);
                })
                .then(function () {
                    select.disabled = false;
                });
        });

        td.appendChild(pill);
        td.appendChild(select);
        row.appendChild(td);
    }

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

    function renderRows(requests) {
        rowsEl.textContent = "";
        requests.forEach(function (request) {
            var row = document.createElement("tr");
            cell(row, request.id, "staff-table__code");
            cell(row, formatDate(request.createdAt), "staff-table__nowrap");
            cell(row, [request.firstName, request.lastName].filter(Boolean).join(" "));
            cell(row, request.phone, "staff-table__nowrap");
            cell(row, [request.brand, request.model].filter(Boolean).join(" "));
            cell(row, request.plate, "staff-table__nowrap");
            cell(row, request.partCount, "staff-table__nowrap");
            cell(row, QUALITY_LABELS[request.quality] || request.quality, "staff-table__nowrap");
            buildStatusCell(row, request);
            rowsEl.appendChild(row);
        });

        show(emptyEl, requests.length === 0);
        countEl.textContent = requests.length === 1
            ? "1 solicitud"
            : requests.length + " solicitudes";
    }

    function showLogin() {
        show(loadingEl, false);
        show(panelEl, false);
        show(loginEl, true);
        passwordInput.focus();
    }

    function loadRequests() {
        var query = filterEl.value ? "?status=" + encodeURIComponent(filterEl.value) : "";
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
                    setError("");
                    renderRows(body.requests || []);
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
                rowsEl.textContent = "";
                setError("");
                showLogin();
            });
    });

    filterEl.addEventListener("change", loadRequests);

    // Al abrir la página no se sabe si hay sesión: se pregunta, y el 401 —si
    // llega— es lo que decide mostrar el formulario de acceso.
    loadRequests();
})();
