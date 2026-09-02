(function () {
    "use strict";
    var TOTAL_STEPS = 4;
    var current = 1;
    var viewMode = "top";
    var state = { vehicle: null, parts: [], quality: null };

    var steps = Array.prototype.slice.call(document.querySelectorAll(".step"));
    var dots = Array.prototype.slice.call(document.querySelectorAll(".progress-dot"));
    var lines = Array.prototype.slice.call(document.querySelectorAll(".progress-line"));
    var backLink = document.getElementById("backLink");
    var confirmBtn = document.getElementById("stepConfirm");
    var successPanel = document.getElementById("success");
    var progressNav = document.querySelector(".progress");
    var contactForm = document.getElementById("contactForm");
    var phoneInput = document.getElementById("phone");
    var phoneFullInput = document.getElementById("phoneFull");
    var phoneError = document.getElementById("phoneError");
    var emailInput = document.getElementById("email");
    var emailError = document.getElementById("emailError");
    var departmentSelect = document.getElementById("department");
    var provinceSelect = document.getElementById("province");
    var submitError = document.getElementById("submitError");
    var successCode = document.getElementById("successCode");
    var copyCodeBtn = document.getElementById("copyCodeBtn");
    var PHONE_DIGITS = 9; // Perú: +51 + PHONE_DIGITS dígitos (celulares peruanos tienen 9 dígitos).

    var vehicleCards = Array.prototype.slice.call(document.querySelectorAll(".vehicle-card"));
    var qualityCards = Array.prototype.slice.call(document.querySelectorAll(".quality-card"));
    // Scoped to #carView2d: the 3D camera buttons (#carView3dButtons) reuse
    var viewTabs = Array.prototype.slice.call(document.querySelectorAll("#carView2d .view-tab"));
    var carView = document.getElementById("carView");

    var carView2d = document.getElementById("carView2d");
    var carView3d = document.getElementById("carView3d");
    var carView3dCanvasWrap = document.getElementById("carView3dCanvasWrap");
    var carView3dCanvas = document.getElementById("carView3dCanvas");
    var carView3dOverlay = document.getElementById("carView3dOverlay");
    var carView3dProgressBar = document.getElementById("carView3dProgressBar");
    var carView3dLoadingLabel = document.getElementById("carView3dLoadingLabel");
    var carView3dError = document.getElementById("carView3dError");
    var carView3dButtons = document.getElementById("carView3dButtons");
    var carView3dList = document.getElementById("carView3dList");
    var carView3dCount = document.getElementById("carView3dCount");
    var carView3dClear = document.getElementById("carView3dClear");
    var car3d = null;        // controller for the currently mounted viewer
    var car3dVehicle = null; // vehicle it is mounted (or being mounted) for
    var car3dModule = null;  // cached import() of the viewer module
    var car3dMountId = 0;    // guards against a superseded mount finishing last

    var menuToggle = document.getElementById("menuToggle");
    var navPanel = document.getElementById("navPanel");

    // ==================================================================
    // Car part art — one set of panels per vehicle, per angle.
    // Every panel carries a canonical part id shared across angles
    // (e.g. "hood" appears in both the top view and the front view),
    // so selecting it anywhere keeps every view in sync.
    // ==================================================================

    var PART_LABELS = {
        "hood": "Capó",
        "roof": "Techo",
        "trunk": "Maletero",
        "front-bumper": "Parachoques delantero",
        "rear-bumper": "Parachoques trasero",
        "left-fender-front": "Guardabarros delantero izquierdo",
        "left-fender-rear": "Guardabarros trasero izquierdo",
        "right-fender-front": "Guardabarros delantero derecho",
        "right-fender-rear": "Guardabarros trasero derecho",
        "left-door-front": "Puerta delantera izquierda",
        "left-door-rear": "Puerta trasera izquierda",
        "right-door-front": "Puerta delantera derecha",
        "right-door-rear": "Puerta trasera derecha",
        // 3D viewer — the GLB node names of every paintable panel across
        // the three models (see VEHICLE_MODELS in carVisual.js), distinct
        // from the 2D ids above; hood/roof are reused as-is since they mean
        // the same thing in both vocabularies. One flat map serves all three
        // vehicles because every id they share names the same panel on each.
        // Only-on-the-SUV:
        "front_bumper": "Parachoques delantero",
        "tonneau": "Platón y portón",
        // Only-on-the-furgoneta (its sliding doors, and its own spelling of
        // the front fenders / rear quarter panels):
        "back_door_left": "Puerta corrediza izquierda",
        "back_door_right": "Puerta corrediza derecha",
        "left_fender": "Guardabarros delantero izquierdo",
        "right_fender": "Guardabarros delantero derecho",
        "rear_window_left": "Panel lateral trasero izquierdo",
        "rear_window_right": "Panel lateral trasero derecho",
        // Only-on-the-familiar:
        "front_door_left001": "Puerta delantera izquierda",
        "bumper": "Parachoques delantero",
        "back_bumper": "Parachoques trasero",
        "Object_26": "Moldura trasera del techo",
        // Shared by two or more models:
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

    // Side-view lower body (bumper/fenders/doors) is shared across the
    // three vehicles — only the roofline and wheel size change between
    // them, which is what actually reads as "van" vs "wagon" vs "suv"
    // in profile.
    var SIDE_LOWER_BODY = [
        { id: "front-bumper", d: "M35 100 L50 100 L50 170 L35 170 A15 15 0 0 1 20 155 L20 115 A15 15 0 0 1 35 100 Z" },
        { id: "fender-front", d: "M50 100 L110 100 L110 170 L50 170 Z" },
        { id: "door-front", d: "M110 100 L200 100 L200 170 L110 170 Z" },
        { id: "door-rear", d: "M200 100 L290 100 L290 170 L200 170 Z" },
        { id: "fender-rear", d: "M290 100 L350 100 L350 170 L290 170 Z" },
        { id: "rear-bumper", d: "M350 100 L365 100 A15 15 0 0 1 380 115 L380 155 A15 15 0 0 1 365 170 L350 170 Z" }
    ];

    // Front and rear silhouettes share the same bumper/fender shell per
    // vehicle (only the hood/trunk lid on top differs), so it's defined
    // once and reused for both angles.
    var VAN_SHELL = {
        bumper: "M20 150 L240 150 L240 178 A12 12 0 0 1 228 190 L32 190 A12 12 0 0 1 20 178 L20 150 Z",
        leftFender: "M20 90 L70 90 L70 150 L20 150 Z",
        rightFender: "M190 90 L240 90 L240 150 L190 150 Z"
    };
    var WAGON_SHELL = {
        bumper: "M20 150 L240 150 L240 174 A16 16 0 0 1 224 190 L36 190 A16 16 0 0 1 20 174 L20 150 Z",
        leftFender: "M20 95 L75 95 L75 150 L20 150 Z",
        rightFender: "M185 95 L240 95 L240 150 L185 150 Z"
    };
    var SUV_SHELL = {
        bumper: "M15 148 L245 148 L245 182 A10 10 0 0 1 235 192 L25 192 A10 10 0 0 1 15 182 L15 148 Z",
        leftFender: "M15 85 L70 85 L70 148 L15 148 Z",
        rightFender: "M190 85 L245 85 L245 148 L190 148 Z"
    };

    var CAR_ART = {
        van: {
            top: {
                viewBox: "0 0 200 420",
                parts: [
                    { id: "hood", d: "M40 20 L160 20 A10 10 0 0 1 170 30 L170 110 L30 110 L30 30 A10 10 0 0 1 40 20 Z" },
                    { id: "roof", d: "M30 110 L170 110 L170 290 L30 290 Z" },
                    { id: "trunk", d: "M30 290 L170 290 L170 390 A10 10 0 0 1 160 400 L40 400 A10 10 0 0 1 30 390 L30 290 Z" }
                ]
            },
            side: {
                viewBox: "0 0 400 200",
                parts: SIDE_LOWER_BODY.concat([
                    { id: "roof", d: "M112 35 L288 35 A12 12 0 0 1 300 47 L300 100 L100 100 L100 47 A12 12 0 0 1 112 35 Z" }
                ]),
                wheels: [{ cx: 80, cy: 172, r: 22, hub: 8 }, { cx: 320, cy: 172, r: 22, hub: 8 }]
            },
            front: {
                viewBox: "0 0 260 200",
                parts: [
                    { id: "front-bumper", d: VAN_SHELL.bumper },
                    { id: "left-fender-front", d: VAN_SHELL.leftFender },
                    { id: "right-fender-front", d: VAN_SHELL.rightFender },
                    { id: "hood", d: "M80 50 L180 50 A10 10 0 0 1 190 60 L190 150 L70 150 L70 60 A10 10 0 0 1 80 50 Z" }
                ]
            },
            rear: {
                viewBox: "0 0 260 200",
                parts: [
                    { id: "rear-bumper", d: VAN_SHELL.bumper },
                    { id: "left-fender-rear", d: VAN_SHELL.leftFender },
                    { id: "right-fender-rear", d: VAN_SHELL.rightFender },
                    { id: "trunk", d: "M80 65 L180 65 A10 10 0 0 1 190 75 L190 150 L70 150 L70 75 A10 10 0 0 1 80 65 Z" }
                ]
            }
        },
        wagon: {
            top: {
                viewBox: "0 0 200 420",
                parts: [
                    { id: "hood", d: "M58 20 L142 20 A28 28 0 0 1 170 48 L170 100 L30 100 L30 48 A28 28 0 0 1 58 20 Z" },
                    { id: "roof", d: "M30 100 L170 100 L170 300 L30 300 Z" },
                    { id: "trunk", d: "M30 300 L170 300 L170 382 A18 18 0 0 1 152 400 L48 400 A18 18 0 0 1 30 382 L30 300 Z" }
                ]
            },
            side: {
                viewBox: "0 0 400 200",
                parts: SIDE_LOWER_BODY.concat([
                    { id: "roof", d: "M145 55 L255 55 A25 25 0 0 1 280 80 L280 100 L120 100 L120 80 A25 25 0 0 1 145 55 Z" }
                ]),
                wheels: [{ cx: 80, cy: 172, r: 20, hub: 7 }, { cx: 320, cy: 172, r: 20, hub: 7 }]
            },
            front: {
                viewBox: "0 0 260 200",
                parts: [
                    { id: "front-bumper", d: WAGON_SHELL.bumper },
                    { id: "left-fender-front", d: WAGON_SHELL.leftFender },
                    { id: "right-fender-front", d: WAGON_SHELL.rightFender },
                    { id: "hood", d: "M97 65 L163 65 A22 22 0 0 1 185 87 L185 150 L75 150 L75 87 A22 22 0 0 1 97 65 Z" }
                ]
            },
            rear: {
                viewBox: "0 0 260 200",
                parts: [
                    { id: "rear-bumper", d: WAGON_SHELL.bumper },
                    { id: "left-fender-rear", d: WAGON_SHELL.leftFender },
                    { id: "right-fender-rear", d: WAGON_SHELL.rightFender },
                    { id: "trunk", d: "M93 75 L167 75 A18 18 0 0 1 185 93 L185 150 L75 150 L75 93 A18 18 0 0 1 93 75 Z" }
                ]
            }
        },
        suv: {
            top: {
                viewBox: "0 0 200 420",
                parts: [
                    { id: "hood", d: "M40 20 L160 20 A12 12 0 0 1 172 32 L172 115 L28 115 L28 32 A12 12 0 0 1 40 20 Z" },
                    { id: "roof", d: "M28 115 L172 115 L172 285 L28 285 Z" },
                    { id: "trunk", d: "M28 285 L172 285 L172 386 A14 14 0 0 1 158 400 L42 400 A14 14 0 0 1 28 386 L28 285 Z" }
                ]
            },
            side: {
                viewBox: "0 0 400 200",
                parts: SIDE_LOWER_BODY.concat([
                    { id: "roof", d: "M115 30 L285 30 A10 10 0 0 1 295 40 L295 100 L105 100 L105 40 A10 10 0 0 1 115 30 Z" }
                ]),
                wheels: [{ cx: 80, cy: 174, r: 25, hub: 9 }, { cx: 320, cy: 174, r: 25, hub: 9 }]
            },
            front: {
                viewBox: "0 0 260 200",
                parts: [
                    { id: "front-bumper", d: SUV_SHELL.bumper },
                    { id: "left-fender-front", d: SUV_SHELL.leftFender },
                    { id: "right-fender-front", d: SUV_SHELL.rightFender },
                    { id: "hood", d: "M78 42 L182 42 A8 8 0 0 1 190 50 L190 148 L70 148 L70 50 A8 8 0 0 1 78 42 Z" }
                ]
            },
            rear: {
                viewBox: "0 0 260 200",
                parts: [
                    { id: "rear-bumper", d: SUV_SHELL.bumper },
                    { id: "left-fender-rear", d: SUV_SHELL.leftFender },
                    { id: "right-fender-rear", d: SUV_SHELL.rightFender },
                    { id: "trunk", d: "M78 58 L182 58 A8 8 0 0 1 190 66 L190 148 L70 148 L70 66 A8 8 0 0 1 78 58 Z" }
                ]
            }
        }
    };

    function sidePartId(baseId, side) {
        if (baseId === "fender-front" || baseId === "fender-rear" || baseId === "door-front" || baseId === "door-rear") {
            return side + "-" + baseId;
        }
        return baseId;
    }

    function buildPartsSvg(view, parts, wheels, mirrored) {
        var svg = '<svg viewBox="' + view.viewBox + '" class="car-svg' + (mirrored ? " is-mirrored" : "") + '">';
        parts.forEach(function (p) {
            var label = PART_LABELS[p.id] || p.id;
            svg += '<path class="car-part" data-part="' + p.id + '" d="' + p.d + '" ' +
                'role="button" tabindex="0" aria-pressed="false" aria-label="' + label + '"></path>';
        });
        if (wheels) {
            wheels.forEach(function (w) {
                svg += '<circle class="car-wheel" cx="' + w.cx + '" cy="' + w.cy + '" r="' + w.r + '"></circle>';
                svg += '<circle class="car-wheel-hub" cx="' + w.cx + '" cy="' + w.cy + '" r="' + w.hub + '"></circle>';
            });
        }
        svg += "</svg>";
        return svg;
    }

    function syncPartState(id) {
        if (!carView) return;
        var selected = state.parts.indexOf(id) !== -1;
        var matches = carView.querySelectorAll('.car-part[data-part="' + id + '"]');
        Array.prototype.slice.call(matches).forEach(function (el) {
            el.classList.toggle("is-selected", selected);
            el.setAttribute("aria-pressed", selected ? "true" : "false");
        });
    }

    function toggleCarPart(id) {
        var idx = state.parts.indexOf(id);
        if (idx === -1) state.parts.push(id);
        else state.parts.splice(idx, 1);
        syncPartState(id);
        if (car3d) car3d.refreshSelection();
        renderPartsSummary();
        refreshConfirm();
    }

    // ==================================================================
    // 3D viewer (step 3) — lazy-loaded, then shown/hidden as the wizard
    // steps back and forth. Each vehicle has its own model, so the viewer
    // is torn down and rebuilt whenever the chosen vehicle changes and only
    // one is ever alive. The module owns no selection state itself; it
    // reads/writes state.parts through the two callbacks below, same as the
    // 2D SVG parts do via toggleCarPart.
    // ==================================================================

    function renderPartsSummary() {
        if (!carView3dList) return;
        carView3dList.innerHTML = "";
        if (state.parts.length === 0) {
            var empty = document.createElement("li");
            empty.className = "car-view-3d__empty";
            empty.textContent = "Ninguna pieza seleccionada. Toca el vehículo para elegir.";
            carView3dList.appendChild(empty);
        } else {
            state.parts.forEach(function (id) {
                var label = PART_LABELS[id] || id;
                var li = document.createElement("li");
                li.className = "car-view-3d__list-item";
                var span = document.createElement("span");
                span.textContent = label;
                var btn = document.createElement("button");
                btn.type = "button";
                btn.className = "car-view-3d__list-item-remove";
                btn.setAttribute("aria-label", "Quitar " + label);
                btn.textContent = "✕";
                btn.addEventListener("click", function () { toggleCarPart(id); });
                li.appendChild(span);
                li.appendChild(btn);
                carView3dList.appendChild(li);
            });
        }
        if (carView3dCount) carView3dCount.textContent = String(state.parts.length);
        if (carView3dClear) carView3dClear.disabled = state.parts.length === 0;
    }

    if (carView3dClear) {
        carView3dClear.addEventListener("click", function () {
            if (!state.parts.length) return;
            state.parts.forEach(function (id) { syncPartState(id); });
            state.parts = [];
            if (car3d) car3d.refreshSelection();
            renderPartsSummary();
            refreshConfirm();
        });
    }

    // A canvas is single-use here: tearing a viewer down drops its WebGL
    // context (see destroy() in carVisual.js), so the next vehicle gets a
    // fresh element to draw into.
    function replaceCar3DCanvas() {
        if (!carView3dCanvasWrap || !carView3dCanvas) return;
        var fresh = document.createElement("canvas");
        fresh.id = carView3dCanvas.id;
        fresh.className = carView3dCanvas.className;
        carView3dCanvasWrap.replaceChild(fresh, carView3dCanvas);
        carView3dCanvas = fresh;
    }

    // Puts the loading overlay back the way a fresh mount expects it: a
    // previous viewer leaves it faded out, and an earlier failure leaves an
    // error message where the progress bar belongs.
    function resetCar3DOverlay() {
        if (carView3dOverlay) carView3dOverlay.classList.remove("hidden");
        if (carView3dProgressBar) {
            carView3dProgressBar.style.width = "0%";
            if (carView3dProgressBar.parentElement) carView3dProgressBar.parentElement.style.display = "";
        }
        if (carView3dLoadingLabel) {
            carView3dLoadingLabel.hidden = false;
            carView3dLoadingLabel.textContent = "Cargando modelo 3D…";
        }
        if (carView3dError) {
            carView3dError.hidden = true;
            carView3dError.textContent = "";
        }
    }

    function showCar3DError(message) {
        if (carView3dOverlay) carView3dOverlay.classList.remove("hidden");
        if (carView3dProgressBar && carView3dProgressBar.parentElement) {
            carView3dProgressBar.parentElement.style.display = "none";
        }
        if (carView3dLoadingLabel) carView3dLoadingLabel.hidden = true;
        if (carView3dError) {
            carView3dError.textContent = message;
            carView3dError.hidden = false;
        }
    }

    function ensureCar3D(vehicle) {
        if (!vehicle || !carView3dCanvas) return;
        // Already mounted — or still mounting — for this vehicle.
        if (car3dVehicle === vehicle) return;

        if (car3d) {
            car3d.destroy();
            car3d = null;
            replaceCar3DCanvas();
        }
        car3dVehicle = vehicle;
        resetCar3DOverlay();

        // The module is fetched once; only the viewer inside it is rebuilt
        // per vehicle.
        if (!car3dModule) car3dModule = import("../src/carVisual.js");
        var mountId = ++car3dMountId;
        var canvasEl = carView3dCanvas;

        car3dModule.then(function (mod) {
            // A later call already claimed the canvas and the loading UI
            // (the customer went back and changed vehicle while this import
            // was still in flight), so this one has nothing left to mount.
            if (mountId !== car3dMountId) return;
            car3d = mod.mountCar3D({
                vehicle: vehicle,
                canvasEl: canvasEl,
                canvasWrapEl: carView3dCanvasWrap,
                overlayEl: carView3dOverlay,
                progressBarEl: carView3dProgressBar,
                loadingLabelEl: carView3dLoadingLabel,
                errorEl: carView3dError,
                buttonsEl: carView3dButtons,
                isPartSelected: function (id) { return state.parts.indexOf(id) !== -1; },
                onPartToggle: function (id) { toggleCarPart(id); }
            });
        }).catch(function (err) {
            if (mountId !== car3dMountId) return;
            // Cleared so a later visit to step 3 retries the mount.
            car3dVehicle = null;
            console.error("[repair] No se pudo cargar el visor 3D:", err);
            showCar3DError("No se pudo cargar el visor 3D. Intenta recargar la página.");
        });
    }

    function wireCarParts() {
        Array.prototype.slice.call(carView.querySelectorAll(".car-part")).forEach(function (el) {
            var id = el.dataset.part;
            var selected = state.parts.indexOf(id) !== -1;
            el.classList.toggle("is-selected", selected);
            el.setAttribute("aria-pressed", selected ? "true" : "false");
            el.addEventListener("click", function () { toggleCarPart(id); });
            el.addEventListener("keydown", function (e) {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleCarPart(id);
                }
            });
        });
    }

    function renderCarView() {
        if (!carView) return;
        var vehicle = state.vehicle || "van";
        var art = CAR_ART[vehicle];
        var html;

        if (viewMode === "side") {
            var leftParts = art.side.parts.map(function (p) { return { id: sidePartId(p.id, "left"), d: p.d }; });
            var rightParts = art.side.parts.map(function (p) { return { id: sidePartId(p.id, "right"), d: p.d }; });
            html = '<div class="car-view__pair">' +
                '<div class="car-view__slot"><span class="car-view__label">Izquierda</span>' +
                buildPartsSvg(art.side, leftParts, art.side.wheels, false) + "</div>" +
                '<div class="car-view__slot"><span class="car-view__label">Derecha</span>' +
                buildPartsSvg(art.side, rightParts, art.side.wheels, true) + "</div>" +
                "</div>";
        } else if (viewMode === "front") {
            html = '<div class="car-view__pair">' +
                '<div class="car-view__slot"><span class="car-view__label">Frente</span>' +
                buildPartsSvg(art.front, art.front.parts, null, false) + "</div>" +
                '<div class="car-view__slot"><span class="car-view__label">Atrás</span>' +
                buildPartsSvg(art.rear, art.rear.parts, null, false) + "</div>" +
                "</div>";
        } else {
            html = buildPartsSvg(art.top, art.top.parts, null, false);
        }

        carView.innerHTML = html;
        wireCarParts();
    }

    viewTabs.forEach(function (tab) {
        tab.addEventListener("click", function () {
            viewMode = tab.dataset.view;
            viewTabs.forEach(function (t) {
                var active = t === tab;
                t.classList.toggle("is-active", active);
                t.setAttribute("aria-selected", active ? "true" : "false");
            });
            renderCarView();
        });
    });

    // ==================================================================
    // Wizard navigation
    // ==================================================================

    function isStepValid(step) {
        if (step === 1) return !!state.vehicle;
        if (step === 2) return !!state.quality;
        if (step === 3) return state.parts.length > 0;
        if (step === 4) return contactForm.checkValidity();
        return true;
    }

    function refreshConfirm() { confirmBtn.disabled = !isStepValid(current); }

    function updateProgress(step) {
        dots.forEach(function (dot) {
            var n = Number(dot.dataset.step);
            dot.classList.remove("is-current", "is-done");
            dot.removeAttribute("aria-current");
            if (n === step) { dot.classList.add("is-current"); dot.setAttribute("aria-current", "step"); }
            else if (n < step) dot.classList.add("is-done");
        });
        lines.forEach(function (line) {
            line.classList.toggle("is-done", step > Number(line.dataset.after));
        });
    }

    function goTo(step) {
        steps.forEach(function (s) {
            var match = Number(s.dataset.step) === step;
            s.classList.toggle("active", match);
            s.hidden = !match;
        });
        updateProgress(step);
        backLink.hidden = step === 1;
        confirmBtn.textContent = step === TOTAL_STEPS ? "Enviar solicitud" : "Continuar";
        current = step;
        if (step === 3) {
            if (carView3d) carView3d.hidden = false;
            ensureCar3D(state.vehicle);
            // On a first mount the viewer sizes itself; this is for coming
            // back to a viewer that was measured while its container was
            // hidden (and so has no size of its own yet).
            if (car3d) car3d.resize();
            renderPartsSummary();
        }
        refreshConfirm();

        var heading = document.querySelector('.step[data-step="' + step + '"] h1');
        if (heading) { heading.setAttribute("tabindex", "-1"); heading.focus(); }
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    backLink.addEventListener("click", function () {
        if (current > 1) goTo(current - 1);
    });

    confirmBtn.addEventListener("click", function () {
        if (!isStepValid(current)) return;
        if (current < TOTAL_STEPS) goTo(current + 1);
        else submitRequest();
    });

    // ==================================================================
    // Envío de la solicitud
    //
    // El taller recibe cada solicitud en la tabla `requests` de la base
    // `autocolor` (ver server/), que responde con el código de 10 dígitos
    // con el que el cliente puede consultar su estado más abajo. Hasta que
    // el servidor confirma no se muestra la pantalla de éxito: prometer que
    // llegó algo que no se guardó es peor que pedir reintentar.
    // ==================================================================

    // Vacío = mismo origen (es lo normal: `npm start` sirve el sitio y la API
    // juntos). Ver src/config.js para cuando la API vive en otro dominio.
    var REQUESTS_ENDPOINT = (window.AUTOCOLOR_API_BASE || "") + "/api/requests";
    var submitting = false;

    // El sitio puede estar publicado en un alojamiento estático, sin la API
    // detrás: ahí el POST no llega a ejecutarse y el servidor de archivos
    // responde 405 (o 404, según el proveedor). Vale la pena distinguirlo de
    // un error pasajero, porque decirle a alguien que reintente cuando no hay
    // nada que atienda su solicitud solo le hace perder el tiempo.
    var API_MISSING_STATUS = [404, 405, 501];
    var API_MISSING_MESSAGE = "El envío de solicitudes no está disponible en esta versión del sitio. " +
        "Escríbenos desde la página de contacto y preparamos tu presupuesto.";

    function setSubmitError(message) {
        if (!submitError) return;
        submitError.textContent = message || "";
        submitError.hidden = !message;
    }

    function requestPayload() {
        return {
            vehicle: state.vehicle,
            quality: state.quality,
            parts: state.parts,
            firstName: document.getElementById("firstName").value,
            lastName: document.getElementById("lastName").value,
            department: departmentSelect ? departmentSelect.value : "",
            province: provinceSelect ? provinceSelect.value : "",
            // Se arma aquí y no se toma de #phoneFull porque ese campo se
            // llena en el evento "input", que un autocompletado del navegador
            // no siempre dispara.
            phone: "+51" + phoneInput.value.replace(/\D/g, ""),
            email: emailInput.value,
            notes: document.getElementById("notes").value
        };
    }

    function submitRequest() {
        if (submitting) return;
        submitting = true;
        setSubmitError("");
        confirmBtn.disabled = true;
        confirmBtn.textContent = "Enviando…";

        fetch(REQUESTS_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestPayload())
        }).then(function (response) {
            if (API_MISSING_STATUS.indexOf(response.status) !== -1) {
                throw new Error(API_MISSING_MESSAGE);
            }
            return response.json().catch(function () { return {}; }).then(function (body) {
                if (!response.ok) {
                    throw new Error(body.error || "No pudimos enviar tu solicitud. Inténtalo nuevamente.");
                }
                return body;
            });
        }).then(function (created) {
            showSuccess(created.id);
        }).catch(function (err) {
            console.error("[repair] No se pudo enviar la solicitud:", err);
            // fetch solo rechaza así cuando la petición nunca llegó a destino
            // (servidor apagado, sin conexión); cualquier respuesta del
            // servidor, incluso un error, ya trae su propio mensaje.
            var offline = err instanceof TypeError;
            setSubmitError(offline
                ? "No pudimos conectar con el servidor. Revisa tu conexión e inténtalo nuevamente."
                : err.message);
        }).then(function () {
            submitting = false;
            confirmBtn.textContent = "Enviar solicitud";
            refreshConfirm();
        });
    }

    function showSuccess(id) {
        if (successCode) successCode.textContent = id || "";
        // Le deja el código puesto al formulario de consulta, ahí abajo, para
        // que probarlo sea un clic y no un copiado a mano.
        var lookupInput = document.getElementById("lookupId");
        if (lookupInput && id) lookupInput.value = id;

        progressNav.hidden = true;
        backLink.hidden = true;
        confirmBtn.hidden = true;
        steps.forEach(function (s) { s.hidden = true; s.classList.remove("active"); });
        successPanel.hidden = false;
        var title = successPanel.querySelector("h1");
        if (title) title.focus();
    }

    if (copyCodeBtn) {
        var copyResetTimer = null;
        copyCodeBtn.addEventListener("click", function () {
            var code = successCode ? successCode.textContent.trim() : "";
            if (!code || !navigator.clipboard) return;
            navigator.clipboard.writeText(code).then(function () {
                copyCodeBtn.textContent = "¡Copiado!";
                copyCodeBtn.classList.add("is-copied");
                clearTimeout(copyResetTimer);
                copyResetTimer = setTimeout(function () {
                    copyCodeBtn.textContent = "Copiar";
                    copyCodeBtn.classList.remove("is-copied");
                }, 2000);
            }).catch(function () {
                // El portapapeles puede estar bloqueado por permisos: el código
                // sigue visible y seleccionable, así que no hay nada que avisar.
            });
        });
    }

    document.getElementById("resetBtn").addEventListener("click", function () {
        state = { vehicle: null, parts: [], quality: null };

        vehicleCards.forEach(function (c) { c.classList.remove("is-selected"); c.setAttribute("aria-checked", "false"); });
        qualityCards.forEach(function (q) { q.classList.remove("is-selected"); q.setAttribute("aria-checked", "false"); });
        contactForm.reset();
        [phoneInput, emailInput].forEach(function (input) {
            var field = input.closest(".field");
            if (field) field.classList.remove("field--invalid");
            input.removeAttribute("aria-invalid");
        });
        phoneError.hidden = true;
        emailError.hidden = true;
        phoneFullInput.value = "";
        setSubmitError("");
        if (successCode) successCode.textContent = "··········";
        if (departmentSelect) {
            departmentSelect.value = "";
            departmentSelect.classList.add("is-placeholder");
        }
        populateProvinceOptions("");

        viewMode = "top";
        viewTabs.forEach(function (t) {
            var active = t.dataset.view === "top";
            t.classList.toggle("is-active", active);
            t.setAttribute("aria-selected", active ? "true" : "false");
        });
        if (carView) carView.innerHTML = "";

        if (carView3d) carView3d.hidden = true;
        renderPartsSummary();
        // The viewer stays mounted: picking the same vehicle again then
        // costs nothing, and ensureCar3D() swaps the model out if the next
        // request is for a different one.
        if (car3d) {
            car3d.refreshSelection();
            car3d.resetView();
        }

        progressNav.hidden = false;
        confirmBtn.hidden = false;
        successPanel.hidden = true;
        goTo(1);
    });

    // ---------- Paso 1: selección de vehículo ----------
    vehicleCards.forEach(function (card) {
        card.addEventListener("click", function () {
            var newVehicle = card.dataset.value;
            if (state.vehicle !== newVehicle && state.parts.length) {
                // Each model names — and splits up — its body panels
                // differently, so a selection made for one vehicle can't
                // carry over to another.
                state.parts = [];
                renderPartsSummary();
                if (car3d) car3d.refreshSelection();
            }
            vehicleCards.forEach(function (c) {
                c.classList.remove("is-selected");
                c.setAttribute("aria-checked", "false");
            });
            card.classList.add("is-selected");
            card.setAttribute("aria-checked", "true");
            state.vehicle = newVehicle;
            refreshConfirm();
        });
    });

    // ---------- Paso 2: selección de acabado ----------
    qualityCards.forEach(function (card) {
        card.addEventListener("click", function () {
            qualityCards.forEach(function (c) {
                c.classList.remove("is-selected");
                c.setAttribute("aria-checked", "false");
            });
            card.classList.add("is-selected");
            card.setAttribute("aria-checked", "true");
            state.quality = card.dataset.value;
            refreshConfirm();
        });
    });

    // ---------- Paso 4: formulario de contacto ----------

    // Ubicación en dos pasos: Departamento -> Provincia, poblada desde
    // la base de datos hardcodeada en cities.js (PERU_DEPARTMENTS). La
    // provincia permanece deshabilitada hasta que se elige un departamento.
    function sortEs(list) {
        return list.slice().sort(function (a, b) { return a.localeCompare(b, "es"); });
    }

    function populateProvinceOptions(department) {
        if (!provinceSelect) return;
        provinceSelect.innerHTML = '<option value="" selected disabled hidden>Selecciona tu provincia</option>';
        provinceSelect.disabled = !department;
        provinceSelect.classList.add("is-placeholder");
        if (!department || typeof PERU_DEPARTMENTS === "undefined") return;
        sortEs(PERU_DEPARTMENTS[department] || []).forEach(function (name) {
            var opt = document.createElement("option");
            opt.value = name;
            opt.textContent = name;
            provinceSelect.appendChild(opt);
        });
    }

    if (departmentSelect && typeof PERU_DEPARTMENTS !== "undefined") {
        sortEs(Object.keys(PERU_DEPARTMENTS)).forEach(function (department) {
            var opt = document.createElement("option");
            opt.value = department;
            opt.textContent = department;
            departmentSelect.appendChild(opt);
        });
        populateProvinceOptions("");

        departmentSelect.addEventListener("change", function () {
            departmentSelect.classList.toggle("is-placeholder", departmentSelect.value === "");
            populateProvinceOptions(departmentSelect.value);
            refreshConfirm();
        });
    }
    if (provinceSelect) {
        provinceSelect.addEventListener("change", function () {
            provinceSelect.classList.toggle("is-placeholder", provinceSelect.value === "");
        });
    }

    function setFieldValidity(input, errorEl, valid, message) {
        var field = input.closest(".field");
        if (field) field.classList.toggle("field--invalid", !valid);
        input.setAttribute("aria-invalid", valid ? "false" : "true");
        if (errorEl) {
            if (!valid && message) errorEl.textContent = message;
            errorEl.hidden = valid;
        }
    }

    // Teléfono: el campo visible solo admite dígitos (máx. PHONE_DIGITS
    // caracteres); el prefijo +51 es fijo en la interfaz y se recompone
    // en el input oculto #phoneFull para cuando se envíe el formulario.
    var PHONE_PATTERN = new RegExp("^[0-9]{" + PHONE_DIGITS + "}$");
    phoneInput.addEventListener("input", function () {
        var digits = phoneInput.value.replace(/\D/g, "").slice(0, PHONE_DIGITS);
        if (digits !== phoneInput.value) phoneInput.value = digits;
        phoneFullInput.value = PHONE_PATTERN.test(digits) ? "+51" + digits : "";
        if (phoneInput.closest(".field").classList.contains("field--invalid") && PHONE_PATTERN.test(digits)) {
            setFieldValidity(phoneInput, phoneError, true);
        }
        refreshConfirm();
    });
    phoneInput.addEventListener("blur", function () {
        setFieldValidity(phoneInput, phoneError, PHONE_PATTERN.test(phoneInput.value),
            "Ingresa " + PHONE_DIGITS + " dígitos después de +51.");
    });

    // Email: filtra caracteres fuera de lo permitido mientras se escribe
    // y valida el formato completo (usuario@dominio.tld) al salir del campo.
    var EMAIL_DISALLOWED = /[^a-zA-Z0-9._%+@-]/g;
    var EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    emailInput.addEventListener("input", function () {
        var cleaned = emailInput.value.replace(EMAIL_DISALLOWED, "");
        if (cleaned !== emailInput.value) emailInput.value = cleaned;
        if (emailInput.closest(".field").classList.contains("field--invalid") &&
            (cleaned === "" || EMAIL_PATTERN.test(cleaned))) {
            setFieldValidity(emailInput, emailError, true);
        }
        refreshConfirm();
    });
    emailInput.addEventListener("blur", function () {
        var valid = emailInput.value === "" || EMAIL_PATTERN.test(emailInput.value);
        setFieldValidity(emailInput, emailError, valid, "Ingresa un email válido, por ejemplo nombre@dominio.com.");
    });

    contactForm.addEventListener("input", refreshConfirm);

    // ---------- Menú hamburguesa ----------
    function closeMenu() {
        menuToggle.classList.remove("is-open");
        menuToggle.setAttribute("aria-expanded", "false");
        navPanel.classList.remove("is-open");
    }
    menuToggle.addEventListener("click", function () {
        var open = !navPanel.classList.contains("is-open");
        menuToggle.classList.toggle("is-open", open);
        menuToggle.setAttribute("aria-expanded", String(open));
        navPanel.classList.toggle("is-open", open);
    });
    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") closeMenu();
    });
    document.addEventListener("click", function (e) {
        if (!navPanel.classList.contains("is-open")) return;
        if (navPanel.contains(e.target) || menuToggle.contains(e.target)) return;
        closeMenu();
    });

    // ---------- Init ----------
    updateProgress(1);
    refreshConfirm();
})();