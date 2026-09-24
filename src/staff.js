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
    var bossNoteEl = document.getElementById("staffBossNote");
    var bossNoteTextEl = document.getElementById("staffBossNoteText");
    var bossNoteDateEl = document.getElementById("staffBossNoteDate");
    var notesEl = document.getElementById("staffNotes");
    var notesHintEl = document.getElementById("staffNotesHint");
    var profileRoleEl = document.getElementById("staffProfileRole");
    var profileEnterBtn = document.getElementById("staffProfileEnter");
    var profileMonitorBtn = document.getElementById("staffProfileMonitor");
    var profileBrowseBtn = document.getElementById("staffProfileBrowse");
    var profileIntakeBtn = document.getElementById("staffProfileIntake");
    var intakeEl = document.getElementById("staffIntake");
    var intakeFormEl = document.getElementById("staffIntakeForm");
    var intakeFirstNameEl = document.getElementById("intakeFirstName");
    var intakeLastNameEl = document.getElementById("intakeLastName");
    var intakeEmailEl = document.getElementById("intakeEmail");
    var intakePhoneEl = document.getElementById("intakePhone");
    var intakeVehicleEl = document.getElementById("intakeVehicle");
    var intakeQualityEl = document.getElementById("intakeQuality");
    var intakeBrandEl = document.getElementById("intakeBrand");
    var intakeModelEl = document.getElementById("intakeModel");
    var intakePlateEl = document.getElementById("intakePlate");
    var intakeNotesEl = document.getElementById("intakeNotes");
    var intakePartsEl = document.getElementById("intakeParts");
    var intake3dCanvasWrapEl = document.getElementById("intake3dCanvasWrap");
    // Reassigned on every teardown: a canvas whose WebGL context was dropped
    // cannot be drawn into again (see replaceIntakeCanvas).
    var intake3dCanvasEl = document.getElementById("intake3dCanvas");
    var intake3dOverlayEl = document.getElementById("intake3dOverlay");
    var intake3dProgressBarEl = document.getElementById("intake3dProgressBar");
    var intake3dLoadingLabelEl = document.getElementById("intake3dLoadingLabel");
    var intake3dErrorEl = document.getElementById("intake3dError");
    var intake3dButtonsEl = document.getElementById("intake3dButtons");
    var intake3dListEl = document.getElementById("intake3dList");
    var intake3dCountEl = document.getElementById("intake3dCount");
    var intake3dClearEl = document.getElementById("intake3dClear");
    var intakeQuoteEl = document.getElementById("intakeQuote");
    var intakeQuoteFinishesEl = document.getElementById("intakeQuoteFinishes");
    var intakeQuoteDiscountEl = document.getElementById("intakeQuoteDiscount");
    var intakeErrorEl = document.getElementById("intakeError");
    var intakeSubmitEl = document.getElementById("intakeSubmit");
    var intakeCancelEl = document.getElementById("intakeCancel");
    var intakeDoneEl = document.getElementById("intakeDone");
    var intakeDoneNameEl = document.getElementById("intakeDoneName");
    var intakeDoneCodeEl = document.getElementById("intakeDoneCode");
    var intakeDoneHintEl = document.getElementById("intakeDoneHint");
    var intakeAgainEl = document.getElementById("intakeAgain");
    var intakeBackEl = document.getElementById("intakeBack");
    var partsViewEl = document.getElementById("partsView");
    var partsViewPanelEl = document.getElementById("partsViewPanel");
    var partsViewBackdropEl = document.getElementById("partsViewBackdrop");
    var partsViewCloseEl = document.getElementById("partsViewClose");
    var partsViewSubtitleEl = document.getElementById("partsViewSubtitle");
    var partsViewCanvasWrapEl = document.getElementById("partsViewCanvasWrap");
    // Reassigned on every teardown, like the walk-in form's: a canvas whose
    // WebGL context was dropped cannot be drawn into again.
    var partsViewCanvasEl = document.getElementById("partsViewCanvas");
    var partsViewOverlayEl = document.getElementById("partsViewOverlay");
    var partsViewProgressBarEl = document.getElementById("partsViewProgressBar");
    var partsViewLoadingLabelEl = document.getElementById("partsViewLoadingLabel");
    var partsViewErrorEl = document.getElementById("partsViewError");
    var partsViewListEl = document.getElementById("partsViewList");
    var partsViewCountEl = document.getElementById("partsViewCount");
    var codeHeadEl = document.getElementById("staffCodeHead");
    var monitorEl = document.getElementById("staffMonitor");
    var monitorListEl = document.getElementById("staffMonitorList");
    var monitorCountEl = document.getElementById("staffMonitorCount");
    var monitorEmptyEl = document.getElementById("staffMonitorEmpty");
    var monitorRefreshBtn = document.getElementById("staffMonitorRefresh");
    var readOnlyEl = document.getElementById("staffReadOnly");
    var readOnlyTextEl = document.getElementById("staffReadOnlyText");
    var readOnlyEnterBtn = document.getElementById("staffReadOnlyEnter");
    var noteEl = document.getElementById("staffNote");
    var panelTitleEl = document.getElementById("staffPanelTitle");
    var tabVehiclesEl = document.getElementById("staffTabVehicles");
    var tabPaintEl = document.getElementById("staffTabPaint");
    var tabVehiclesCountEl = document.getElementById("staffTabVehiclesCount");
    var tabPaintCountEl = document.getElementById("staffTabPaintCount");
    var tabPaintNewEl = document.getElementById("staffTabPaintNew");
    var vehiclesCardEl = document.getElementById("staffVehiclesCard");
    var paintCardEl = document.getElementById("staffPaintCard");
    var paintFiltersEl = document.getElementById("staffPaintFilters");
    var paintRowsEl = document.getElementById("staffPaintRows");
    var paintEmptyEl = document.getElementById("staffPaintEmpty");
    var paintCodeHeadEl = document.getElementById("staffPaintCodeHead");
    var defineEl = document.getElementById("paintDefine");
    var defineBackdropEl = document.getElementById("paintDefineBackdrop");
    var defineCloseEl = document.getElementById("paintDefineClose");
    var defineSubtitleEl = document.getElementById("paintDefineSubtitle");
    var defineFormEl = document.getElementById("paintDefineForm");
    var defineBrandEl = document.getElementById("paintDefineBrand");
    var defineBrandsEl = document.getElementById("paintDefineBrands");
    var defineCodeEl = document.getElementById("paintDefineCode");
    var defineNameEl = document.getElementById("paintDefineName");
    var defineFinishEl = document.getElementById("paintDefineFinish");
    var defineHexEl = document.getElementById("paintDefineHex");
    var defineHexOnEl = document.getElementById("paintDefineHexOn");
    var defineSizeEl = document.getElementById("paintDefineSize");
    var defineUnitsEl = document.getElementById("paintDefineUnits");
    var definePriceEl = document.getElementById("paintDefinePrice");
    var definePriceHintEl = document.getElementById("paintDefinePriceHint");
    var defineErrorEl = document.getElementById("paintDefineError");
    var defineSaveEl = document.getElementById("paintDefineSave");
    var defineCancelEl = document.getElementById("paintDefineCancel");

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
    var PAINT_ORDER = window.AUTOCOLOR_STATUSES.PAINT_ORDER;
    var PAINT_LABELS = window.AUTOCOLOR_STATUSES.PAINT_LABELS;
    var PAINT_FILTER_LABELS = window.AUTOCOLOR_STATUSES.PAINT_FILTER_LABELS;

    // Containers, finishes and the price list, for the matizado table and the
    // boss's form (src/paints.js, loaded without its colour catalogue).
    var PAINTS = window.AUTOCOLOR_PAINTS || null;

    var QUALITY_LABELS = {
        standard: "Económico",
        premium: "Profesional",
        custom: "Alta gama"
    };

    // Panel names and prices, shared with the customer's wizard so the two
    // cannot name the same panel differently. The walk-in form needs the
    // prices too; the parts viewer only needs the labels. Without the file
    // both fall back to the raw ids, which still beats a blank list.
    var PARTS = window.AUTOCOLOR_PARTS || null;
    var partLabel = PARTS ? PARTS.label : function (id) { return id; };

    // How many people can hold one vehicle at a time. The rule belongs to the
    // database (the CHECK on `occupied_by`) and to the server (MAX_HOLDERS in
    // server/db.js); this copy only decides whether the cell still offers a
    // button, so that nobody is invited to press what would be refused.
    var MAX_HOLDERS = 2;

    /* ---------------------------------------------------------------------
       The 3D viewer module

       Two screens mount it — the walk-in form's part picker and the table's
       parts viewer — and it is the same file for both: fetched once, with a
       viewer built per screen. A retry needs a URL the browser has not
       already written off (its module map remembers a failed fetch), hence
       the query string, which is only ever added after a failure.
    --------------------------------------------------------------------- */

    var car3dModule = null;
    var car3dRetries = 0;

    function loadCar3d() {
        if (!car3dModule) {
            car3dModule = import("../src/carVisual.js" +
                (car3dRetries ? "?reintento=" + car3dRetries : ""));
        }
        return car3dModule;
    }

    // Called when the import itself failed. Holding on to a rejected promise
    // means the next attempt re-runs the failure handler without fetching
    // anything, so it is dropped and the next URL is a fresh one.
    function forgetCar3d() {
        car3dModule = null;
        car3dRetries++;
    }

    /* ---------------------------------------------------------------------
       Who is holding a vehicle

       Every request arrives with `holders`: one entry per person holding it,
       with their code and their name (see withHolders in server/server.js).
       Empty means available, and there are two at most.
    --------------------------------------------------------------------- */

    function holdersOf(request) {
        return request.holders || [];
    }

    function holdsIt(request, workerId) {
        return !!workerId && holdersOf(request).some(function (holder) {
            return holder.workerId === workerId;
        });
    }

    // The configured name, or the code when there is none (see
    // server/names.js): naming the code says more than naming nobody.
    function holderName(holder) {
        return holder.name || holder.workerId;
    }

    // «Ana Bravo y Carlos Díaz», for the notices that name who is holding it.
    function holderNames(holders) {
        return holders.map(holderName).join(" y ");
    }

    // For comparing before and after without going by the identity of the
    // array, which is a new one in every answer from the server.
    function holderKey(holders) {
        return holders.map(function (holder) { return holder.workerId; }).join(",");
    }

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

    // The matizado orders, the panel's second table (see «Matizado» below).
    // Their own filter; the search box is shared and searches whichever table
    // is on screen.
    var allPaintOrders = [];
    var paintStatusFilter = "";
    var paintLoaded = false;
    // Which of the two tables the switch above the title shows.
    var panelTab = "vehicles";

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
    var viewer = { workerId: "", name: "", isBoss: false, note: null };

    // What is on screen: the login, the worker's profile, the table, or — for
    // the boss only — the monitor or the walk-in form. loadRequests brings the
    // data, but does not decide this.
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

    // What the pill needs to know about its table. The vehicles and the
    // matizado orders share the pill, the menu and the one-change-at-a-time
    // rule, and differ in their list of statuses, their route and what else a
    // saved change touches. Built lazily (statusSpec) because patchStatus and
    // friends are declared further down.
    var VEHICLE_STATUS = null;

    function vehicleStatusSpec() {
        if (VEHICLE_STATUS) return VEHICLE_STATUS;
        VEHICLE_STATUS = {
            order: STATUS_ORDER,
            labels: STATUS_LABELS,
            noun: "de la solicitud",
            patch: patchStatus,
            lockedTitle: function (request) {
                // Por qué no se puede: se entró solo a mirar, o —con la sesión
                // iniciada— está libre y hay que tomarlo, o lo tienen otros.
                var holding = holdersOf(request);
                return readOnly
                    ? "Inicia sesión para cambiar el estado"
                    : holding.length
                        ? (holding.length > 1 ? "Lo tienen " : "Lo tiene ") + holderNames(holding)
                        : "Toma el vehículo para cambiarle el estado";
            },
            saved: function (request, updated) {
                // Con un filtro puesto, la fila deja de pertenecer a la
                // lista que se está viendo: se vuelve a pedir para no
                // dejarla ahí contradiciendo al filtro.
                if (statusFilter && statusFilter !== updated.status) {
                    loadRequests();
                    return;
                }
                // A finished status (entregado, cancelado) releases the
                // vehicle on the server — from both holders at once — so
                // the «Ocupado» cell has to follow. Compared by code and
                // not by identity: every answer brings a fresh array.
                var fresh = updated.holders || [];
                if (holderKey(fresh) !== holderKey(holdersOf(request))) {
                    request.holders = fresh;
                    rebuildRow(request);
                }
            }
        };
        return VEHICLE_STATUS;
    }

    function buildStatusCell(row, request, editable, spec) {
        spec = spec || vehicleStatusSpec();
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
        pill.setAttribute("aria-label", "Estado " + spec.noun);

        // Un vehículo ocupado por otro no se toca: la píldora queda inerte. Es
        // solo comodidad —el servidor rechaza el cambio igual (403)—, pero
        // evita el clic que no iba a ninguna parte. Un botón deshabilitado no
        // recibe clic ni teclas, así que no hace falta guardar cada escucha.
        if (!editable) {
            pill.disabled = true;
            pill.classList.add("staff-status__pill--locked");
            pill.title = spec.lockedTitle(request);
        }

        var dot = document.createElement("span");
        dot.className = "staff-status__dot";

        var label = document.createElement("span");
        label.textContent = spec.labels[request.status] || request.status;

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

        spec.order.forEach(function (value) {
            var option = document.createElement("button");
            option.type = "button";
            option.className = "staff-status__option";
            option.setAttribute("role", "option");
            option.dataset.status = value;
            option.setAttribute("aria-selected", String(value === request.status));

            var optionDot = document.createElement("span");
            optionDot.className = "staff-status__dot";
            option.appendChild(optionDot);
            option.appendChild(document.createTextNode(spec.labels[value]));

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
            // One change at a time. A second pick while the first PATCH is out
            // sent two requests whose answers could arrive in the opposite
            // order to their commits, leaving the pill on one status and the
            // database on the other.
            if (wrap.dataset.saving) return;

            wrap.dataset.saving = "1";
            pill.disabled = true;
            setError("");

            spec.patch(request.id, next)
                .then(function (updated) {
                    wrap.dataset.status = updated.status;
                    label.textContent = spec.labels[updated.status] || updated.status;
                    Array.prototype.forEach.call(options(), function (option) {
                        option.setAttribute("aria-selected", String(option.dataset.status === updated.status));
                    });
                    // La copia en memoria también, o el próximo filtrado
                    // seguiría creyendo lo anterior.
                    request.status = updated.status;
                    spec.saved(request, updated);
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
                    pill.disabled = false;
                });
        }

        wrap.appendChild(pill);
        wrap.appendChild(menu);
        td.appendChild(wrap);
        row.appendChild(td);
    }

    /* ---------------------------------------------------------------------
       The «Piezas» column and the viewer behind it

       The column has always carried the number of panels, which says how much
       work a row is but not which work: «6 piezas» is a bonnet and a wing as
       easily as two doors and both bumpers. The arrow beside the number opens
       the vehicle itself — the very 3D model the parts were chosen on, turning
       on its own, with those panels lit up, and their names listed beside it.

       It is the wizard's viewer (mountCar3D in src/carVisual.js) mounted
       read-only: nothing in the workshop's table changes what the customer
       asked for. The same module the walk-in form uses, fetched once for both
       (see loadCar3d).

       One viewer at a time, and it lives exactly as long as the panel is open:
       its model weighs tens of megabytes on the GPU and it draws every frame
       while it turns, so opening another row's parts tears the first one down
       and closing takes the WebGL context with it.
    --------------------------------------------------------------------- */

    function buildPartsCell(row, request) {
        var td = document.createElement("td");
        td.className = "staff-table__num";

        var parts = request.parts || [];
        // Nothing to draw: an old row saved before the wizard asked for
        // panels, or one whose silhouette never arrived. The number stays —
        // it is the column's data — and there is simply no arrow to press.
        if (!request.vehicle || parts.length === 0) {
            td.textContent = request.partCount;
            row.appendChild(td);
            return;
        }

        var open = document.createElement("button");
        open.type = "button";
        open.className = "staff-parts__open";
        open.setAttribute("aria-haspopup", "dialog");
        open.setAttribute("aria-expanded", "false");
        open.setAttribute("aria-label", request.partCount === 1
            ? "Ver en 3D la pieza de la solicitud " + request.id
            : "Ver en 3D las " + request.partCount + " piezas de la solicitud " + request.id);

        var count = document.createElement("span");
        count.textContent = request.partCount;
        open.appendChild(count);

        var caret = document.createElement("span");
        caret.className = "staff-parts__caret";
        open.appendChild(caret);

        open.addEventListener("click", function () { openPartsView(request, open); });
        td.appendChild(open);
        row.appendChild(td);
    }

    // The request being looked at, the arrow it was opened from — to give the
    // focus back on closing — and the mounted viewer, if there is one.
    var partsViewRequest = null;
    var partsViewTrigger = null;
    var partsView3d = null;
    // Bumped on every open and every close: a mount still waiting on its
    // import() checks this number before building anything, so a row opened
    // and closed quickly leaves no viewer drawing onto a layer nobody sees.
    var partsViewMountId = 0;

    function openPartsView(request, trigger) {
        var parts = request.parts || [];
        if (!request.vehicle || parts.length === 0) return;
        // Another row already open: it closes without giving the focus back,
        // which is about to go to the ✕ of the one being opened.
        if (partsViewRequest) closePartsView(false);

        partsViewRequest = request;
        partsViewTrigger = trigger || null;
        if (partsViewTrigger) partsViewTrigger.setAttribute("aria-expanded", "true");

        // Which car it is that is turning. Not the code: the column that
        // carried it is the boss's, and the plate is what the car is known by
        // out in the yard.
        partsViewSubtitleEl.textContent = [
            request.plate || "Sin placa",
            [request.brand, request.model].filter(Boolean).join(" ")
        ].filter(Boolean).join(" · ");

        renderPartsViewList(parts);
        show(partsViewEl, true);
        resetPartsViewOverlay();
        mountPartsView3d(request);
        partsViewCloseEl.focus();
    }

    function renderPartsViewList(parts) {
        partsViewListEl.textContent = "";
        parts.forEach(function (id) {
            var item = document.createElement("li");
            item.className = "car-view-3d__list-item";
            var name = document.createElement("span");
            name.className = "car-view-3d__list-item-name";
            name.textContent = partLabel(id);
            item.appendChild(name);
            partsViewListEl.appendChild(item);
        });
        partsViewCountEl.textContent = parts.length + (parts.length === 1 ? " pieza" : " piezas");
    }

    // A canvas is single-use: tearing the viewer down drops its WebGL context
    // (see destroy() in src/carVisual.js), so the next row gets a fresh one.
    // Same dance as in the counter's walk-in form.
    function replacePartsViewCanvas() {
        var fresh = document.createElement("canvas");
        fresh.id = partsViewCanvasEl.id;
        fresh.className = partsViewCanvasEl.className;
        partsViewCanvasWrapEl.replaceChild(fresh, partsViewCanvasEl);
        partsViewCanvasEl = fresh;
    }

    function resetPartsViewOverlay() {
        partsViewOverlayEl.classList.remove("hidden");
        partsViewProgressBarEl.style.width = "0%";
        if (partsViewProgressBarEl.parentElement) partsViewProgressBarEl.parentElement.style.display = "";
        partsViewLoadingLabelEl.hidden = false;
        partsViewLoadingLabelEl.textContent = "Cargando modelo 3D…";
        partsViewErrorEl.hidden = true;
        partsViewErrorEl.textContent = "";
    }

    function showPartsViewError(message) {
        partsViewOverlayEl.classList.remove("hidden");
        partsViewLoadingLabelEl.hidden = true;
        if (partsViewProgressBarEl.parentElement) partsViewProgressBarEl.parentElement.style.display = "none";
        partsViewErrorEl.textContent = message;
        partsViewErrorEl.hidden = false;
    }

    function mountPartsView3d(request) {
        var parts = request.parts || [];
        var mountId = ++partsViewMountId;
        var canvasEl = partsViewCanvasEl;

        // Two handlers and not a trailing .catch(), for the reason given at
        // mountIntake3d: a module that failed to DOWNLOAD needs the cached
        // promise thrown away, one that downloaded and failed to MOUNT does
        // not, and a trailing .catch() would treat both as the first.
        loadCar3d().then(function (mod) {
            if (mountId !== partsViewMountId) return;
            try {
                partsView3d = mod.mountCar3D({
                    vehicle: request.vehicle,
                    canvasEl: canvasEl,
                    canvasWrapEl: partsViewCanvasWrapEl,
                    overlayEl: partsViewOverlayEl,
                    progressBarEl: partsViewProgressBarEl,
                    loadingLabelEl: partsViewLoadingLabelEl,
                    errorEl: partsViewErrorEl,
                    // No camera buttons: it turns by itself, and the five
                    // views would fight the turntable for the camera.
                    buttonsEl: null,
                    isPartSelected: function (id) { return parts.indexOf(id) !== -1; },
                    // Read-only: there is nothing here to toggle. `interactive`
                    // is what keeps the click from ever arriving.
                    onPartToggle: function () {},
                    interactive: false,
                    spin: true,
                    // The wizard's wording sends you to a checklist below the
                    // canvas; here the panels are named in the list beside it
                    // and there is nothing to choose.
                    loadErrorText: "No se pudo cargar el modelo 3D. Las piezas están en la lista."
                });
            } catch (err) {
                console.error("[taller] Could not build the 3D viewer:", err);
                showPartsViewError("No se pudo abrir el visor 3D. Cierra y vuelve a abrir para reintentar.");
            }
        }, function (err) {
            if (mountId !== partsViewMountId) return;
            forgetCar3d();
            console.error("[taller] Could not load the 3D viewer module:", err);
            showPartsViewError("No se pudo cargar el visor 3D. Cierra y vuelve a abrir para reintentar.");
        });
    }

    // `restoreFocus` is false when the focus already has somewhere to go: on
    // opening another row. The arrow may have gone in the meantime — the row is
    // rebuilt on taking or releasing a vehicle — hence the check.
    function closePartsView(restoreFocus) {
        // First, and not only when there is a viewer to tear down: a mount
        // still waiting on its import() has nothing for destroy() to reach,
        // and without this it would go on to build its viewer — WebGL context,
        // turntable and all — onto a layer nobody is looking at any more.
        partsViewMountId++;
        if (partsView3d) {
            partsView3d.destroy();
            partsView3d = null;
            replacePartsViewCanvas();
        }
        show(partsViewEl, false);

        var trigger = partsViewTrigger;
        partsViewTrigger = null;
        partsViewRequest = null;
        if (!trigger) return;
        trigger.setAttribute("aria-expanded", "false");
        if (restoreFocus !== false && trigger.isConnected) trigger.focus();
    }

    partsViewCloseEl.addEventListener("click", function () { closePartsView(true); });
    // Tapping outside closes, as on any layer of this kind. The backdrop is an
    // element of its own and not the whole layer, so a click on the panel — on
    // the canvas, on the list — never reaches this.
    partsViewBackdropEl.addEventListener("click", function () { closePartsView(true); });

    document.addEventListener("keydown", function (event) {
        if (!partsViewRequest) return;
        if (event.key === "Escape") {
            event.preventDefault();
            closePartsView(true);
            return;
        }
        if (event.key !== "Tab") return;
        // The focus does not leave the layer while it is open. Today the only
        // thing inside is the ✕, so tabbing lands on it again; written over the
        // list of focusables so it still holds if the panel gains a control.
        var items = Array.prototype.filter.call(
            partsViewPanelEl.querySelectorAll("button, [href], input, select, textarea, [tabindex]"),
            function (el) { return !el.disabled && el.tabIndex !== -1 && el.offsetParent !== null; }
        );
        if (items.length === 0) return;
        var first = items[0];
        var last = items[items.length - 1];
        var going = event.shiftKey ? first : last;
        if (document.activeElement !== going && items.indexOf(document.activeElement) !== -1) return;
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
    });

    /* ---------------------------------------------------------------------
       Ocupar un vehículo

       The «Ocupado» column says who has the vehicle in their hands, which can
       be two people: a car is painted by a pair, and the ceiling lives in the
       database and in the server (MAX_HOLDERS in server/db.js). While there is
       room, anybody joins with a click and their name appears in the list;
       from then on each one releases their own and leaves the other where they
       were, and either of them can change the status. Whoever is not holding
       it reads the names as text. The rule is enforced by the server; this
       only reflects it.
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

    // Somebody else's name, or every name at once in browse mode: plain text,
    // because nothing here is for this viewer to press.
    function holderText(text) {
        var other = document.createElement("span");
        other.className = "staff-occupied__other";
        other.textContent = text;
        return other;
    }

    function buildOccupiedCell(row, request) {
        var td = document.createElement("td");
        td.className = "staff-occupied";

        var holders = holdersOf(request);

        // The cell is a list: up to two people, each bringing their own thing
        // — my pill with «Liberar», the other person's name — plus the button
        // to join while there is room.
        var list = document.createElement("div");
        list.className = "staff-occupied__holders";
        td.appendChild(list);

        // A mirar y nada más: quiénes lo tienen, en texto. Un botón aquí
        // prometería un cambio que este modo no hace.
        if (readOnly) {
            if (holders.length === 0) {
                list.appendChild(holderText("Disponible"));
            } else {
                holders.forEach(function (holder) {
                    list.appendChild(holderText(holderName(holder)));
                });
            }
            row.appendChild(td);
            return;
        }

        holders.forEach(function (holder) {
            if (holder.workerId !== viewer.workerId) {
                // Lo tiene otro: solo el nombre, sin tocar.
                list.appendChild(holderText(holderName(holder)));
                return;
            }

            // Lo tengo yo: mi nombre, y al hacer clic lo suelto. Releasing
            // takes out my own hold and nothing else: where there were two of
            // us, the other person keeps the vehicle.
            var mine = document.createElement("button");
            mine.type = "button";
            mine.className = "staff-occupied__mine";
            // Sin title: la píldora ya muestra «Liberar» al pasar por encima, y
            // el globo nativo encima de eso sobra y tapa.
            mine.setAttribute("aria-label", "Liberar el vehículo de la solicitud " + request.id);

            var name = document.createElement("span");
            name.textContent = holderName(holder) || viewer.name || viewer.workerId;
            mine.appendChild(name);

            var free = document.createElement("span");
            free.className = "staff-occupied__free";
            free.textContent = "Liberar";
            mine.appendChild(free);

            mine.addEventListener("click", function () { setOccupied(request, false); });
            list.appendChild(mine);
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
        });

        // There is room and I am not in it: join. With nobody holding it the
        // button reads «Disponible», which is the state of the vehicle; with
        // one person already on it, «Acompañar», because what happens is not
        // taking it but standing beside them. Full — two — has no button at
        // all: the server would refuse it (409) and offering it would promise
        // what is not there.
        if (!holdsIt(request, viewer.workerId) && holders.length < MAX_HOLDERS) {
            var claim = document.createElement("button");
            claim.type = "button";
            claim.className = "staff-occupied__claim";
            if (holders.length === 0) {
                claim.textContent = "Disponible";
                claim.setAttribute("aria-label", "Tomar el vehículo de la solicitud " + request.id);
            } else {
                claim.classList.add("staff-occupied__claim--join");
                claim.textContent = "Acompañar";
                claim.setAttribute("aria-label",
                    "Trabajar en el vehículo de la solicitud " + request.id +
                    " junto a " + holderNames(holders));
            }
            claim.addEventListener("click", function () { setOccupied(request, true); });
            list.appendChild(claim);
        }

        row.appendChild(td);
    }

    function setOccupied(request, occupied) {
        setError("");
        patchOccupancy(request.id, occupied)
            .then(function (updated) {
                // Who holds it AFTER the change, which is not the same as
                // who asked for it: releasing can leave the other person on
                // the vehicle.
                request.holders = updated.holders || [];
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

        if (panelTab === "paint") {
            allPaintOrders.forEach(function (order) {
                var visible = !term || order.searchText.indexOf(term) !== -1;
                if (order.row) order.row.hidden = !visible;
                if (visible) shown++;
            });
            show(paintEmptyEl, paintLoaded && shown === 0);
            var orders = allPaintOrders.length;
            var noun2 = orders === 1 ? "pedido" : "pedidos";
            var open = allPaintOrders.filter(function (order) {
                return order.status === "recibido" || order.status === "preparacion";
            }).length;
            countEl.textContent = !paintLoaded ? ""
                : (shown === orders ? orders + " " + noun2 : shown + " de " + orders + " " + noun2)
                    + (open ? " · " + open + " por preparar" : "");
            return;
        }

        allRequests.forEach(function (request) {
            var visible = !term || request.searchText.indexOf(term) !== -1;
            if (visible && mineOnly) {
                visible = holdsIt(request, viewer.workerId);
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
    // libres (hay que tomarlos primero) ni a los que solo tienen otros.
    // Cualquiera de quienes lo tienen puede, que son dos como mucho. Ocupar sí
    // queda abierto: mientras quede sitio, cualquiera se suma desde la columna
    // «Ocupado». El servidor aplica la misma regla (ver server/db.js).
    function canEditStatus(request) {
        if (readOnly) return false;
        return holdsIt(request, viewer.workerId);
    }

    function makeRow(request) {
        var row = document.createElement("tr");
        // The code is the boss's column (see the header in pgs/taller.html):
        // whoever is painting the car never has to read it out, and the row is
        // built with one cell fewer rather than with a hidden one, so that the
        // cells and the headers on screen stay in step.
        if (viewer.isBoss) cell(row, request.id, "staff-table__code");

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
        buildPartsCell(row, request);
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
       Matizado: the second table

       The orders sold over the counter from pgs/paintings.html, behind the
       switch above the title. Same card, same search box and the same status
       pill as the vehicles, but a different trade: nobody leaves a car, so
       there is no «Ocupado» column and no «Mis vehículos» filter, and any
       worker on shift moves an order along (PATCH /api/staff/paint-orders).

       The one thing only the boss does here is define an order read at the
       counter — method 'in_person', which arrives with no colour, container
       or price because the customer is bringing the vehicle to be measured.
       His «Definir» button opens the form at the bottom of this section.
    --------------------------------------------------------------------- */

    function paintSizeOf(order) {
        return PAINTS && order.size ? PAINTS.SIZES.filter(function (size) {
            return size.id === order.size;
        })[0] || null : null;
    }

    function finishLabel(finish) {
        return PAINTS && PAINTS.FINISHES[finish] ? PAINTS.FINISHES[finish].label : finish;
    }

    // The date, and the hour under it: an order placed this morning and one
    // from yesterday evening are different amounts of waiting at the counter.
    // Two lines rather than one so the column stays as narrow as the date.
    function buildDateTimeCell(row, iso) {
        var td = document.createElement("td");
        td.className = "staff-table__muted";
        var date = new Date(iso);
        if (isNaN(date.getTime())) {
            td.textContent = "—";
        } else {
            td.textContent = formatDate(iso);
            var time = document.createElement("div");
            time.className = "paint-time";
            time.textContent = pad(date.getHours()) + ":" + pad(date.getMinutes());
            td.appendChild(time);
        }
        row.appendChild(td);
    }

    // An in-person order the boss has not defined yet: no colour, nothing to
    // mix. Once defined it reads like any other row, with a note of where the
    // colour came from.
    function awaitingReading(order) {
        return order.method === "in_person" && !order.colorCode;
    }

    function buildPaintFilters() {
        var choices = [{ value: "", label: "Todos" }];
        PAINT_ORDER.forEach(function (value) {
            choices.push({ value: value, label: PAINT_FILTER_LABELS[value] || PAINT_LABELS[value] });
        });

        choices.forEach(function (choice) {
            var button = document.createElement("button");
            button.type = "button";
            button.className = "staff-chip";
            button.textContent = choice.label;
            button.setAttribute("aria-pressed", String(choice.value === paintStatusFilter));
            button.dataset.value = choice.value;
            button.addEventListener("click", function () {
                if (paintStatusFilter === choice.value) return;
                paintStatusFilter = choice.value;
                Array.prototype.forEach.call(paintFiltersEl.querySelectorAll(".staff-chip"), function (other) {
                    other.setAttribute("aria-pressed", String(other.dataset.value === paintStatusFilter));
                });
                // Filtered by the server, like the vehicles, for the same
                // reason: the old finished orders are capped there.
                loadPaintOrders();
            });
            paintFiltersEl.appendChild(button);
        });
    }

    function paintHaystack(order) {
        return [
            order.id,
            order.company,
            order.firstName,
            order.lastName,
            order.phone,
            order.brand,
            order.colorCode,
            order.colorName
        ].filter(Boolean).join(" ").toLowerCase();
    }

    var PAINT_STATUS = {
        order: PAINT_ORDER,
        labels: PAINT_LABELS,
        noun: "del pedido",
        patch: function (id, status) {
            return sendJson("PATCH", "/api/staff/paint-orders/" + id, { status: status },
                "No pudimos guardar el estado.");
        },
        lockedTitle: function () {
            return viewer.isBoss
                ? "El estado lo mueven los trabajadores"
                : "Inicia sesión para cambiar el estado";
        },
        saved: function (order, updated) {
            if (paintStatusFilter && paintStatusFilter !== updated.status) {
                loadPaintOrders();
                return;
            }
            // «N nuevos» on the tab counts the received ones, and «por
            // preparar» under the title the received and the ones in the works.
            paintTabs();
            applySearch();
        }
    };

    function canEditPaintStatus() {
        return !readOnly && !viewer.isBoss;
    }

    function buildColourCell(row, order) {
        var td = document.createElement("td");
        var wrap = document.createElement("div");
        wrap.className = "paint-colour";

        var swatch = document.createElement("span");
        swatch.className = "paint-colour__swatch";
        swatch.setAttribute("aria-hidden", "true");

        var text = document.createElement("div");
        text.className = "paint-colour__text";
        var name = document.createElement("span");
        name.className = "paint-colour__name";
        var meta = document.createElement("span");
        meta.className = "paint-colour__meta";

        if (awaitingReading(order)) {
            swatch.classList.add("paint-colour__swatch--pending");
            name.textContent = "Lectura en el taller";
            meta.textContent = "Trae el vehículo para medirlo";
        } else {
            // The hex is a hint of the colour and not a proof of the match: an
            // order with none gets the hatched swatch rather than a guess.
            if (order.hex) swatch.style.background = order.hex;
            else swatch.classList.add("paint-colour__swatch--unknown");
            name.textContent = order.colorName || "—";
            var code = document.createElement("span");
            code.className = "paint-colour__code";
            code.textContent = order.colorCode || "";
            meta.appendChild(code);
            if (order.brand) meta.appendChild(document.createTextNode(" · " + order.brand));
        }

        text.appendChild(name);
        text.appendChild(meta);
        wrap.appendChild(swatch);
        wrap.appendChild(text);

        // Picked by model and year, without reading the label: the counter
        // should check the vehicle before mixing.
        if (order.method === "model") {
            var tag = document.createElement("span");
            tag.className = "paint-colour__tag";
            tag.textContent = "Confirmar";
            tag.title = "El cliente eligió el color por modelo y año, sin leer la etiqueta";
            wrap.appendChild(tag);
        } else if (order.method === "in_person" && !awaitingReading(order)) {
            var read = document.createElement("span");
            read.className = "paint-colour__tag paint-colour__tag--read";
            read.textContent = "Medido";
            read.title = "Color leído en el taller";
            wrap.appendChild(read);
        }

        // The boss's button, on the orders read at the counter only: the
        // others were quoted on screen and are not his to rewrite.
        if (viewer.isBoss && order.method === "in_person") {
            var define = document.createElement("button");
            define.type = "button";
            define.className = "paint-colour__define";
            define.textContent = awaitingReading(order) ? "Definir" : "Editar";
            define.setAttribute("aria-label", (awaitingReading(order) ? "Definir" : "Editar")
                + " el pedido de " + (order.company || "este taller"));
            define.addEventListener("click", function () { openPaintDefine(order, define); });
            wrap.appendChild(define);
        }

        td.appendChild(wrap);
        row.appendChild(td);
    }

    function makePaintRow(order) {
        var row = document.createElement("tr");
        if (viewer.isBoss) cell(row, order.id, "staff-table__code");

        var who = document.createElement("td");
        var company = document.createElement("div");
        company.className = "paint-who__company";
        company.textContent = order.company || "—";
        var person = document.createElement("div");
        person.className = "paint-who__person";
        person.textContent = [order.firstName, order.lastName].filter(Boolean).join(" ");
        who.appendChild(company);
        who.appendChild(person);
        if (order.notes) who.title = order.notes;
        row.appendChild(who);

        cell(row, order.phone, "staff-table__nowrap");
        buildColourCell(row, order);
        cell(row, order.finish ? finishLabel(order.finish) : "", "staff-table__nowrap");

        var size = paintSizeOf(order);
        var sizeTd = document.createElement("td");
        sizeTd.className = "staff-table__nowrap";
        if (size) {
            var sizeLine = document.createElement("div");
            sizeLine.className = "paint-size";
            sizeLine.textContent = size.label + (order.units > 1 ? " × " + order.units : "");
            var volume = document.createElement("div");
            volume.className = "paint-size__volume";
            volume.textContent = size.volume + (order.units > 1 ? " c/u" : "");
            sizeTd.appendChild(sizeLine);
            sizeTd.appendChild(volume);
        } else {
            sizeTd.textContent = "—";
        }
        row.appendChild(sizeTd);

        cell(row, order.price == null ? "" : "S/ " + order.price, "staff-table__num");
        buildDateTimeCell(row, order.createdAt);
        buildStatusCell(row, order, canEditPaintStatus(), PAINT_STATUS);

        order.row = row;
        return row;
    }

    function renderPaint() {
        closeMenu(false);
        paintRowsEl.textContent = "";
        allPaintOrders.forEach(function (order) {
            paintRowsEl.appendChild(makePaintRow(order));
        });
        applySearch();
    }

    // The counts on the two tabs. The vehicles' is what the table holds; the
    // matizado one adds how many orders nobody has opened yet.
    function paintTabs() {
        tabVehiclesCountEl.textContent = String(allRequests.length);
        tabPaintCountEl.textContent = paintLoaded ? String(allPaintOrders.length) : "";
        var fresh = allPaintOrders.filter(function (order) { return order.status === "recibido"; }).length;
        tabPaintNewEl.textContent = fresh === 1 ? "1 nuevo" : fresh + " nuevos";
        show(tabPaintNewEl, fresh > 0);
    }

    function setPanelTab(tab, focus) {
        if (panelTab === tab) return;
        panelTab = tab;
        closeMenu(false);
        paintView();
        applySearch();
        if (focus) (tab === "paint" ? tabPaintEl : tabVehiclesEl).focus();
        // Asked again on every visit: the vehicle table is refreshed by its own
        // clicks, while an order placed on the website arrives on its own.
        if (tab === "paint") loadPaintOrders();
    }

    tabVehiclesEl.addEventListener("click", function () { setPanelTab("vehicles", false); });
    tabPaintEl.addEventListener("click", function () { setPanelTab("paint", false); });

    // Arrow keys between the two tabs, as a tablist is expected to do.
    [tabVehiclesEl, tabPaintEl].forEach(function (tab) {
        tab.addEventListener("keydown", function (event) {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            setPanelTab(panelTab === "paint" ? "vehicles" : "paint", true);
        });
    });

    function loadPaintOrders() {
        var query = paintStatusFilter ? "?status=" + encodeURIComponent(paintStatusFilter) : "";
        return fetch(API_BASE + "/api/staff/paint-orders" + query, { credentials: "same-origin" })
            .then(function (response) {
                return response.json().catch(function () { return null; }).then(function (body) {
                    if (response.status === 401) {
                        showLogin();
                        return;
                    }
                    if (!response.ok) {
                        throw new Error((body && body.error) || "No pudimos cargar los pedidos de matizado.");
                    }
                    allPaintOrders = (body && body.orders) || [];
                    allPaintOrders.forEach(function (order) {
                        order.searchText = paintHaystack(order);
                    });
                    paintLoaded = true;
                    paintTabs();
                    renderPaint();
                });
            })
            .catch(function (err) {
                setError(err instanceof TypeError ? NETWORK_MESSAGE : err.message);
            });
    }

    // PATCH and PUT with a JSON body, and the same reading of the answer as
    // patchStatus: a 401 is flagged so the caller can bring the login back.
    function sendJson(method, path, payload, fallback) {
        return fetch(API_BASE + path, {
            method: method,
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify(payload)
        }).then(function (response) {
            return response.json().catch(function () { return null; }).then(function (body) {
                if (!response.ok) {
                    var error = new Error((body && body.error) || fallback);
                    if (response.status === 401) error.unauthorized = true;
                    throw error;
                }
                return body;
            });
        }, function () {
            throw new Error(NETWORK_MESSAGE);
        });
    }

    /* --- the boss's form: defining an order read at the counter --- */

    var defineOrder = null;
    var defineTrigger = null;
    // Whether the boss typed the price himself. Until he does, it follows the
    // price list (container × finish × units); after, it is his and stays.
    var definePriceTouched = false;

    function fillDefineChoices() {
        if (!PAINTS) return;
        Object.keys(PAINTS.FINISHES).forEach(function (id) {
            var option = document.createElement("option");
            option.value = id;
            option.textContent = PAINTS.FINISHES[id].label;
            defineFinishEl.appendChild(option);
        });
        PAINTS.SIZES.forEach(function (size) {
            var option = document.createElement("option");
            option.value = size.id;
            option.textContent = size.label + " (" + size.volume + ")";
            defineSizeEl.appendChild(option);
        });
        Object.keys(PAINTS.BRAND_NAMES).forEach(function (id) {
            var option = document.createElement("option");
            option.value = PAINTS.BRAND_NAMES[id];
            defineBrandsEl.appendChild(option);
        });
        defineUnitsEl.max = String(PAINTS.MAX_UNITS);
    }

    // The price list's total for what is on the form, or null when the form
    // does not describe a container yet.
    function listPrice() {
        if (!PAINTS) return null;
        var each = PAINTS.price(defineSizeEl.value, defineFinishEl.value);
        var units = parseInt(defineUnitsEl.value, 10);
        if (each == null || !(units >= 1)) return null;
        return each * units;
    }

    function syncDefinePrice() {
        var suggested = listPrice();
        definePriceHintEl.textContent = suggested == null
            ? ""
            : "Según la lista de precios: S/ " + suggested + ". Puedes cambiarlo.";
        if (!definePriceTouched && suggested != null) definePriceEl.value = String(suggested);
    }

    function openPaintDefine(order, trigger) {
        defineOrder = order;
        defineTrigger = trigger;
        definePriceTouched = order.price != null;

        defineSubtitleEl.textContent = [order.company,
            [order.firstName, order.lastName].filter(Boolean).join(" "), order.id]
            .filter(Boolean).join(" · ");
        defineBrandEl.value = order.brand || "";
        defineCodeEl.value = order.colorCode || "";
        defineNameEl.value = order.colorName || "";
        defineFinishEl.value = order.finish || "metalico";
        defineSizeEl.value = order.size || "1_4";
        defineUnitsEl.value = String(order.units || 1);
        definePriceEl.value = order.price == null ? "" : String(order.price);
        defineHexOnEl.checked = !!order.hex;
        if (order.hex) defineHexEl.value = order.hex;
        defineErrorEl.hidden = true;
        syncDefinePrice();

        show(defineEl, true);
        defineBrandEl.focus();
    }

    function closePaintDefine(restoreFocus) {
        if (defineEl.hidden) return;
        show(defineEl, false);
        defineOrder = null;
        if (restoreFocus && defineTrigger && defineTrigger.isConnected) defineTrigger.focus();
        defineTrigger = null;
    }

    function defineProblem() {
        if (!defineBrandEl.value.trim()) return [defineBrandEl, "Escribe la marca."];
        if (!defineCodeEl.value.trim()) return [defineCodeEl, "Escribe el código del color."];
        if (!defineNameEl.value.trim()) return [defineNameEl, "Escribe el nombre del color."];
        var units = Number(defineUnitsEl.value);
        if (!Number.isInteger(units) || units < 1 || units > Number(defineUnitsEl.max || 20)) {
            return [defineUnitsEl, "Las unidades van de 1 a " + (defineUnitsEl.max || 20) + "."];
        }
        var price = Number(definePriceEl.value);
        if (definePriceEl.value === "" || !Number.isInteger(price) || price < 0) {
            return [definePriceEl, "Escribe el precio en soles, sin decimales."];
        }
        return null;
    }

    defineHexEl.addEventListener("input", function () { defineHexOnEl.checked = true; });
    defineFinishEl.addEventListener("change", syncDefinePrice);
    defineSizeEl.addEventListener("change", syncDefinePrice);
    defineUnitsEl.addEventListener("input", syncDefinePrice);
    definePriceEl.addEventListener("input", function () { definePriceTouched = definePriceEl.value !== ""; });

    defineFormEl.addEventListener("submit", function (event) {
        event.preventDefault();
        if (!defineOrder) return;
        var problem = defineProblem();
        if (problem) {
            defineErrorEl.textContent = problem[1];
            defineErrorEl.hidden = false;
            problem[0].focus();
            return;
        }

        var order = defineOrder;
        defineSaveEl.disabled = true;
        defineSaveEl.textContent = "Guardando…";
        defineErrorEl.hidden = true;

        sendJson("PUT", "/api/staff/paint-orders/" + order.id + "/definition", {
            brand: defineBrandEl.value.trim(),
            colorCode: defineCodeEl.value.trim().toUpperCase(),
            colorName: defineNameEl.value.trim(),
            finish: defineFinishEl.value,
            hex: defineHexOnEl.checked ? defineHexEl.value : null,
            size: defineSizeEl.value,
            units: Number(defineUnitsEl.value),
            price: Number(definePriceEl.value)
        }, "No pudimos guardar el pedido.")
            .then(function (updated) {
                // The copy in memory takes the answer, and the row is rebuilt
                // from it: the colour cell, the container and the price all
                // change at once.
                Object.keys(updated).forEach(function (key) { order[key] = updated[key]; });
                order.searchText = paintHaystack(order);
                if (order.row && order.row.parentNode) {
                    var old = order.row;
                    old.parentNode.replaceChild(makePaintRow(order), old);
                    applySearch();
                }
                closePaintDefine(false);
                var button = order.row && order.row.querySelector(".paint-colour__define");
                if (button) button.focus();
            })
            .catch(function (err) {
                if (err.unauthorized) {
                    closePaintDefine(false);
                    showLogin();
                    setError("Tu sesión venció. Vuelve a entrar para guardar el pedido.");
                    return;
                }
                defineErrorEl.textContent = err.message;
                defineErrorEl.hidden = false;
            })
            .then(function () {
                defineSaveEl.disabled = false;
                defineSaveEl.textContent = "Guardar";
            });
    });

    defineCloseEl.addEventListener("click", function () { closePaintDefine(true); });
    defineCancelEl.addEventListener("click", function () { closePaintDefine(true); });
    defineBackdropEl.addEventListener("click", function () { closePaintDefine(true); });
    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && !defineEl.hidden) closePaintDefine(true);
    });

    fillDefineChoices();

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
        show(intakeEl, view === "intake");
        show(panelEl, view === "panel");

        // El botón de arriba a la derecha dice en cada pantalla lo que hace.
        // Solo en la ficha cierra la sesión; desde la tabla nunca se sale del
        // todo, se vuelve a la ficha —y la sesión sigue abierta, que es lo que
        // deja entrar otra vez sin la contraseña—. En modo consulta ni siquiera
        // se había empezado un turno: ahí lo único que cabe es volver.
        show(logoutBtn, view !== "login");
        logoutBtn.textContent = view === "login" || view === "profile"
            ? "Salir"
            : view === "panel" && !readOnly ? "Terminar sesión" : "Volver al perfil";
        if (view === "login") stopClock();
        else startClock();

        // The monitor repaints itself only while on screen, and not outside it:
        // somebody back on their profile does not need the occupancy asked of
        // the server every half minute.
        if (view === "monitor") startMonitorTimer();
        else stopMonitorTimer();

        // Leaving the walk-in form takes the 3D viewer with it. Its model is
        // tens of megabytes on the GPU, and nothing off that screen can see it.
        if (view !== "intake") destroyIntake3d();
        // And leaving the table takes the parts viewer, for the same reason
        // and one more: that one turns, so it would go on drawing frame after
        // frame behind a screen nobody is looking at.
        if (view !== "panel") closePartsView(false);

        // The header of the code column, which the rows either carry or do not
        // (see makeRow). Both read the same `viewer.isBoss`, and both are
        // repainted by the same answer from the server.
        show(codeHeadEl, !!viewer.isBoss);
        show(paintCodeHeadEl, !!viewer.isBoss);

        // The switch above the title, and everything that belongs to one table
        // or the other: its card, its filters, its title and its search hint.
        var onPaint = panelTab === "paint";
        tabVehiclesEl.setAttribute("aria-selected", String(!onPaint));
        tabPaintEl.setAttribute("aria-selected", String(onPaint));
        tabVehiclesEl.tabIndex = onPaint ? -1 : 0;
        tabPaintEl.tabIndex = onPaint ? 0 : -1;
        show(vehiclesCardEl, !onPaint);
        show(paintCardEl, onPaint);
        show(filtersEl, !onPaint);
        show(paintFiltersEl, onPaint);
        panelTitleEl.textContent = onPaint ? "Pedidos de matizado" : "Vehículos en el taller";
        searchEl.placeholder = onPaint
            ? "Buscar por taller, color o código…"
            : "Buscar por placa, cliente o código…";
        if (view !== "panel") closePaintDefine(false);

        show(readOnlyEl, view === "panel" && readOnly);
        // For the boss the table is for looking at and nothing else: there is no
        // working mode to switch into, so the notice says so and loses its
        // button. The server would refuse the change anyway (see refuseBoss in
        // server/server.js); this is about not offering what cannot be done.
        readOnlyTextEl.textContent = viewer.isBoss
            ? (onPaint
                ? "Defines el color y el precio de los pedidos que se leen en el taller; el estado lo mueven los trabajadores."
                : "El jefe del taller ve las solicitudes, pero no toma vehículos ni les cambia el estado.")
            : (onPaint
                ? "Estás viendo los pedidos sin iniciar sesión: no puedes cambiarles el estado."
                : "Estás viendo las solicitudes sin iniciar sesión: no puedes tomar vehículos ni cambiarles el estado.");
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
        renderPaint();
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
        show(profileIntakeBtn, !!viewer.isBoss);
        show(profileEnterBtn, !viewer.isBoss);

        // What the boss wrote for whoever is looking, above their own notepad.
        // The card disappears entirely when there is nothing: an empty «Nota del
        // jefe» box on every profile would read as something gone missing.
        show(bossNoteEl, !!viewer.note);
        if (viewer.note) {
            bossNoteTextEl.textContent = viewer.note.text;
            bossNoteDateEl.textContent = formatDate(viewer.note.updatedAt);
        }

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
    profileIntakeBtn.addEventListener("click", showIntake);
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

    // The same ceiling the column CHECKs and the route enforces (MAX_NOTE in
    // server/server.js). Here it only spares the round trip.
    var NOTE_MAX = 500;

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
        } else {
            var list = document.createElement("ul");
            list.className = "staff-monitor__vehicles";
            worker.requests.forEach(function (request) {
                list.appendChild(monitorVehicle(request));
            });
            card.appendChild(list);
        }

        // Third column, so it cannot land on top of a status badge the way a
        // corner button would.
        card.appendChild(buildNoteMenu(worker, card));

        // What he already told this person, across the foot of the card. On the
        // card and not behind the menu: the point of the board is what can be
        // read without clicking.
        if (worker.note) {
            var note = document.createElement("p");
            note.className = "staff-monitor__note";

            var noteText = document.createElement("span");
            noteText.textContent = worker.note.text;
            note.appendChild(noteText);

            var noteDate = document.createElement("span");
            noteDate.className = "staff-monitor__note-date";
            noteDate.textContent = formatDate(worker.note.updatedAt);
            note.appendChild(noteDate);

            card.appendChild(note);
        }

        return card;
    }

    /* ---------------------------------------------------------------------
       The note the boss leaves on a worker

       One per worker, replaced when he writes another (see worker_notes in
       server/schema.sql). The worker reads it on their own profile and cannot
       change it; this is the only place it is written.
    --------------------------------------------------------------------- */

    // Which worker's editor is open, if any. Only one at a time: two open
    // textareas invite writing in one and saving the other.
    var noteEditorFor = "";

    // While an editor is open the half-minute refresh is off. It repaints the
    // whole list, which would throw away whatever was half-typed — and the
    // board being thirty seconds stale matters less than losing a sentence.
    function holdMonitorRefresh(open) {
        noteEditorFor = open;
        // «Actualizar» repaints the same list, so it waits for the editor too.
        // Left enabled it looked like it worked and did nothing.
        monitorRefreshBtn.disabled = !!open;
        if (open) stopMonitorTimer();
        else if (view === "monitor") startMonitorTimer();
    }

    function buildNoteMenu(worker, card) {
        var dots = document.createElement("button");
        dots.type = "button";
        dots.className = "staff-monitor__more";
        dots.setAttribute("aria-haspopup", "menu");
        dots.setAttribute("aria-expanded", "false");
        dots.setAttribute("aria-label", "Nota para " + (worker.name || worker.workerId));
        dots.textContent = "…";

        var menu = document.createElement("div");
        menu.className = "staff-cardmenu";
        menu.setAttribute("role", "menu");
        menu.hidden = true;

        function item(label, onPick) {
            var option = document.createElement("button");
            option.type = "button";
            option.className = "staff-cardmenu__option";
            option.setAttribute("role", "menuitem");
            option.textContent = label;
            option.addEventListener("click", function () {
                closeMenu(false);
                onPick();
            });
            menu.appendChild(option);
            return option;
        }

        item(worker.note ? "Editar nota" : "Escribir nota", function () {
            openNoteEditor(card, worker);
        });
        // Nothing to remove when nothing was written.
        if (worker.note) {
            item("Quitar nota", function () { putNote(worker, "", card); });
        }

        function options() {
            return menu.querySelectorAll(".staff-cardmenu__option");
        }

        // The same arrow-key walk as the status menu, with the same wrap.
        function move(step) {
            var list = Array.prototype.slice.call(options());
            var index = list.indexOf(document.activeElement);
            if (index === -1) index = 0;
            else index = (index + step + list.length) % list.length;
            list[index].focus();
        }

        function open() {
            closeMenu(false);
            menu.hidden = false;          // visible before it can be measured
            placeMenu(dots, menu);
            dots.setAttribute("aria-expanded", "true");
            // Registered the way the status pill does, so the document-level
            // click, Escape, arrows, scroll and resize handlers already written
            // for that menu close this one too.
            openMenu = { pill: dots, menu: menu, move: move };
            options()[0].focus();
        }

        dots.addEventListener("click", function () {
            if (openMenu && openMenu.pill === dots) closeMenu(true);
            else open();
        });

        dots.addEventListener("keydown", function (event) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                open();
            }
        });

        var wrap = document.createElement("div");
        wrap.className = "staff-monitor__menu";
        wrap.appendChild(dots);
        wrap.appendChild(menu);
        return wrap;
    }

    function openNoteEditor(card, worker) {
        // One editor on the whole board, not one per card: noteEditorFor tracks
        // a single worker, so a second open editor was released by the first
        // one's Cancel and then wiped by the next refresh, typed text and all.
        var already = monitorListEl.querySelector(".staff-noteedit");
        if (already) {
            already.querySelector("textarea").focus();
            return;
        }

        holdMonitorRefresh(worker.workerId);

        var box = document.createElement("div");
        box.className = "staff-noteedit";

        var label = document.createElement("label");
        label.className = "staff-noteedit__title";
        label.textContent = "Nota para " + (worker.name || worker.workerId);
        var fieldId = "noteFor" + worker.workerId;
        label.setAttribute("for", fieldId);
        box.appendChild(label);

        var input = document.createElement("textarea");
        input.className = "staff-noteedit__input";
        input.id = fieldId;
        input.rows = 3;
        input.maxLength = NOTE_MAX;
        input.placeholder = "Lo que tiene que saber…";
        input.value = worker.note ? worker.note.text : "";
        box.appendChild(input);

        var actions = document.createElement("div");
        actions.className = "staff-noteedit__actions";

        var save = document.createElement("button");
        save.type = "button";
        save.className = "staff-noteedit__save";
        save.textContent = "Guardar";
        save.addEventListener("click", function () {
            save.disabled = true;
            save.textContent = "Guardando…";
            putNote(worker, input.value, card, save);
        });
        actions.appendChild(save);

        var cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "staff-noteedit__cancel";
        cancel.textContent = "Cancelar";
        cancel.addEventListener("click", function () {
            box.remove();
            holdMonitorRefresh("");
        });
        actions.appendChild(cancel);

        box.appendChild(actions);
        card.appendChild(box);
        input.focus();
    }

    // Writes the note, or removes it when the text is empty — the same request
    // either way, which is why the route is a PUT.
    function putNote(worker, note, card, save) {
        setError("");
        // On failure the editor stays open with the text in it and Save usable
        // again, so the note can be retried; the refresh stays held so the text
        // survives until then.
        function reopen() {
            save.disabled = false;
            save.textContent = "Guardar";
        }
        fetch(API_BASE + "/api/staff/workers/" + encodeURIComponent(worker.workerId) + "/note", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ note: note })
        })
            .then(function (response) {
                return response.json().catch(function () { return null; }).then(function (body) {
                    if (response.status === 401) {
                        // The editor goes with the session. Leaving
                        // noteEditorFor set froze the monitor after logging
                        // back in: every refresh saw an editor and skipped.
                        var stale = card.querySelector(".staff-noteedit");
                        if (stale) stale.remove();
                        holdMonitorRefresh("");
                        showLogin();
                        setError("Tu sesión venció. Vuelve a entrar.");
                        return;
                    }
                    if (!response.ok) {
                        throw new Error((body && body.error) || "No pudimos guardar la nota.");
                    }
                    // The editor closes and the board is asked again, so what
                    // ends up on screen is what the server stored and not what
                    // the browser hoped it stored.
                    var open = card.querySelector(".staff-noteedit");
                    if (open) open.remove();
                    holdMonitorRefresh("");
                    loadWorkers();
                });
            })
            .catch(function (err) {
                reopen();
                setError(err instanceof TypeError ? NETWORK_MESSAGE : err.message);
            });
    }

    function renderWorkers(workers) {
        // An open editor means somebody is typing into this list. Rebuilding it
        // would take the textarea away mid-sentence. The timer and «Actualizar»
        // are both off while the editor is open (see holdMonitorRefresh); this
        // guard covers an answer that was already on its way when it opened.
        if (noteEditorFor) return;

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

    /* ---------------------------------------------------------------------
       Registering a walk-in vehicle

       A car driven to the shop instead of booked through the website. It
       becomes the same kind of row as any other — the queue does not care how
       one arrived — but the form asks fewer things than the website, because
       the customer is at the counter. Nothing can be edited afterwards, so
       everything it asks for except the notes is required.

       The checks here are the same ones the server applies (validateRequest in
       server/server.js), repeated so a missing field costs nothing. The server
       is still the one that decides: its message is what gets shown when
       something slips through.
    --------------------------------------------------------------------- */

    // The four 3D silhouettes the workshop paints on, which is what the
    // `vehicle` column stores. The website derives this from the body type the
    // customer picks out of the catalogue; here it is picked directly, because
    // the boss is looking at the car.
    var VEHICLE_CHOICES = [
        { value: "wagon", label: "Sedán / Familiar" },
        { value: "suv", label: "SUV" },
        { value: "pickup", label: "Pickup" },
        { value: "van", label: "Furgoneta" }
    ];

    var PLATE_RE = /^[A-Z0-9]{3}-[A-Z0-9]{3}$/;

    // Peruvian plate: three characters, a dash, three more (ABC-123). The
    // field puts the dash in as you type, the same as the public wizard, so
    // the boss only types the six characters.
    if (intakePlateEl) {
        intakePlateEl.addEventListener("input", function () {
            var raw = intakePlateEl.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
            var formatted = raw.length > 3 ? raw.slice(0, 3) + "-" + raw.slice(3) : raw;
            if (formatted !== intakePlateEl.value) intakePlateEl.value = formatted;
        });
    }
    var EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

    var intakeVehicle = "";
    var intakeQuality = "";

    // A row of buttons that behaves like a radio group: one pressed at a time,
    // announced as such. Built rather than written out because the two lists it
    // draws already exist in the page's own vocabularies.
    function buildChoices(container, choices, onPick) {
        var buttons = [];
        choices.forEach(function (choice) {
            var button = document.createElement("button");
            button.type = "button";
            button.className = "staff-intake__choice";
            button.setAttribute("role", "radio");
            button.setAttribute("aria-checked", "false");
            button.textContent = choice.label;
            button.addEventListener("click", function () {
                buttons.forEach(function (other) {
                    other.setAttribute("aria-checked", String(other === button));
                });
                onPick(choice.value);
            });
            button.dataset.value = choice.value;
            buttons.push(button);
            container.appendChild(button);
        });
        return {
            clear: function () {
                buttons.forEach(function (button) { button.setAttribute("aria-checked", "false"); });
            },
            // Marks one from the outside, without pretending it was clicked:
            // the caller already knows the value it is setting.
            select: function (value) {
                buttons.forEach(function (button) {
                    button.setAttribute("aria-checked", String(button.dataset.value === value));
                });
            }
        };
    }

    var vehicleChoice = buildChoices(intakeVehicleEl, VEHICLE_CHOICES, function (value) {
        intakeVehicle = value;
        // The silhouette is what decides which model the picker loads, so the
        // viewer follows the choice rather than sitting there empty.
        mountIntake3d(value);
    });

    // The same three the website offers, from the same map the table reads.
    var qualityChoice = buildChoices(
        intakeQualityEl,
        Object.keys(QUALITY_LABELS).map(function (value) {
            return { value: value, label: QUALITY_LABELS[value] };
        }),
        function (value) {
            intakeQuality = value;
            // Every price in the parts summary depends on the finish.
            renderIntakeParts();
        }
    );

    // Brand and model, cascading, out of the same catalogue the website uses.
    // Both are required (see firstIntakeProblem and WALK_IN_REQUIRED), so the
    // empty first option is a prompt, not a choice.
    function buildBrandOptions() {
        var catalog = window.CAR_CATALOG;
        if (!catalog) return;                 // carModels.js did not load
        intakeBrandEl.appendChild(new Option("Elige la marca", ""));
        catalog.brands.forEach(function (brand) {
            intakeBrandEl.appendChild(new Option(brand.name, brand.id));
        });
        intakeBrandEl.addEventListener("change", function () {
            buildModelOptions(intakeBrandEl.value);
            syncVehicleToModel();
        });
        intakeModelEl.addEventListener("change", syncVehicleToModel);
    }

    function buildModelOptions(brandId) {
        intakeModelEl.textContent = "";
        var catalog = window.CAR_CATALOG;
        var brand = brandId && catalog ? catalog.findBrand(brandId) : null;
        intakeModelEl.appendChild(new Option("Elige el modelo", ""));
        intakeModelEl.disabled = !brand;
        if (!brand) return;
        brand.models.forEach(function (model) {
            intakeModelEl.appendChild(new Option(model.name, model.id));
        });
    }

    // Choosing a model settles which silhouette the workshop paints on: the
    // catalogue has eight body types over four 3D models, and the mapping is the
    // same one the website uses (BODY_TYPES in src/carModels.js). Without this
    // the boss could file a Fiesta as a pickup by picking both halves, and the
    // parts of one would not exist on the other. He can still tap another
    // silhouette afterwards: this sets the obvious answer, it does not lock it.
    function syncVehicleToModel() {
        var catalog = window.CAR_CATALOG;
        var car = chosenCar();
        if (!catalog || !car.bodyType) return;
        var body = catalog.bodyTypes[car.bodyType];
        if (!body || !body.vehicle) return;
        if (intakeVehicle !== body.vehicle) mountIntake3d(body.vehicle);
        intakeVehicle = body.vehicle;
        vehicleChoice.select(body.vehicle);
    }

    /* ---------------------------------------------------------------------
       The 3D part picker, inside the walk-in form

       The very same viewer the customer's wizard mounts (mountCar3D in
       src/carVisual.js), against the silhouette chosen above it. Not a second
       implementation and not a checkbox list: the ids a panel goes by come out
       of each GLB, and a list written by hand would be a fourth place to keep
       them in step with the models.

       The module is an ES module and reaches three.js through the importmap in
       pgs/taller.html. It is pulled in with a dynamic import() the first time a
       silhouette is picked, so a panel that never registers a vehicle never
       fetches three.js at all.

       At least one panel is required to register, the same as on the website
       (WALK_IN_REQUIRED in server/server.js). Picking a different silhouette
       still empties the selection — an id from the pickup does not exist on
       the van — so a boss who changes the model after choosing panels is
       asked for them again rather than sent on with panels nobody can point
       at.
    --------------------------------------------------------------------- */

    // The panel names and the prices are read from PARTS and partLabel, which
    // are declared at the top of this file: the parts viewer in the table
    // needs the labels too, and one lookup cannot disagree with itself.

    var intakeParts = [];
    var intake3d = null;         // the mounted viewer, if any
    var intake3dVehicle = null;  // which silhouette it is mounted for
    var intake3dMountId = 0;     // guards a superseded mount finishing last

    function toggleIntakePart(id) {
        var at = intakeParts.indexOf(id);
        if (at === -1) intakeParts.push(id);
        else intakeParts.splice(at, 1);
        if (intake3d) intake3d.refreshSelection();
        renderIntakeParts();
    }

    function renderIntakeParts() {
        intake3dListEl.textContent = "";
        if (intakeParts.length === 0) {
            var empty = document.createElement("li");
            empty.className = "car-view-3d__empty";
            empty.textContent = "Ninguna pieza seleccionada.";
            intake3dListEl.appendChild(empty);
        } else {
            intakeParts.forEach(function (id) {
                var label = partLabel(id);
                var item = document.createElement("li");
                item.className = "car-view-3d__list-item";

                var name = document.createElement("span");
                name.className = "car-view-3d__list-item-name";
                name.textContent = label;
                item.appendChild(name);


                var remove = document.createElement("button");
                remove.type = "button";
                remove.className = "car-view-3d__list-item-remove";
                remove.setAttribute("aria-label", "Quitar " + label);
                remove.textContent = "✕";
                remove.addEventListener("click", function () { toggleIntakePart(id); });
                item.appendChild(remove);

                intake3dListEl.appendChild(item);
            });
        }
        intake3dCountEl.textContent = intakeParts.length + (intakeParts.length === 1 ? " pieza" : " piezas");
        intake3dClearEl.disabled = intakeParts.length === 0;
        renderIntakeQuote();
    }

    // The counter's quote. Not the customer's estimate from the wizard, which
    // walks someone through a price with a subtotal, a discount line and a
    // hint: at the counter the boss needs the number to say out loud. So every
    // finish's total is on screen at once, discount already taken off, the one
    // picked is marked, and tapping another picks it — the customer asks
    // "¿y el más barato?" and the answer is already there. One line under it
    // says which discount is in the figures. Same prices and steps as the
    // wizard (src/parts.js), so the two never quote differently.
    function renderIntakeQuote() {
        var hasParts = PARTS !== null && intakeParts.length > 0;
        show(intakeQuoteEl, hasParts);
        if (!hasParts) return;

        intakeQuoteFinishesEl.textContent = "";
        var count = 0;
        Object.keys(PARTS.QUALITY_NAMES).forEach(function (quality) {
            var result = PARTS.estimate(intakeParts, quality);
            count = result.priced;
            var picked = quality === intakeQuality;
            var name = PARTS.QUALITY_NAMES[quality];
            var total = PARTS.formatSoles(result.total);

            var row = document.createElement("button");
            row.type = "button";
            row.className = "intake-quote__finish";
            row.setAttribute("aria-pressed", String(picked));
            row.setAttribute("aria-label", name + ", " + total);
            var label = document.createElement("span");
            label.textContent = name;
            var amount = document.createElement("strong");
            amount.textContent = total;
            row.appendChild(label);
            row.appendChild(amount);
            row.dataset.quality = quality;
            row.addEventListener("click", function () {
                intakeQuality = quality;
                qualityChoice.select(quality);
                renderIntakeParts();
                // The rows are rebuilt, so focus goes back to the new one.
                var again = intakeQuoteFinishesEl.querySelector('[data-quality="' + quality + '"]');
                if (again) again.focus();
            });
            intakeQuoteFinishesEl.appendChild(row);
        });

        var rate = PARTS.discountRate(count);
        intakeQuoteDiscountEl.textContent = rate
            ? "Incluye " + rate + "% por " + count + " piezas"
            : "Sin descuento (1 pieza)";
    }

    // A canvas is single-use: tearing a viewer down drops its WebGL context
    // (see destroy() in src/carVisual.js), so the next silhouette gets a fresh
    // element to draw into. Same dance as src/repair.js.
    function replaceIntakeCanvas() {
        var fresh = document.createElement("canvas");
        fresh.id = intake3dCanvasEl.id;
        fresh.className = intake3dCanvasEl.className;
        intake3dCanvasWrapEl.replaceChild(fresh, intake3dCanvasEl);
        intake3dCanvasEl = fresh;
    }

    // Puts the loading overlay back the way a fresh mount expects it: a
    // previous viewer leaves it faded out, and an earlier failure leaves an
    // error where the progress bar belongs.
    function resetIntakeOverlay() {
        intake3dOverlayEl.classList.remove("hidden");
        intake3dProgressBarEl.style.width = "0%";
        if (intake3dProgressBarEl.parentElement) intake3dProgressBarEl.parentElement.style.display = "";
        intake3dLoadingLabelEl.hidden = false;
        intake3dLoadingLabelEl.textContent = "Cargando modelo 3D…";
        intake3dErrorEl.hidden = true;
        intake3dErrorEl.textContent = "";
    }

    function showIntake3dError(message) {
        intake3dOverlayEl.classList.remove("hidden");
        intake3dLoadingLabelEl.hidden = true;
        if (intake3dProgressBarEl.parentElement) intake3dProgressBarEl.parentElement.style.display = "none";
        intake3dErrorEl.textContent = message;
        intake3dErrorEl.hidden = false;
    }

    function destroyIntake3d() {
        // Bumped first, and not only when there is a viewer to tear down: a
        // mount still waiting on its import has nothing for `destroy()` to
        // reach, and without this its handler would pass the mountId check and
        // build the viewer anyway — onto a screen nobody is looking at, where
        // a WebGL context and a render loop would sit until the form is opened
        // again. Leaving the screen mid-load is the ordinary way to hit it:
        // the module, three.js and a GLB of tens of megabytes take a while on
        // a phone, and «Cancelar» is right there.
        intake3dMountId++;
        if (intake3d) {
            intake3d.destroy();
            intake3d = null;
            replaceIntakeCanvas();
        }
        intake3dVehicle = null;
    }

    // Called whenever the silhouette changes. Each one is its own model, so the
    // viewer is rebuilt rather than reused, and the panels already picked are
    // dropped: an id from the pickup does not exist on the van, and keeping it
    // would send the workshop a part nobody can point at.
    function mountIntake3d(vehicle) {
        show(intakePartsEl, !!vehicle);
        if (!vehicle) {
            destroyIntake3d();
            return;
        }
        if (intake3dVehicle === vehicle && intake3d && !intake3d.loadFailed()) {
            intake3d.resize();
            return;
        }

        destroyIntake3d();
        intakeParts = [];
        renderIntakeParts();
        intake3dVehicle = vehicle;
        resetIntakeOverlay();

        // The module is fetched once — by loadCar3d, shared with the parts
        // viewer of the table — and only the viewer inside it is rebuilt per
        // silhouette.
        var mountId = ++intake3dMountId;
        var canvasEl = intake3dCanvasEl;

        // Two handlers and not a trailing .catch(): the second argument to
        // then() sees the import's own rejection and nothing else, which keeps
        // a module that failed to DOWNLOAD apart from one that downloaded and
        // then failed to MOUNT. They want opposite things — one needs the
        // cached promise thrown away, the other needs it kept — and a trailing
        // .catch() would catch both and treat them as the first.
        loadCar3d().then(function (mod) {
            // A later choice already claimed the canvas while this import was
            // in flight, so this mount has nothing left to draw into.
            if (mountId !== intake3dMountId) return;
            try {
                intake3d = mod.mountCar3D({
                    vehicle: vehicle,
                    canvasEl: canvasEl,
                    canvasWrapEl: intake3dCanvasWrapEl,
                    overlayEl: intake3dOverlayEl,
                    progressBarEl: intake3dProgressBarEl,
                    loadingLabelEl: intake3dLoadingLabelEl,
                    errorEl: intake3dErrorEl,
                    buttonsEl: intake3dButtonsEl,
                    isPartSelected: function (id) { return intakeParts.indexOf(id) !== -1; },
                    onPartToggle: toggleIntakePart
                });
            } catch (err) {
                // The file arrived; building the viewer is what failed —
                // typically a phone that will not hand out another WebGL
                // context. The cached module stays: refetching something that
                // downloaded perfectly well costs a few hundred kilobytes and
                // fixes nothing.
                intake3dVehicle = null;
                console.error("[taller] Could not build the 3D viewer:", err);
                showIntake3dError("No se pudo abrir el visor 3D. Vuelve a elegir la silueta para reintentar.");
            }
        }, function (err) {
            if (mountId !== intake3dMountId) return;
            // All of it cleared so the next choice retries the mount, the
            // cached module promise included (see forgetCar3d).
            forgetCar3d();
            intake3dVehicle = null;
            console.error("[taller] Could not load the 3D viewer module:", err);
            showIntake3dError("No se pudo cargar el visor 3D. Vuelve a elegir la silueta para reintentar.");
        });
    }

    intake3dClearEl.addEventListener("click", function () {
        if (!intakeParts.length) return;
        intakeParts = [];
        if (intake3d) intake3d.refreshSelection();
        renderIntakeParts();
    });

    function setIntakeError(message) {
        intakeErrorEl.textContent = message || "";
        intakeErrorEl.hidden = !message;
        if (message) intakeErrorEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }

    // The names the catalogue shows, not its ids: the table and the emails put
    // this in front of people, and 'yaris-sedan' says less than 'Yaris Sedán'
    // (see the comment on `brand` in server/schema.sql).
    function chosenCar() {
        var catalog = window.CAR_CATALOG;
        if (!catalog || !intakeBrandEl.value) return { brand: "", model: "", bodyType: "" };
        var brand = catalog.findBrand(intakeBrandEl.value);
        if (!brand) return { brand: "", model: "", bodyType: "" };
        // findModel takes the brand's id and not the brand itself (see
        // src/carModels.js); handed the object it returns null, and the model
        // and the body type both went missing without a word.
        var model = intakeModelEl.value ? catalog.findModel(brand.id, intakeModelEl.value) : null;
        return {
            brand: brand.name,
            model: model ? model.name : "",
            bodyType: model ? model.type : ""
        };
    }

    function intakePayload() {
        var car = chosenCar();
        var plate = intakePlateEl.value.trim().toUpperCase();
        return {
            vehicle: intakeVehicle,
            quality: intakeQuality,
            firstName: intakeFirstNameEl.value.trim(),
            lastName: intakeLastNameEl.value.trim(),
            email: intakeEmailEl.value.trim(),
            // El servidor lo exige con el prefijo, igual que en el asistente.
            phone: "+51" + intakePhoneEl.value.replace(/\D/g, ""),
            brand: car.brand,
            model: car.model,
            // La carrocería sale del modelo elegido, si se eligió uno. La
            // silueta no: esa la eligió el jefe mirando el vehículo.
            bodyType: car.bodyType,
            plate: plate,
            // The one thing the form does not insist on: a customer who said
            // nothing leaves nothing to write down.
            notes: intakeNotesEl.value.trim(),
            parts: intakeParts.slice()
        };
    }

    function firstIntakeProblem() {
        if (!intakeFirstNameEl.value.trim()) return { message: "Falta el nombre.", field: intakeFirstNameEl };
        if (!intakeLastNameEl.value.trim()) return { message: "Falta el apellido.", field: intakeLastNameEl };
        var email = intakeEmailEl.value.trim();
        if (!email) return { message: "Falta el email.", field: intakeEmailEl };
        if (!EMAIL_RE.test(email)) return { message: "El email no es válido.", field: intakeEmailEl };
        if (intakePhoneEl.value.replace(/\D/g, "").length !== 9) {
            return { message: "El teléfono debe tener 9 dígitos.", field: intakePhoneEl };
        }
        if (!intakeVehicle) return { message: "Elige el tipo de vehículo.", field: null };
        if (!intakeQuality) return { message: "Elige el nivel de acabado.", field: null };

        // The second card, in the order it is read. Everything in it is asked
        // for except the notes: the customer and the car are both at the
        // counter, which is the one moment any of this can be checked against
        // the vehicle itself instead of chased down a week later.
        var car = chosenCar();
        if (!car.brand) return { message: "Elige la marca.", field: intakeBrandEl };
        if (!car.model) return { message: "Elige el modelo.", field: intakeModelEl };
        if (intakeParts.length === 0) {
            return { message: "Elige al menos una pieza a pintar: toca el vehículo.", field: null };
        }
        var plate = intakePlateEl.value.trim().toUpperCase();
        if (!plate) return { message: "Falta la placa.", field: intakePlateEl };
        if (!PLATE_RE.test(plate)) return { message: "La placa no es válida.", field: intakePlateEl };
        return null;
    }

    function resetIntake() {
        intakeFormEl.reset();
        intakeVehicle = "";
        intakeQuality = "";
        vehicleChoice.clear();
        qualityChoice.clear();
        buildModelOptions("");
        // The viewer goes with the form: its model is tens of megabytes on the
        // GPU, and the next vehicle registered may not even be the same shape.
        destroyIntake3d();
        intakeParts = [];
        renderIntakeParts();
        show(intakePartsEl, false);
        setIntakeError("");
        show(intakeFormEl, true);
        show(intakeDoneEl, false);
    }

    function showIntake() {
        saveNotes();
        readOnly = false;
        view = "intake";
        paintView();
        resetIntake();
        intakeFirstNameEl.focus();
    }

    intakeFormEl.addEventListener("submit", function (event) {
        event.preventDefault();

        var problem = firstIntakeProblem();
        if (problem) {
            setIntakeError(problem.message);
            if (problem.field) problem.field.focus();
            return;
        }

        intakeSubmitEl.disabled = true;
        intakeSubmitEl.textContent = "Registrando…";
        setIntakeError("");

        var payload = intakePayload();
        fetch(API_BASE + "/api/staff/requests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify(payload)
        })
            .then(function (response) {
                return response.json().catch(function () { return null; }).then(function (body) {
                    if (response.status === 401) {
                        showLogin();
                        setError("Tu sesión venció. Vuelve a entrar.");
                        return;
                    }
                    if (!response.ok) {
                        throw new Error((body && body.error) || "No pudimos registrar el vehículo.");
                    }
                    intakeDoneNameEl.textContent = payload.firstName + " " + payload.lastName;
                    intakeDoneCodeEl.textContent = body.id;
                    // Only promised when the server queued the email: with the
                    // mail switched off or the daily cap reached, nothing goes
                    // out and the code has to be read out at the counter.
                    intakeDoneHintEl.textContent = body.mailQueued
                        ? "Le enviaremos el código a " + payload.email + ". Dáselo también en persona por si no le llega."
                        : "El correo no está disponible ahora: dale el código en persona.";
                    show(intakeFormEl, false);
                    show(intakeDoneEl, true);
                });
            })
            .catch(function (err) {
                setIntakeError(err instanceof TypeError ? NETWORK_MESSAGE : err.message);
            })
            .then(function () {
                intakeSubmitEl.disabled = false;
                intakeSubmitEl.textContent = "Registrar";
            });
    });

    intakeCancelEl.addEventListener("click", showProfile);
    intakeBackEl.addEventListener("click", showProfile);
    intakeAgainEl.addEventListener("click", function () {
        resetIntake();
        intakeFirstNameEl.focus();
    });

    buildBrandOptions();
    buildModelOptions("");

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
                    if (view === "login" || view === "profile") view = "profile";
                    paintView();
                    // Después de pintar: la ficha escondida no ocupa y la foto
                    // saldría de cero.
                    sizePhoto();
                    render();
                    paintTabs();
                    // The matizado orders ride along the first time, so the
                    // tab's count is there before anybody opens it.
                    if (!paintLoaded) loadPaintOrders();
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
        if (view !== "profile") {
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
            allPaintOrders = [];
            paintLoaded = false;
            paintRowsEl.textContent = "";
            panelTab = "vehicles";
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
    buildPaintFilters();

    // Al abrir la página no se sabe si hay sesión: se pregunta, y el 401 —si
    // llega— es lo que decide mostrar el formulario de acceso.
    loadRequests();
})();
