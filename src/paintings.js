/* =========================================================================
   paintings.js — el asistente de venta de matizado (pgs/paintings.html)

   Cuatro pasos: el color, el envase, la empresa y el resumen. Se parece al
   asistente de cotización (src/repair.js) y comparte con él la carcasa, la
   barra de pasos y el pie, pero no el recorrido: aquí hay un camino que
   termina antes.

   EL CAMINO CORTO. Quien elige resolver el color en el taller no puede elegir
   cantidad ni ver precio: las dos cosas salen de la fórmula, y la fórmula
   todavía no existe. Ese pedido salta el paso 2 —ida y vuelta— y llega al
   resumen sin envase. Lo que se confirma entonces es una visita, y así lo
   dicen el resumen y el correo.

   Nada de lo que se ve aquí decide el precio final: los importes son
   referenciales (ver src/paints.js) y el taller los cierra al matizar.
   ========================================================================= */

(function () {
    "use strict";

    var TOTAL_STEPS = 4;
    var CONFIRM_LABELS = { 4: "Confirmar pedido" };

    // El catálogo. Guardado como en repair.js: sin él la página no sirve, pero
    // un archivo que no llegó no puede además llevarse por delante los
    // escuchadores de más abajo con un TypeError en la primera línea.
    var PAINTS = window.AUTOCOLOR_PAINTS || null;

    var state = {
        // 'code' | 'reading' | 'in_person' — cómo se identificó el color.
        method: "code",
        // El color encontrado, con su marca, código, nombre y acabado. En el
        // camino del taller se queda en null y así viaja al servidor.
        colour: null,
        // La medición que se escribió en la lectura digital, para poder
        // contarla en el resumen y en el correo: es lo que el taller usará
        // para ajustar la fórmula.
        reading: null,
        size: null,
        units: 1
    };

    var current = 1;

    var steps = Array.prototype.slice.call(document.querySelectorAll(".step"));
    var dots = Array.prototype.slice.call(document.querySelectorAll(".progress-dot"));
    var lines = Array.prototype.slice.call(document.querySelectorAll(".progress-line"));
    var progressNav = document.querySelector(".progress");
    var wizardFoot = document.querySelector(".wizard-foot");
    var backLink = document.getElementById("backLink");
    var confirmBtn = document.getElementById("stepConfirm");
    var stepHint = document.getElementById("stepHint");
    var successPanel = document.getElementById("success");
    var successLead = document.getElementById("successLead");
    var successCode = document.getElementById("successCode");
    var copyCodeBtn = document.getElementById("copyCodeBtn");
    var submitError = document.getElementById("submitError");

    var methodTabs = Array.prototype.slice.call(document.querySelectorAll(".method-tabs .view-tab"));
    var methodPanels = {
        code: document.getElementById("methodPanelCode"),
        reading: document.getElementById("methodPanelReading"),
        in_person: document.getElementById("methodPanelShop")
    };

    var brandSelect = document.getElementById("colorBrand");
    var codeInput = document.getElementById("colorCode");
    var codeSearchBtn = document.getElementById("colorSearch");
    var readingL = document.getElementById("readingL");
    var readingA = document.getElementById("readingA");
    var readingB = document.getElementById("readingB");
    var readingSearchBtn = document.getElementById("readingSearch");

    var colourCard = document.getElementById("colourCard");
    var colourSwatch = document.getElementById("colourSwatch");
    var colourStatus = document.getElementById("colourStatus");
    var colourName = document.getElementById("colourName");
    var colourBrand = document.getElementById("colourBrand");
    var colourCode = document.getElementById("colourCode");
    var colourFinish = document.getElementById("colourFinish");
    var colourNote = document.getElementById("colourNote");
    var colourMiss = document.getElementById("colourMiss");

    var sizeCards = document.getElementById("sizeCards");
    var orderBar = document.getElementById("orderBar");
    var orderTotal = document.getElementById("orderTotal");
    var unitsValue = document.getElementById("unitsValue");
    var unitsDown = document.getElementById("unitsDown");
    var unitsUp = document.getElementById("unitsUp");
    var unitsNote = document.getElementById("unitsNote");

    var companyForm = document.getElementById("companyForm");
    var companyName = document.getElementById("companyName");
    var companyRuc = document.getElementById("companyRuc");
    var companyRucError = document.getElementById("companyRucError");
    var firstNameInput = document.getElementById("firstName");
    var lastNameInput = document.getElementById("lastName");
    var departmentSelect = document.getElementById("department");
    var provinceSelect = document.getElementById("province");
    var phoneInput = document.getElementById("phone");
    var phoneError = document.getElementById("phoneError");
    var emailInput = document.getElementById("email");
    var emailError = document.getElementById("emailError");
    var notesInput = document.getElementById("notes");

    var summaryBox = document.getElementById("summary");
    var summaryPrice = document.getElementById("summaryPrice");
    var summaryTotal = document.getElementById("summaryTotal");
    var summaryLegal = document.getElementById("summaryLegal");

    var PHONE_DIGITS = 9;
    var PHONE_PATTERN = /^[0-9]{9}$/;
    var EMAIL_DISALLOWED = /[^a-zA-Z0-9._%+@-]/g;
    var EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    // RUC peruano: once dígitos que empiezan por el tipo de contribuyente. 20
    // es el de las personas jurídicas —lo normal aquí—, pero 10, 15 y 17
    // también compran, así que se aceptan los cuatro y se rechaza el resto,
    // que es un número que SUNAT no emitiría.
    var RUC_PATTERN = /^(10|15|17|20)[0-9]{9}$/;

    /* ---------------------------------------------------------------------
       Pie del asistente: el botón dice qué falta en vez de apagarse
       (mismo trato que en src/repair.js).
       --------------------------------------------------------------------- */

    function setStepHint(message) {
        if (!stepHint) return;
        stepHint.textContent = message || "";
        stepHint.hidden = !message;
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

    function isStepValid(step) {
        if (step === 1) {
            // El taller no necesita color: el pedido es la visita.
            return state.method === "in_person" || !!state.colour;
        }
        if (step === 2) return !!state.size;
        if (step === 3) {
            return companyName.value.trim() !== "" &&
                RUC_PATTERN.test(companyRuc.value) &&
                firstNameInput.value.trim() !== "" &&
                lastNameInput.value.trim() !== "" &&
                !!departmentSelect.value &&
                !!provinceSelect.value &&
                PHONE_PATTERN.test(phoneInput.value) &&
                EMAIL_PATTERN.test(emailInput.value);
        }
        return true;
    }

    function refreshConfirm() {
        var valid = isStepValid(current);
        confirmBtn.setAttribute("aria-disabled", String(!valid));
        if (valid) setStepHint("");
    }

    function explainStep(step) {
        var first = null;
        function need(ok, control) {
            if (!ok && !first) first = control;
        }

        if (step === 1) {
            if (state.method === "code") {
                need(!!brandSelect.value, brandSelect);
                need(codeInput.value.trim() !== "", codeInput);
                setStepHint("Busca tu código de color para continuar.");
            } else {
                first = readingL;
                setStepHint("Busca la coincidencia de tu lectura para continuar.");
            }
        } else if (step === 2) {
            first = sizeCards.querySelector(".size-card");
            setStepHint("Elige un envase para continuar.");
        } else if (step === 3) {
            need(companyName.value.trim() !== "", companyName);
            var rucOk = RUC_PATTERN.test(companyRuc.value);
            setFieldValidity(companyRuc, companyRucError, rucOk,
                "Ingresa los 11 dígitos del RUC, por ejemplo 20123456789.");
            need(rucOk, companyRuc);
            need(firstNameInput.value.trim() !== "", firstNameInput);
            need(lastNameInput.value.trim() !== "", lastNameInput);
            need(!!departmentSelect.value, departmentSelect);
            need(!!provinceSelect.value, provinceSelect);
            var phoneOk = PHONE_PATTERN.test(phoneInput.value);
            setFieldValidity(phoneInput, phoneError, phoneOk, "Ingresa " + PHONE_DIGITS + " dígitos después de +51.");
            need(phoneOk, phoneInput);
            var emailOk = EMAIL_PATTERN.test(emailInput.value);
            setFieldValidity(emailInput, emailError, emailOk, emailInput.value === ""
                ? "Escribe tu email: ahí te enviamos el código del pedido."
                : "Ingresa un email válido, por ejemplo nombre@dominio.com.");
            need(emailOk, emailInput);
            setStepHint("Completa los datos marcados para continuar.");
        }

        if (first && typeof first.focus === "function") first.focus();
    }

    /* ---------------------------------------------------------------------
       Navegación

       El paso 2 se salta entero cuando el color se resuelve en el taller, en
       los dos sentidos: stepAfter() y stepBefore() son los únicos sitios que
       saben del salto, para que no haya que acordarse de él en cada botón.
       --------------------------------------------------------------------- */

    function skipsQuantity() {
        return state.method === "in_person";
    }

    function stepAfter(step) {
        var next = step + 1;
        if (next === 2 && skipsQuantity()) next = 3;
        return Math.min(next, TOTAL_STEPS);
    }

    function stepBefore(step) {
        var previous = step - 1;
        if (previous === 2 && skipsQuantity()) previous = 1;
        return Math.max(previous, 1);
    }

    function updateProgress(step) {
        dots.forEach(function (dot) {
            var n = Number(dot.dataset.step);
            dot.classList.remove("is-current", "is-done", "is-skipped");
            dot.removeAttribute("aria-current");
            // El paso saltado no se borra de la barra: se marca. Una barra que
            // pierde un punto al elegir una opción se lee como un error.
            if (n === 2 && skipsQuantity()) {
                dot.classList.add("is-skipped");
                dot.title = "No aplica: el envase se decide en el taller";
                return;
            }
            dot.removeAttribute("title");
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
        setStepHint("");
        if (step === 2) renderSizeCards();
        if (step === 4) renderSummary();
        refreshConfirm();

        var heading = document.querySelector('.step[data-step="' + step + '"] h1');
        if (heading) { heading.setAttribute("tabindex", "-1"); heading.focus(); }
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    backLink.addEventListener("click", function () {
        if (submitting) return;
        if (current > 1) goTo(stepBefore(current));
    });

    confirmBtn.addEventListener("click", function () {
        if (!isStepValid(current)) {
            explainStep(current);
            return;
        }
        if (current < TOTAL_STEPS) goTo(stepAfter(current));
        else submitOrder();
    });

    /* ---------------------------------------------------------------------
       Paso 1 — el color
       --------------------------------------------------------------------- */

    function setMethod(method) {
        if (state.method === method) return;
        state.method = method;

        methodTabs.forEach(function (tab) {
            var active = tab.dataset.method === method;
            tab.classList.toggle("is-active", active);
            tab.setAttribute("aria-pressed", String(active));
        });
        Object.keys(methodPanels).forEach(function (key) {
            if (methodPanels[key]) methodPanels[key].hidden = key !== method;
        });

        // Cambiar de camino tira el color encontrado por el anterior: si se
        // quedara puesto, el resumen mostraría un color que ya no se buscó
        // como dice la ficha.
        clearColour();
        updateProgress(current);
        refreshConfirm();
    }

    methodTabs.forEach(function (tab) {
        tab.addEventListener("click", function () { setMethod(tab.dataset.method); });
    });

    function clearColour() {
        state.colour = null;
        state.reading = null;
        if (colourCard) colourCard.hidden = true;
        if (colourMiss) colourMiss.hidden = true;
    }

    function showColour(colour, quality) {
        state.colour = colour;
        colourSwatch.style.background = colour.hex;
        colourStatus.textContent = quality ? quality.label : "Color encontrado";
        colourStatus.className = "colour-card__status" + (quality ? " is-" + quality.level : "");
        colourName.textContent = colour.name;
        colourBrand.textContent = colour.brand;
        colourCode.textContent = colour.code;
        colourFinish.textContent = PAINTS.finishLabel(colour.finish);

        var finish = PAINTS.FINISHES[colour.finish];
        var note = finish ? finish.note : "";
        // La muestra en pantalla es una aproximación y hay que decirlo donde
        // se la está mirando: un metálico no cabe en un rectángulo de color, y
        // quien compra por la muestra reclama después.
        colourNote.textContent = note + " La muestra es referencial: el color se aprueba con plancha de prueba.";

        colourCard.hidden = false;
        colourMiss.hidden = true;
        refreshConfirm();
    }

    function showMiss(message) {
        state.colour = null;
        colourCard.hidden = true;
        colourMiss.textContent = message;
        colourMiss.hidden = false;
        refreshConfirm();
    }

    function searchByCode() {
        if (!PAINTS) return;
        var brandId = brandSelect.value;
        var code = codeInput.value.trim();
        if (!brandId || code === "") {
            explainStep(1);
            return;
        }
        var colour = PAINTS.findColour(brandId, code);
        if (colour) {
            showColour(colour, null);
            return;
        }
        showMiss("No tenemos «" + code.toUpperCase() + "» en el catálogo de " +
            PAINTS.brandName(brandId) + ". Revisa el código en la etiqueta, o usa la lectura digital " +
            "o el taller: los colores que no están en la lista los preparamos midiendo la pieza.");
    }

    if (codeSearchBtn) codeSearchBtn.addEventListener("click", searchByCode);

    if (codeInput) {
        codeInput.addEventListener("keydown", function (e) {
            // Enter busca, y no envía nada: el campo no vive dentro de un
            // <form>, pero el teclado del móvil ofrece «ir» igual.
            if (e.key === "Enter") {
                e.preventDefault();
                searchByCode();
            }
        });
        // Un código a medio escribir ya no describe la ficha que hay debajo.
        codeInput.addEventListener("input", clearColour);
    }

    if (brandSelect) {
        brandSelect.addEventListener("change", function () {
            brandSelect.classList.toggle("is-placeholder", brandSelect.value === "");
            clearColour();
            refreshConfirm();
        });
    }

    // Lectura digital: tres números, el catálogo ordenado por distancia y el
    // primero enseñado con lo cerca que queda.
    function parseReading(input, min, max) {
        var raw = input.value.trim().replace(",", ".");
        if (raw === "") return null;
        var value = Number(raw);
        if (!isFinite(value) || value < min || value > max) return null;
        return value;
    }

    function searchByReading() {
        if (!PAINTS) return;
        var L = parseReading(readingL, 0, 100);
        var a = parseReading(readingA, -128, 128);
        var b = parseReading(readingB, -128, 128);

        [[readingL, L], [readingA, a], [readingB, b]].forEach(function (pair) {
            setFieldValidity(pair[0], null, pair[1] !== null);
        });

        if (L === null || a === null || b === null) {
            showMiss("Revisa los tres valores: L* va de 0 a 100, y a* y b* de -128 a 128.");
            var firstBad = L === null ? readingL : (a === null ? readingA : readingB);
            firstBad.focus();
            return;
        }

        var reading = { L: L, a: a, b: b };
        var matches = PAINTS.nearest(reading, 1);
        if (matches.length === 0) {
            showMiss("No pudimos comparar la lectura con el catálogo. Tráenos la pieza y la medimos aquí.");
            return;
        }

        state.reading = reading;
        var match = matches[0];
        showColour(match, PAINTS.matchQuality(match.delta));
        // Lo que se le promete a quien mide con su propio equipo: el catálogo
        // da un punto de partida, no una fórmula aprobada.
        colourNote.textContent = "ΔE " + match.delta.toFixed(1) + " respecto de tu lectura. " +
            "Partimos de esta fórmula y la ajustamos con plancha de prueba antes de entregar.";
    }

    if (readingSearchBtn) readingSearchBtn.addEventListener("click", searchByReading);

    [readingL, readingA, readingB].forEach(function (input) {
        if (!input) return;
        input.addEventListener("input", function () {
            // Números con signo y un decimal: lo que entrega el equipo.
            var cleaned = input.value.replace(/[^0-9.,-]/g, "");
            if (cleaned !== input.value) input.value = cleaned;
            clearColour();
        });
        input.addEventListener("keydown", function (e) {
            if (e.key === "Enter") {
                e.preventDefault();
                searchByReading();
            }
        });
    });

    /* ---------------------------------------------------------------------
       Paso 2 — el envase
       --------------------------------------------------------------------- */

    function unitPrice() {
        if (!PAINTS || !state.size || !state.colour) return null;
        return PAINTS.price(state.size, state.colour.finish);
    }

    function orderTotalAmount() {
        var unit = unitPrice();
        return unit === null ? null : unit * state.units;
    }

    // Las seis tarjetas se construyen una sola vez; los precios, cada vez que
    // se entra al paso, porque dependen del acabado del color elegido y ese
    // puede cambiar volviendo atrás (un sólido y un tricapa no cuestan igual).
    function renderSizeCards() {
        if (!sizeCards || !PAINTS) return;
        if (sizeCards.childElementCount > 0) {
            refreshSizePrices();
            return;
        }

        PAINTS.SIZES.forEach(function (size) {
            var card = document.createElement("button");
            card.type = "button";
            card.className = "size-card";
            card.setAttribute("role", "radio");
            card.setAttribute("aria-checked", "false");
            card.dataset.size = size.id;

            // Los seis envases dibujados: el mismo bote a distintos tamaños,
            // apoyados en una misma línea. Es la comparación que de verdad
            // hace falta —cuál es más grande que cuál— y no depende de
            // ninguna imagen. El lado crece con la raíz cúbica del volumen,
            // que es como crece un recipiente de verdad: doble de pintura no
            // es doble de alto.
            var stage = document.createElement("span");
            stage.className = "size-card__stage";
            stage.setAttribute("aria-hidden", "true");

            var jar = document.createElement("span");
            jar.className = "size-card__jar";
            jar.style.setProperty("--fill", Math.pow(size.gallons, 1 / 3).toFixed(3));
            stage.appendChild(jar);

            var fraction = document.createElement("span");
            fraction.className = "size-card__fraction";
            fraction.textContent = size.label;

            var volume = document.createElement("span");
            volume.className = "size-card__volume";
            volume.textContent = size.volume;

            var use = document.createElement("span");
            use.className = "size-card__use";
            use.textContent = size.use;

            var price = document.createElement("span");
            price.className = "size-card__price";
            var amount = state.colour ? PAINTS.price(size.id, state.colour.finish) : null;
            price.textContent = amount === null ? "" : PAINTS.formatSoles(amount);

            card.appendChild(stage);
            card.appendChild(fraction);
            card.appendChild(volume);
            card.appendChild(use);
            card.appendChild(price);

            card.addEventListener("click", function () { selectSize(size.id); });
            sizeCards.appendChild(card);
        });
    }

    function refreshSizePrices() {
        Array.prototype.forEach.call(sizeCards.querySelectorAll(".size-card"), function (card) {
            var price = card.querySelector(".size-card__price");
            if (!price) return;
            var amount = state.colour ? PAINTS.price(card.dataset.size, state.colour.finish) : null;
            price.textContent = amount === null ? "" : PAINTS.formatSoles(amount);
        });
        renderOrderBar();
    }

    function selectSize(id) {
        state.size = id;
        Array.prototype.forEach.call(sizeCards.querySelectorAll(".size-card"), function (card) {
            var selected = card.dataset.size === id;
            card.classList.toggle("is-selected", selected);
            card.setAttribute("aria-checked", String(selected));
        });
        renderOrderBar();
        refreshConfirm();
    }

    function renderOrderBar() {
        if (!orderBar) return;
        if (!state.size) {
            orderBar.hidden = true;
            if (unitsNote) unitsNote.hidden = true;
            return;
        }
        orderBar.hidden = false;
        unitsValue.textContent = String(state.units);
        unitsDown.disabled = state.units <= 1;
        unitsUp.disabled = state.units >= PAINTS.MAX_UNITS;

        var total = orderTotalAmount();
        orderTotal.textContent = total === null ? "A cotizar" : PAINTS.formatSoles(total);

        if (unitsNote) {
            var size = PAINTS.size(state.size);
            var litres = size ? (size.ml * state.units) : 0;
            var volume = litres >= 1000
                ? (litres / 1000).toFixed(2).replace(/0$/, "") + " L"
                : litres + " ml";
            unitsNote.textContent = state.units === PAINTS.MAX_UNITS
                ? "Son " + volume + " en total. Para pedidos mayores, hablémoslo: escríbenos y lo preparamos como entrega programada."
                : "Son " + volume + " en total. Precio referencial: el taller lo cierra al matizar.";
            unitsNote.hidden = false;
        }
    }

    function setUnits(next) {
        var limit = PAINTS ? PAINTS.MAX_UNITS : 20;
        state.units = Math.max(1, Math.min(limit, next));
        renderOrderBar();
    }

    if (unitsDown) unitsDown.addEventListener("click", function () { setUnits(state.units - 1); });
    if (unitsUp) unitsUp.addEventListener("click", function () { setUnits(state.units + 1); });

    /* ---------------------------------------------------------------------
       Paso 3 — la empresa
       --------------------------------------------------------------------- */

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
            refreshConfirm();
        });
    }

    if (companyRuc) {
        companyRuc.addEventListener("input", function () {
            var digits = companyRuc.value.replace(/\D/g, "").slice(0, 11);
            if (digits !== companyRuc.value) companyRuc.value = digits;
            if (companyRuc.closest(".field").classList.contains("field--invalid") && RUC_PATTERN.test(digits)) {
                setFieldValidity(companyRuc, companyRucError, true);
            }
            refreshConfirm();
        });
        companyRuc.addEventListener("blur", function () {
            if (companyRuc.value === "") return;
            setFieldValidity(companyRuc, companyRucError, RUC_PATTERN.test(companyRuc.value),
                "Ingresa los 11 dígitos del RUC, por ejemplo 20123456789.");
        });
    }

    if (phoneInput) {
        phoneInput.addEventListener("input", function () {
            var digits = phoneInput.value.replace(/\D/g, "").slice(0, PHONE_DIGITS);
            if (digits !== phoneInput.value) phoneInput.value = digits;
            if (phoneInput.closest(".field").classList.contains("field--invalid") && PHONE_PATTERN.test(digits)) {
                setFieldValidity(phoneInput, phoneError, true);
            }
            refreshConfirm();
        });
        phoneInput.addEventListener("blur", function () {
            if (phoneInput.value === "") return;
            setFieldValidity(phoneInput, phoneError, PHONE_PATTERN.test(phoneInput.value),
                "Ingresa " + PHONE_DIGITS + " dígitos después de +51.");
        });
    }

    if (emailInput) {
        emailInput.addEventListener("input", function () {
            var cleaned = emailInput.value.replace(EMAIL_DISALLOWED, "");
            if (cleaned !== emailInput.value) emailInput.value = cleaned;
            if (emailInput.closest(".field").classList.contains("field--invalid") &&
                EMAIL_PATTERN.test(cleaned)) {
                setFieldValidity(emailInput, emailError, true);
            }
            refreshConfirm();
        });
        emailInput.addEventListener("blur", function () {
            if (emailInput.value === "") return;
            setFieldValidity(emailInput, emailError, EMAIL_PATTERN.test(emailInput.value),
                "Ingresa un email válido, por ejemplo nombre@dominio.com.");
        });
    }

    if (companyForm) companyForm.addEventListener("input", refreshConfirm);

    /* ---------------------------------------------------------------------
       Paso 4 — el resumen

       Cada bloque lleva su enlace al paso donde se cambia. Es la pantalla
       donde alguien descubre que se equivocó de envase, y mandarlo a buscar
       el botón «Atrás» tres veces es peor que ponerle el atajo.
       --------------------------------------------------------------------- */

    function summaryBlock(title, step, rows, extra) {
        var section = document.createElement("section");
        section.className = "summary__block";

        var head = document.createElement("div");
        head.className = "summary__head";

        var heading = document.createElement("h2");
        heading.textContent = title;
        head.appendChild(heading);

        if (step) {
            var edit = document.createElement("button");
            edit.type = "button";
            edit.className = "summary__edit";
            edit.textContent = "Cambiar";
            edit.setAttribute("aria-label", "Cambiar " + title.toLowerCase());
            edit.addEventListener("click", function () { goTo(step); });
            head.appendChild(edit);
        }

        section.appendChild(head);

        var list = document.createElement("dl");
        list.className = "summary__rows";
        rows.forEach(function (row) {
            if (!row || row.value === "" || row.value === null || row.value === undefined) return;
            var wrap = document.createElement("div");
            var dt = document.createElement("dt");
            dt.textContent = row.label;
            var dd = document.createElement("dd");
            dd.textContent = row.value;
            if (row.mono) dd.className = "summary__mono";
            wrap.appendChild(dt);
            wrap.appendChild(dd);
            list.appendChild(wrap);
        });
        section.appendChild(list);

        if (extra) section.appendChild(extra);
        return section;
    }

    var METHOD_LABELS = {
        code: "Por código de color",
        reading: "Lectura digital",
        in_person: "Lectura en el taller"
    };

    function renderSummary() {
        if (!summaryBox) return;
        summaryBox.innerHTML = "";

        // El color -----------------------------------------------------
        var colourRows = [{ label: "Identificado", value: METHOD_LABELS[state.method] }];
        var swatch = null;

        if (state.colour) {
            colourRows.push({ label: "Marca", value: state.colour.brand });
            colourRows.push({ label: "Código", value: state.colour.code, mono: true });
            colourRows.push({ label: "Color", value: state.colour.name });
            colourRows.push({ label: "Acabado", value: PAINTS.finishLabel(state.colour.finish) });
            if (state.reading) {
                colourRows.push({
                    label: "Tu lectura",
                    value: "L* " + state.reading.L + " · a* " + state.reading.a + " · b* " + state.reading.b,
                    mono: true
                });
            }
            swatch = document.createElement("span");
            swatch.className = "summary__swatch";
            swatch.style.background = state.colour.hex;
            swatch.setAttribute("aria-hidden", "true");
        } else {
            colourRows.push({ label: "Color", value: "Se mide en el taller, con el vehículo delante" });
        }

        var colourSection = summaryBlock("El color", 1, colourRows);
        if (swatch) colourSection.querySelector(".summary__head").appendChild(swatch);
        summaryBox.appendChild(colourSection);

        // El pedido ----------------------------------------------------
        if (skipsQuantity()) {
            var pending = document.createElement("p");
            pending.className = "summary__pending";
            pending.textContent = "El envase y el precio se deciden en el taller, cuando el color esté aprobado. " +
                "Lo que confirmas ahora es la visita.";
            summaryBox.appendChild(summaryBlock("El pedido", null, [], pending));
        } else {
            var size = PAINTS.size(state.size);
            var unit = unitPrice();
            summaryBox.appendChild(summaryBlock("El pedido", 2, [
                { label: "Envase", value: size ? size.label : "" },
                { label: "Volumen", value: size ? size.volume + " cada uno" : "" },
                { label: "Unidades", value: String(state.units) },
                { label: "Precio unitario", value: unit === null ? "A cotizar" : PAINTS.formatSoles(unit) }
            ]));
        }

        // La empresa ---------------------------------------------------
        summaryBox.appendChild(summaryBlock("La empresa", 3, [
            { label: "Razón social", value: companyName.value.trim() },
            { label: "RUC", value: companyRuc.value.trim(), mono: true },
            { label: "Contacto", value: firstNameInput.value.trim() + " " + lastNameInput.value.trim() },
            { label: "Zona", value: provinceSelect.value && departmentSelect.value
                ? provinceSelect.value + ", " + departmentSelect.value : "" },
            { label: "Teléfono", value: "+51 " + phoneInput.value, mono: true },
            { label: "Email", value: emailInput.value.trim() },
            { label: "Notas", value: notesInput.value.trim() }
        ]));

        // El precio ----------------------------------------------------
        var total = skipsQuantity() ? null : orderTotalAmount();
        if (summaryPrice) {
            summaryPrice.hidden = total === null;
            if (total !== null) summaryTotal.textContent = PAINTS.formatSoles(total);
        }
        if (summaryLegal) {
            summaryLegal.textContent = total === null
                ? "Al confirmar te enviamos el código de la visita por correo y quedas en nuestra agenda."
                : "Precio referencial, sin IGV. Al confirmar te enviamos el código del pedido por correo; " +
                  "el taller cierra el precio al matizar el color.";
        }
    }

    /* ---------------------------------------------------------------------
       Envío

       Mismo trato que el asistente de cotización: hasta que el servidor no
       confirma, no hay pantalla de éxito. Ver src/repair.js para el porqué de
       cada rama del error.
       --------------------------------------------------------------------- */

    var ORDERS_ENDPOINT = (window.AUTOCOLOR_API_BASE || "") + "/api/paint-orders";
    var API_MISSING_STATUS = [404, 405, 501];
    var API_MISSING_MESSAGE = "Todavía no podemos recibir pedidos desde esta versión del sitio. " +
        "Escríbenos por WhatsApp al +51 935 646 304 con la marca, el código de color y el envase, " +
        "y lo preparamos.";
    var submitting = false;

    function setSubmitError(message) {
        if (!submitError) return;
        submitError.textContent = message || "";
        submitError.hidden = !message;
    }

    function orderPayload() {
        return {
            method: state.method,
            // Sin color en el camino del taller: los tres campos viajan vacíos
            // y el servidor los acepta así (ver validatePaintOrder).
            brand: state.colour ? state.colour.brand : "",
            brandId: state.colour ? state.colour.brandId : "",
            colorCode: state.colour ? state.colour.code : "",
            colorName: state.colour ? state.colour.name : "",
            finish: state.colour ? state.colour.finish : "",
            reading: state.reading,
            size: skipsQuantity() ? "" : state.size,
            units: skipsQuantity() ? null : state.units,
            // El precio que el cliente tenía delante al confirmar. Se guarda
            // para que el taller sepa qué se le prometió, no para cobrarlo:
            // el servidor no lo recalcula y la página lo llama referencial.
            price: skipsQuantity() ? null : orderTotalAmount(),
            company: companyName.value,
            ruc: companyRuc.value,
            firstName: firstNameInput.value,
            lastName: lastNameInput.value,
            department: departmentSelect.value,
            province: provinceSelect.value,
            phone: "+51" + phoneInput.value.replace(/\D/g, ""),
            email: emailInput.value,
            notes: notesInput.value
        };
    }

    function submitOrder() {
        if (submitting) return;
        submitting = true;
        setSubmitError("");
        confirmBtn.disabled = true;
        backLink.disabled = true;
        confirmBtn.textContent = "Enviando…";

        fetch(ORDERS_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(orderPayload())
        }).then(function (response) {
            if (API_MISSING_STATUS.indexOf(response.status) !== -1) {
                throw new Error(API_MISSING_MESSAGE);
            }
            return response.json().catch(function () { return {}; }).then(function (body) {
                if (!response.ok) {
                    throw new Error(body.error || "No pudimos enviar tu pedido. Inténtalo nuevamente.");
                }
                return body;
            });
        }).then(function (created) {
            showSuccess(created.id);
        }).catch(function (err) {
            console.error("[paintings] Could not send the order:", err);
            var offline = err instanceof TypeError;
            setSubmitError(offline
                ? "No pudimos conectar con el servidor. Revisa tu conexión e inténtalo nuevamente."
                : err.message);
        }).then(function () {
            submitting = false;
            confirmBtn.disabled = false;
            backLink.disabled = false;
            confirmBtn.textContent = CONFIRM_LABELS[current] || "Continuar";
            refreshConfirm();
        });
    }

    function showSuccess(id) {
        if (successCode) successCode.textContent = id || "";
        if (successLead) {
            successLead.textContent = skipsQuantity()
                ? "Te esperamos en el taller con el vehículo o la pieza. Te enviamos el código por correo a " +
                  emailInput.value.trim() + "."
                : "Estamos preparando tu matizado. Te enviamos el código por correo a " +
                  emailInput.value.trim() + ".";
        }

        progressNav.hidden = true;
        backLink.hidden = true;
        confirmBtn.hidden = true;
        if (wizardFoot) wizardFoot.hidden = true;
        setStepHint("");
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
                // El portapapeles puede estar bloqueado: el código sigue en
                // pantalla y se puede seleccionar.
            });
        });
    }

    document.getElementById("resetBtn").addEventListener("click", function () {
        state = { method: "code", colour: null, reading: null, size: null, units: 1 };

        methodTabs.forEach(function (tab) {
            var active = tab.dataset.method === "code";
            tab.classList.toggle("is-active", active);
            tab.setAttribute("aria-pressed", String(active));
        });
        Object.keys(methodPanels).forEach(function (key) {
            if (methodPanels[key]) methodPanels[key].hidden = key !== "code";
        });

        clearColour();
        brandSelect.value = "";
        brandSelect.classList.add("is-placeholder");
        codeInput.value = "";
        [readingL, readingA, readingB].forEach(function (input) {
            input.value = "";
            setFieldValidity(input, null, true);
        });

        Array.prototype.forEach.call(sizeCards.querySelectorAll(".size-card"), function (card) {
            card.classList.remove("is-selected");
            card.setAttribute("aria-checked", "false");
        });
        renderOrderBar();

        companyForm.reset();
        [companyRuc, phoneInput, emailInput].forEach(function (input) {
            var field = input.closest(".field");
            if (field) field.classList.remove("field--invalid");
            input.removeAttribute("aria-invalid");
        });
        companyRucError.hidden = true;
        phoneError.hidden = true;
        emailError.hidden = true;
        departmentSelect.value = "";
        departmentSelect.classList.add("is-placeholder");
        populateProvinceOptions("");
        setSubmitError("");
        if (successCode) successCode.textContent = "··········";

        progressNav.hidden = false;
        confirmBtn.hidden = false;
        if (wizardFoot) wizardFoot.hidden = false;
        successPanel.hidden = true;
        goTo(1);
    });

    /* ---------------------------------------------------------------------
       Menú (igual que en el resto del sitio, ver src/home.js)
       --------------------------------------------------------------------- */

    var menuToggle = document.getElementById("menuToggle");
    var navPanel = document.getElementById("navPanel");

    function setMenu(open) {
        menuToggle.classList.toggle("is-open", open);
        menuToggle.setAttribute("aria-expanded", String(open));
        menuToggle.setAttribute("aria-label", open ? "Cierra el menú" : "Abre el menú");
        navPanel.classList.toggle("is-open", open);
    }
    function closeMenu() { setMenu(false); }

    menuToggle.addEventListener("click", function () {
        setMenu(!navPanel.classList.contains("is-open"));
    });
    navPanel.addEventListener("click", function (e) {
        if (e.target.closest("a")) closeMenu();
    });
    document.addEventListener("keydown", function (e) {
        if (e.key !== "Escape" || !navPanel.classList.contains("is-open")) return;
        closeMenu();
        menuToggle.focus();
    });
    document.addEventListener("click", function (e) {
        if (!navPanel.classList.contains("is-open")) return;
        if (navPanel.contains(e.target) || menuToggle.contains(e.target)) return;
        closeMenu();
    });

    /* ---------------------------------------------------------------------
       Arranque
       --------------------------------------------------------------------- */

    if (PAINTS && brandSelect) {
        PAINTS.brands().forEach(function (brand) {
            var opt = document.createElement("option");
            opt.value = brand.id;
            opt.textContent = brand.name;
            brandSelect.appendChild(opt);
        });
    }

    updateProgress(1);
    confirmBtn.textContent = CONFIRM_LABELS[1] || "Continuar";
    refreshConfirm();
})();
