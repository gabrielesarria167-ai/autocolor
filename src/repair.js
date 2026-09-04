(function () {
    "use strict";
    var TOTAL_STEPS = 4;
    var CONFIRM_LABELS = { 1: "Guardar y continuar", 4: "Enviar solicitud" };
    var current = 1;
    // `vehicle` ya no lo elige el cliente: sale de la carrocería del modelo
    // que escribe en el paso 1, y es la silueta 3D sobre la que elegirá las
    // piezas en el paso 3.
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

    var carForm = document.getElementById("carForm");
    var brandSelect = document.getElementById("carBrand");
    var modelSelect = document.getElementById("carModel");
    var carYearInput = document.getElementById("carYear");
    var carYearError = document.getElementById("carYearError");
    var carPlateInput = document.getElementById("carPlate");
    var carPlateError = document.getElementById("carPlateError");
    var carMileageInput = document.getElementById("carMileage");
    var carColorCodeInput = document.getElementById("carColorCode");
    var carPreview = document.getElementById("carPreview");
    var carPreviewTitle = document.getElementById("carPreviewTitle");
    var carPreviewType = document.getElementById("carPreviewType");
    var carPreviewPhoto = document.getElementById("carPreviewPhoto");
    var carPreviewLogo = document.getElementById("carPreviewLogo");
    var carPreviewNote = document.getElementById("carPreviewNote");
    var firstNameInput = document.getElementById("firstName");
    var lastNameInput = document.getElementById("lastName");
    var qualityCards = Array.prototype.slice.call(document.querySelectorAll(".quality-card"));
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
    // Part names — the label the client reads for each panel they pick.
    //
    // The keys are the GLB node names, exactly as they come out of the three
    // models (see VEHICLE_MODELS in carVisual.js). One flat map serves all
    // three vehicles because every id they share names the same panel on
    // each. A name missing here degrades to showing the raw node name
    // (renderPartsSummary below), so renaming a node in carVisual.js without
    // renaming it here is a silent downgrade, not an error.
    // ==================================================================

    var PART_LABELS = {
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

    function toggleCarPart(id) {
        var idx = state.parts.indexOf(id);
        if (idx === -1) state.parts.push(id);
        else state.parts.splice(idx, 1);
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

    // ==================================================================
    // Wizard navigation
    // ==================================================================

    function isStepValid(step) {
        if (step === 1) {
            return !!state.vehicle &&
                isYearValid(carYearInput.value) &&
                PLATE_PATTERN.test(carPlateInput.value) &&
                firstNameInput.value.trim() !== "" &&
                lastNameInput.value.trim() !== "";
        }
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
        confirmBtn.textContent = CONFIRM_LABELS[step] || "Continuar";
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
    // El número está también en index.html (dos veces) y en lookup.js. Son
    // cuatro copias; centralizarlas es un cambio aparte y más grande que esto.
    var API_MISSING_MESSAGE = "Todavía no podemos recibir solicitudes desde esta versión del sitio. " +
        "Escríbenos por WhatsApp al +51 935 646 304 con la marca, el modelo y las zonas a pintar, " +
        "y te preparamos el presupuesto.";

    function setSubmitError(message) {
        if (!submitError) return;
        submitError.textContent = message || "";
        submitError.hidden = !message;
    }

    function requestPayload() {
        var car = selectedCar();
        return {
            vehicle: state.vehicle,
            quality: state.quality,
            parts: state.parts,
            // El taller necesita el vehículo con nombre y apellido, no solo la
            // silueta: la marca y el modelo van tal como se muestran, y el
            // tipo de carrocería como lo llama el catálogo.
            brand: car ? car.brand.name : "",
            model: car ? car.model.name : "",
            bodyType: car ? car.model.type : "",
            year: carYearInput.value,
            plate: carPlateInput.value,
            mileage: carMileageInput.value,
            colorCode: carColorCodeInput.value,
            firstName: firstNameInput.value,
            lastName: lastNameInput.value,
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
            confirmBtn.textContent = CONFIRM_LABELS[TOTAL_STEPS];
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

        resetCarForm();
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

    // ==================================================================
    // Paso 1 — datos del vehículo
    //
    // El cliente ya no elige una silueta: escribe qué vehículo tiene y el
    // resto sale de ahí. La marca llena la lista de modelos, el modelo trae
    // su carrocería desde el catálogo (src/carModels.js) y la carrocería
    // decide sola sobre cuál de los tres modelos 3D se pintará en el paso 3.
    // ==================================================================

    var NO_CATALOG = function () { return null; };
    var CATALOG = window.CAR_CATALOG ||
        { brands: [], bodyTypes: {}, findBrand: NO_CATALOG, findModel: NO_CATALOG,
          photoFor: function () { return ""; } };
    var VEHICLE_LABELS = { van: "Furgoneta", wagon: "Familiar", pickup: "Pickup", suv: "SUV" };

    var PLATE_PATTERN = /^[A-Z0-9]{3}-[A-Z0-9]{3}$/;
    var YEAR_MIN = 1980;
    var YEAR_MAX = new Date().getFullYear() + 1;

    // La foto del vehículo, por orden de preferencia:
    //
    //   1. la que trae el sitio, una por modelo, en imgs/assets/stock-models/;
    //   2. la de imagin.studio —recortada, sin fondo, por año— si el taller
    //      tiene clave contratada (ver src/config.js);
    //   3. el logo de la marca, si cualquiera de las dos no carga.
    //
    // Las del sitio son fotos de verdad, con su calle y su fondo detrás, y no
    // dependen de nadie; la ficha las llama «imagen referencial» porque eso
    // son: el modelo, no el vehículo del cliente.
    var CAR_IMAGE_CUSTOMER = window.AUTOCOLOR_CAR_IMAGE_CUSTOMER || "";
    // imagin escribe algunas marcas distinto que nosotros.
    var IMAGE_MAKES = { mercedes: "mercedes-benz" };

    function carPhotoUrl(brand, model, year) {
        if (!CAR_IMAGE_CUSTOMER) return CATALOG.photoFor(brand.id, model.id);
        var url = "https://cdn.imagin.studio/getimage" +
            "?customer=" + encodeURIComponent(CAR_IMAGE_CUSTOMER) +
            "&make=" + encodeURIComponent(IMAGE_MAKES[brand.id] || brand.id) +
            "&modelFamily=" + encodeURIComponent(model.family) +
            "&angle=01&zoomType=fullscreen";
        if (isYearValid(year)) url += "&modelYear=" + encodeURIComponent(year);
        return url;
    }

    function showBrandLogo(brand) {
        carPreviewPhoto.hidden = true;
        carPreviewPhoto.removeAttribute("src");
        carPreviewLogo.style.setProperty("--logo-src", 'url("' + brand.logo + '")');
        carPreviewLogo.style.setProperty("--logo-color", brand.color);
        carPreviewLogo.hidden = false;
    }

    function isYearValid(value) {
        var year = Number(value);
        return /^[0-9]{4}$/.test(value || "") && year >= YEAR_MIN && year <= YEAR_MAX;
    }

    function selectedCar() {
        if (!brandSelect || !brandSelect.value || !modelSelect.value) return null;
        var brand = CATALOG.findBrand(brandSelect.value);
        var model = CATALOG.findModel(brandSelect.value, modelSelect.value);
        if (!brand || !model) return null;
        return { brand: brand, model: model, body: CATALOG.bodyTypes[model.type] || null };
    }

    // El único punto donde cambia state.vehicle. Cambiarlo invalida las piezas
    // ya elegidas: cada modelo 3D nombra y reparte sus paneles a su manera, así
    // que una selección hecha sobre una silueta no significa lo mismo en otra.
    function setVehicle(next) {
        if (state.vehicle === next) return;
        if (state.parts.length) {
            state.parts = [];
            renderPartsSummary();
            if (car3d) car3d.refreshSelection();
        }
        state.vehicle = next;
    }

    function populateModelOptions(brandId) {
        modelSelect.innerHTML = '<option value="" selected disabled hidden>Seleccionar modelo</option>';
        var brand = CATALOG.findBrand(brandId);
        modelSelect.disabled = !brand;
        modelSelect.classList.add("is-placeholder");
        if (!brand) return;
        brand.models.forEach(function (model) {
            var opt = document.createElement("option");
            opt.value = model.id;
            opt.textContent = model.name;
            modelSelect.appendChild(opt);
        });
    }

    function updateCarPreview() {
        var car = selectedCar();
        if (!car || !car.body) {
            carPreview.hidden = true;
            setVehicle(null);
            return;
        }

        setVehicle(car.body.vehicle);
        carPreviewTitle.textContent = car.brand.name + " " + car.model.name;
        carPreviewType.textContent = car.body.label;

        // Cuando la carrocería no tiene modelo 3D propio (un sedán, una
        // pickup) se pinta sobre el más parecido. Vale más decirlo aquí que
        // dejar que la sorpresa llegue en el paso 3. Se comparan las claves y
        // no las etiquetas: 'wagon' se llama «Station wagon» en el catálogo y
        // «Familiar» en el visor, pero es la misma silueta.
        var scheme = VEHICLE_LABELS[car.body.vehicle];
        var borrowed = car.model.type !== car.body.vehicle;
        carPreviewNote.textContent = borrowed
            ? "En el paso 3 elegirás las piezas sobre el esquema " + scheme + ", el más parecido a tu vehículo."
            : "";
        carPreviewNote.hidden = !borrowed;

        var photo = carPhotoUrl(car.brand, car.model, carYearInput.value);
        if (photo) {
            carPreviewPhoto.alt = "Imagen referencial de un " + car.brand.name + " " + car.model.name;
            carPreviewPhoto.hidden = false;
            carPreviewLogo.hidden = true;
            carPreviewPhoto.src = photo;
        } else {
            showBrandLogo(car.brand);
        }

        carPreview.hidden = false;
    }

    if (carForm) {
        CATALOG.brands.forEach(function (brand) {
            var opt = document.createElement("option");
            opt.value = brand.id;
            opt.textContent = brand.name;
            brandSelect.appendChild(opt);
        });

        // Una foto que no llega (sin conexión, modelo que el proveedor no
        // tiene) no deja el hueco vacío: cae al logo de la marca.
        carPreviewPhoto.addEventListener("error", function () {
            var car = selectedCar();
            if (car) showBrandLogo(car.brand);
        });

        brandSelect.addEventListener("change", function () {
            brandSelect.classList.toggle("is-placeholder", brandSelect.value === "");
            populateModelOptions(brandSelect.value);
            updateCarPreview();
            refreshConfirm();
        });

        modelSelect.addEventListener("change", function () {
            modelSelect.classList.toggle("is-placeholder", modelSelect.value === "");
            updateCarPreview();
            refreshConfirm();
        });

        // Año: cuatro dígitos dentro de un rango razonable. El proveedor de
        // imágenes lo usa para traer la generación correcta, así que un año
        // nuevo vuelve a pedir la foto.
        carYearInput.addEventListener("input", function () {
            var digits = carYearInput.value.replace(/\D/g, "").slice(0, 4);
            if (digits !== carYearInput.value) carYearInput.value = digits;
            if (carYearInput.closest(".field").classList.contains("field--invalid") && isYearValid(digits)) {
                setFieldValidity(carYearInput, carYearError, true);
            }
            refreshConfirm();
        });
        carYearInput.addEventListener("change", function () {
            if (isYearValid(carYearInput.value)) updateCarPreview();
        });
        carYearInput.addEventListener("blur", function () {
            setFieldValidity(carYearInput, carYearError, isYearValid(carYearInput.value),
                "Ingresa un año entre " + YEAR_MIN + " y " + YEAR_MAX + ".");
        });

        // Placa peruana: tres caracteres, guion y tres más (ABC-123). El guion
        // lo pone el campo para que nadie tenga que adivinar el formato.
        carPlateInput.addEventListener("input", function () {
            var raw = carPlateInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
            var formatted = raw.length > 3 ? raw.slice(0, 3) + "-" + raw.slice(3) : raw;
            if (formatted !== carPlateInput.value) carPlateInput.value = formatted;
            if (carPlateInput.closest(".field").classList.contains("field--invalid") &&
                PLATE_PATTERN.test(formatted)) {
                setFieldValidity(carPlateInput, carPlateError, true);
            }
            refreshConfirm();
        });
        carPlateInput.addEventListener("blur", function () {
            setFieldValidity(carPlateInput, carPlateError, PLATE_PATTERN.test(carPlateInput.value),
                "Ingresa la placa con tres caracteres, guion y tres más. Por ejemplo ABC-123.");
        });

        carMileageInput.addEventListener("input", function () {
            var digits = carMileageInput.value.replace(/\D/g, "").slice(0, 7);
            if (digits !== carMileageInput.value) carMileageInput.value = digits;
        });

        carForm.addEventListener("input", refreshConfirm);
    }

    function resetCarForm() {
        if (!carForm) return;
        carForm.reset();
        populateModelOptions("");
        brandSelect.classList.add("is-placeholder");
        modelSelect.classList.add("is-placeholder");
        carPreview.hidden = true;
        [carYearInput, carPlateInput].forEach(function (input) {
            setFieldValidity(input, input === carYearInput ? carYearError : carPlateError, true);
        });
    }

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
    confirmBtn.textContent = CONFIRM_LABELS[1];
    refreshConfirm();
})();