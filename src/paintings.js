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

    /* El catálogo del fabricante: 68.717 colores y 383 marcas, en el servidor.
       Ver server/colordb/README.md.

       Las marcas y los modelos vienen en src/colourIndex.js, un archivo, así
       que los dos <select> se llenan sin pedir nada. Los colores no caben en
       un archivo —693.636 asociaciones— y son lo único que viaja.

       PAINTS deja de ser el catálogo y pasa a ser lo que la base no tiene: la
       muestra en pantalla de 528 colores medidos y su acabado. Decora las
       filas que llegan; ya no las produce. */
    var INDEX = window.AUTOCOLOR_COLOUR_INDEX || null;
    var API = (window.AUTOCOLOR_API_BASE || "") + "/api/colours";

    // Del nombre que enseña la base al id del catálogo local, para poder
    // pedirle la muestra. Solo las diez marcas que vende el taller tienen una.
    var SIDECAR_BY_LABEL = {};
    if (PAINTS) {
        Object.keys(PAINTS.BRAND_NAMES).forEach(function (id) {
            SIDECAR_BY_LABEL[PAINTS.BRAND_NAMES[id]] = id;
        });
    }

    function makeLabel(makeId) {
        if (!INDEX) return "";
        var found = null;
        INDEX.makes.some(function (m) {
            if (String(m[0]) === String(makeId)) { found = m[1]; return true; }
            return false;
        });
        return found || "";
    }

    /* Una fila de la base, vestida con lo que el catálogo local sepa de ella.
       La base no tiene ningún color de pantalla —ni hex, ni RGB, ni L*a*b*—,
       así que la muestra sale de aquí o no sale. El acabado de la base es
       deducido del nombre; el del catálogo está medido, así que ese manda. */
    function fromDb(row, makeId) {
        var label = makeLabel(makeId);
        var brandId = SIDECAR_BY_LABEL[label] || "";
        var chip = brandId && PAINTS ? PAINTS.findColour(brandId, row.code) : null;
        return {
            swCode: row.swCode,
            code: row.code,
            name: row.name,
            swName: row.swName && row.swName !== row.name ? row.swName : "",
            finish: (chip && chip.finish) || FINISH_OF[row.finish] || null,
            finishGuessed: !(chip && chip.finish),
            family: row.family || "otro",
            years: row.years && row.years[0] !== null ? row.years : null,
            brandWide: !!row.brandWide,
            dualTone: !!row.dualTone,
            modelName: row.modelName || "",
            hex: chip ? chip.hex : "",
            brand: label,
            brandId: brandId,
            makeId: makeId
        };
    }

    // Las letras que guarda la base, a los ids de FINISHES en src/paints.js.
    // 'u' es «no hay nombre que leer»: se queda sin acabado y lo elige el
    // cliente, porque el acabado multiplica el precio.
    var FINISH_OF = { s: "solido", m: "metalico", p: "perlado", t: "tricapa", u: null };

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
        // Whether the colour was picked from the finder's list rather than
        // read off the label. It travels as method 'model', so the shop
        // knows to confirm it before mixing.
        picked: false,
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
    var colourAlias = document.getElementById("colourAlias");
    var colourFinishPick = document.getElementById("colourFinishPick");
    var colourFinishAsk = document.getElementById("colourFinishAsk");
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
            if (state.method === "in_person") return true;
            // Con acabado, siempre: es lo que multiplica el precio, y el
            // catálogo del fabricante no lo trae para uno de cada ocho
            // colores. Sin él no hay nada que cotizar en el paso 2.
            return !!state.colour && !!state.colour.finish;
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
            // Color encontrado pero sin acabado: lo que falta es una pastilla,
            // no el código, así que el aviso manda allí y no al campo de arriba.
            if (state.colour && !state.colour.finish) {
                first = colourFinishPick ? colourFinishPick.querySelector(".finish-chip") : null;
                setStepHint("Elige el acabado para poder cotizar el color.");
            } else if (state.method === "code") {
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
        state.picked = false;
        if (colourCard) colourCard.hidden = true;
        if (colourAlias) colourAlias.hidden = true;
        if (colourFinishPick) colourFinishPick.hidden = true;
        if (colourMiss) colourMiss.hidden = true;
        // the grid's selection mark follows the card. renderFinder() and not
        // requestFinder(): this only repaints what is loaded.
        if (finder && !finder.hidden) renderFinder();
    }

    function showColour(colour, quality) {
        state.colour = colour;
        setSwatch(colourSwatch, colour.hex);
        colourStatus.textContent = quality ? quality.label : "Color encontrado";
        colourStatus.className = "colour-card__status" + (quality ? " is-" + quality.level : "");
        colourName.textContent = colour.name;
        if (colourAlias) {
            colourAlias.textContent = colour.swName || "";
            colourAlias.hidden = !colour.swName;
        }
        colourBrand.textContent = colour.brand;
        colourCode.textContent = colour.code;
        paintFinish();

        colourCard.hidden = false;
        colourMiss.hidden = true;
        refreshConfirm();
    }

    /* El acabado, y la nota de debajo.

       Cuando el catálogo del fabricante no lo dice —uno de cada ocho colores
       no trae nombre que leer— se pregunta en vez de suponer: el acabado
       multiplica el precio en src/paints.js, así que suponerlo mal es cobrar
       mal. Cuando sí lo dice pero es deducido del nombre, se puede corregir,
       porque deducirlo acierta siete de cada diez veces. */
    function paintFinish() {
        var colour = state.colour;
        if (!colour) return;
        var known = !!colour.finish;
        colourFinish.textContent = known ? PAINTS.finishLabel(colour.finish) : "Elígelo abajo";

        if (colourFinishPick) {
            colourFinishPick.hidden = known && !colour.finishGuessed;
            colourFinishAsk.textContent = known
                ? "El acabado lo deducimos del nombre del color. Si tu etiqueta dice otra cosa, corrígelo: cambia el precio."
                : "Este color no trae acabado en el catálogo. Elígelo para poder cotizarlo: es lo que decide el precio.";
            Array.prototype.forEach.call(colourFinishPick.querySelectorAll(".finish-chip"), function (b) {
                var on = b.dataset.finish === colour.finish;
                b.classList.toggle("is-active", on);
                b.setAttribute("aria-pressed", String(on));
            });
        }

        var finish = PAINTS.FINISHES[colour.finish];
        var note = finish ? finish.note : "";
        // La muestra en pantalla es una aproximación y hay que decirlo donde
        // se la está mirando: un metálico no cabe en un rectángulo de color, y
        // quien compra por la muestra reclama después. La mayoría de los
        // colores de la base no tiene ninguna, y entonces la nota lo dice.
        colourNote.textContent = note + (colour.hex
            ? " La muestra es referencial: el color se aprueba con plancha de prueba."
            : " De este color no tenemos muestra medida: se aprueba con plancha de prueba.");
    }

    if (colourFinishPick) {
        colourFinishPick.addEventListener("click", function (e) {
            var btn = e.target.closest(".finish-chip");
            if (!btn || !state.colour) return;
            state.colour.finish = btn.dataset.finish;
            state.colour.finishGuessed = true;
            paintFinish();
            // El precio de cada envase sale del acabado, así que se rehace.
            refreshSizePrices();
            refreshConfirm();
        });
    }

    function showMiss(message) {
        state.colour = null;
        colourCard.hidden = true;
        colourMiss.textContent = message;
        colourMiss.hidden = false;
        refreshConfirm();
    }

    // El valor del <select> es un id de la base cuando hay índice, y un id
    // del catálogo local cuando no lo hay. Esto devuelve el segundo a partir
    // del primero, que es lo que necesita la muestra.
    function sidecarId(value) {
        if (!value) return "";
        if (!INDEX) return value;
        return SIDECAR_BY_LABEL[makeLabel(value)] || "";
    }

    function searchLocally(value, code) {
        var brandId = sidecarId(value);
        if (!brandId || !PAINTS) return null;
        var found = PAINTS.findColour(brandId, code);
        if (!found) return null;
        // Sin swCode: este color salió del catálogo local, no de la base, y
        // el servidor no tiene nada que volver a resolver.
        return {
            swCode: "", code: found.code, name: found.name, swName: "",
            finish: found.finish, finishGuessed: false, family: found.family || "otro",
            years: found.years || null, brandWide: false, dualTone: false, modelName: "",
            hex: found.hex, brand: found.brand, brandId: brandId, makeId: value
        };
    }

    function missMessage(brandName, code) {
        return "No tenemos «" + code.toUpperCase() + "» entre los colores de " + brandName +
            ". Revisa el código en la etiqueta, o usa la lectura digital o el taller: " +
            "los colores que no están en la lista los preparamos midiendo la pieza.";
    }

    var searchToken = 0;

    function searchByCode() {
        if (!PAINTS) return;
        var value = brandSelect.value;
        var code = codeInput.value.trim();
        if (!value || code === "") {
            explainStep(1);
            return;
        }

        // Sin índice no hay base que preguntar: queda el catálogo local, que
        // es como funcionaba la página antes de todo esto.
        if (!INDEX) {
            var local = searchLocally(value, code);
            if (local) { state.picked = false; showColour(local, null); }
            else showMiss(missMessage(PAINTS.brandName(value), code));
            return;
        }

        var mine = ++searchToken;
        var label = codeSearchBtn ? codeSearchBtn.textContent : "";
        if (codeSearchBtn) {
            codeSearchBtn.disabled = true;
            codeSearchBtn.textContent = "Buscando…";
        }

        fetch(API + "/search?make=" + encodeURIComponent(value) + "&code=" + encodeURIComponent(code))
            .then(function (response) {
                if (API_MISSING_STATUS.indexOf(response.status) !== -1) {
                    throw new Error(API_MISSING_MESSAGE);
                }
                return response.json().catch(function () { return {}; }).then(function (body) {
                    if (!response.ok) {
                        var err = new Error(body.error || "No pudimos buscar ese código.");
                        err.soft = response.status === 503;
                        throw err;
                    }
                    return body;
                });
            })
            .then(function (body) {
                if (mine !== searchToken) return;
                var items = (body.items || []).map(function (row) { return fromDb(row, value); });
                if (items.length === 0) {
                    showMiss(missMessage(makeLabel(value), code));
                    return;
                }
                state.picked = false;
                if (items.length === 1) {
                    showColour(items[0], null);
                    return;
                }
                // Un mismo código de fábrica puede tener varias versiones, por
                // año o por modelo. Se muestran en la rejilla para que elija
                // quien sí sabe cuál es su coche.
                showColour(items[0], null);
                finderState.rows = items;
                finderState.hasMore = false;
                finderState.error = "";
                if (finder && finder.hidden) {
                    finder.hidden = false;
                    finderToggle.setAttribute("aria-expanded", "true");
                }
                renderFinder();
                finderNote.textContent = "El código «" + code.toUpperCase() + "» tiene " +
                    items.length + " versiones. Elige la de tu modelo o año.";
            })
            .catch(function (err) {
                if (mine !== searchToken) return;
                // Con la base caída o sin conexión, el catálogo local todavía
                // sabe de diez marcas: la página degrada, no se rompe.
                var offline = err instanceof TypeError;
                var fallback = (offline || err.soft) ? searchLocally(value, code) : null;
                if (fallback) {
                    state.picked = false;
                    showColour(fallback, null);
                    colourNote.textContent = "Del catálogo local: el buscador completo no" +
                        " responde ahora mismo. " + colourNote.textContent;
                    return;
                }
                showMiss(offline
                    ? "No pudimos conectar con el servidor. Revisa tu conexión e inténtalo nuevamente."
                    : err.message);
            })
            .then(function () {
                if (mine === searchToken && codeSearchBtn) {
                    codeSearchBtn.disabled = false;
                    codeSearchBtn.textContent = label;
                }
            });
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
            // fillFinderModels() ends in resetFinderPaging(), so the grid
            // reloads for the new make rather than showing the old one's.
            fillFinderModels();
            refreshConfirm();
        });
    }

    /* ---------------------------------------------------------------------
       The finder: for whoever has no label to read

       Model and year narrow the brand's colours to a grid. The guides behind
       the catalogue only list the colours with a compatibility note, and
       only up to model year 2018, so the grid says which list it is showing:
       the model's own, or the brand's colours of that year when the model is
       not listed (Hilux, Onix and the other cars sold only down here).
       --------------------------------------------------------------------- */

    // La página pide de a 60 porque la base contesta de a 60: el límite vive
    // dentro de la función SQL, no aquí, y aquí sólo se sabe si hay más.
    var FINDER_PAGE = 60;
    var finderToggle = document.getElementById("finderToggle");
    var finder = document.getElementById("colourFinder");
    var finderModel = document.getElementById("finderModel");
    var finderYear = document.getElementById("finderYear");
    var finderFamilies = document.getElementById("finderFamilies");
    var finderSearch = document.getElementById("finderSearch");
    var finderNote = document.getElementById("finderNote");
    var finderGrid = document.getElementById("finderGrid");
    var finderMore = document.getElementById("finderMore");
    var finderWiden = document.getElementById("finderWiden");
    var finderState = { family: "", from: 0, rows: [], hasMore: false, error: "" };

    function setSwatch(el, hex) {
        // A colour with no chip in the guides gets a hatch, not a guessed
        // hex: an invented swatch is exactly what the customer would trust.
        el.style.background = hex || "";
        el.classList.toggle("swatch--none", !hex);
    }

    function fillFinderModels() {
        if (!finderModel) return;
        var makeId = brandSelect.value;
        var list = INDEX && makeId ? (INDEX.models[makeId] || []) : null;
        finderModel.innerHTML = "";
        var first = document.createElement("option");
        first.value = "";
        first.textContent = makeId ? "Todos los modelos" : "Elige primero la marca";
        finderModel.appendChild(first);
        if (list) {
            list.forEach(function (model) {
                var opt = document.createElement("option");
                opt.value = String(model[0]);
                opt.textContent = model[1];
                finderModel.appendChild(opt);
            });
        }
        // Una marca sin modelos propios no deja el <select> muerto: sus
        // colores están a nivel de marca, que es donde vive más de la mitad
        // de este catálogo, y «todos los modelos» los trae igual.
        finderModel.disabled = !makeId;
        finderModel.classList.add("is-placeholder");
        resetFinderPaging();
    }

    function fillFinderYears() {
        var now = new Date().getFullYear();
        for (var y = now + 1; y >= 1980; y--) {
            var opt = document.createElement("option");
            opt.value = String(y);
            opt.textContent = String(y);
            finderYear.appendChild(opt);
        }
    }

    function fillFinderFamilies() {
        var all = [{ id: "", label: "Todos" }].concat(PAINTS.FAMILIES);
        all.forEach(function (fam) {
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "finder-family" + (fam.id === "" ? " is-active" : "");
            btn.dataset.family = fam.id;
            btn.setAttribute("aria-pressed", String(fam.id === ""));
            btn.textContent = fam.label;
            finderFamilies.appendChild(btn);
        });
    }

    /* La página pide los colores; antes los tenía.

       Dos cosas a la vez para que no se pisen: un número que sube en cada
       petición, y un AbortController. El número es el que garantiza que una
       respuesta lenta no escriba encima de una rápida que salió después; el
       abort es el que evita gastar los bytes de la que ya no importa.

       No hay debounce, y no es un olvido: lo único que dispara una petición es
       cambiar uno de los dos <select> o pulsar «ver más». El buscador de texto
       y las pastillas de tono filtran lo que ya está en pantalla. */
    var finderToken = 0;
    var finderAbort = null;

    function finderUrl() {
        var params = "?make=" + encodeURIComponent(brandSelect.value);
        if (finderModel.value) params += "&model=" + encodeURIComponent(finderModel.value);
        if (finderYear.value) params += "&year=" + encodeURIComponent(finderYear.value);
        if (finderState.from) params += "&from=" + finderState.from;
        return API + "/browse" + params;
    }

    function setFinderBusy(busy) {
        finderGrid.classList.toggle("is-loading", busy);
        finderMore.disabled = busy;
        finderSearch.disabled = busy && finderState.rows.length === 0;
    }

    function requestFinder() {
        if (!finder || finder.hidden) return;
        if (!brandSelect.value) {
            finderState.rows = [];
            finderState.hasMore = false;
            finderState.error = "";
            renderFinder();
            return;
        }
        var mine = ++finderToken;
        if (finderAbort) finderAbort.abort();
        finderAbort = typeof AbortController === "function" ? new AbortController() : null;

        setFinderBusy(true);
        if (finderState.rows.length === 0) finderNote.textContent = "Buscando colores…";

        fetch(finderUrl(), finderAbort ? { signal: finderAbort.signal } : undefined)
            .then(function (response) {
                if (API_MISSING_STATUS.indexOf(response.status) !== -1) {
                    throw new Error(API_MISSING_MESSAGE);
                }
                return response.json().catch(function () { return {}; }).then(function (body) {
                    if (!response.ok) {
                        var err = new Error(body.error || "No pudimos traer los colores.");
                        err.soft = response.status === 503;
                        throw err;
                    }
                    return body;
                });
            })
            .then(function (body) {
                if (mine !== finderToken) return;
                var makeId = brandSelect.value;
                var fresh = (body.items || []).map(function (row) { return fromDb(row, makeId); });
                finderState.rows = finderState.from ? finderState.rows.concat(fresh) : fresh;
                finderState.hasMore = !!body.hasMore;
                finderState.error = "";
                renderFinder();
            })
            .catch(function (err) {
                if (err.name === "AbortError" || mine !== finderToken) return;
                // Sin conexión o con la base apagada quedan los 777 colores
                // del catálogo local, que son diez marcas pero son algo. Solo
                // sirve si la marca elegida es una de ellas.
                var offline = err instanceof TypeError;
                finderState.rows = [];
                finderState.hasMore = false;
                finderState.error = offline
                    ? "No pudimos conectar con el servidor. Revisa tu conexión e inténtalo nuevamente."
                    : err.message;
                renderFinder();
            })
            .then(function () {
                if (mine === finderToken) setFinderBusy(false);
            });
    }

    // Pinta lo que ya está cargado. No pide nada: el filtro de texto y las
    // pastillas de tono trabajan sobre las filas que hay, igual que antes.
    function renderFinder() {
        if (!finder || finder.hidden || !PAINTS) return;

        if (!brandSelect.value) {
            finderGrid.innerHTML = "";
            finderMore.hidden = true;
            finderWiden.hidden = true;
            finderNote.textContent = "Elige la marca arriba para ver sus colores.";
            return;
        }

        var q = PAINTS.normalizeCode(finderSearch.value);
        var text = finderSearch.value.trim().toLowerCase();
        var items = finderState.rows.filter(function (c) {
            if (finderState.family && c.family !== finderState.family) return false;
            if (!text) return true;
            if (c.name.toLowerCase().indexOf(text) !== -1) return true;
            if (c.swName && c.swName.toLowerCase().indexOf(text) !== -1) return true;
            if (!q) return false;
            return PAINTS.normalizeCode(c.code).indexOf(q) === 0;
        });

        finderGrid.innerHTML = "";
        items.forEach(function (colour) {
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "swatch-option";
            var picked = state.colour && state.colour.swCode === colour.swCode
                && state.colour.code === colour.code;
            btn.classList.toggle("is-selected", !!picked);
            btn.setAttribute("aria-pressed", String(!!picked));

            var chip = document.createElement("span");
            chip.className = "swatch-option__chip";
            chip.setAttribute("aria-hidden", "true");
            setSwatch(chip, colour.hex);

            var code = document.createElement("span");
            code.className = "swatch-option__code";
            code.textContent = colour.code;

            var name = document.createElement("span");
            name.className = "swatch-option__name";
            name.textContent = colour.name;

            var meta = document.createElement("span");
            meta.className = "swatch-option__meta";
            meta.textContent = finderMeta(colour);

            btn.appendChild(chip);
            btn.appendChild(code);
            btn.appendChild(name);
            btn.appendChild(meta);
            btn.addEventListener("click", function () { pickFromFinder(colour); });
            finderGrid.appendChild(btn);
        });

        // «Ver más» y no «ver N más»: la base nunca dice cuántos hay, a
        // propósito, así que la página tampoco puede prometerlo.
        finderMore.hidden = !finderState.hasMore;
        finderMore.textContent = "Ver más colores";
        finderWiden.hidden = !finderModel.value;
        if (finderModel.value) {
            finderWiden.textContent = "Ver todos los colores de " + makeLabel(brandSelect.value);
        }

        finderNote.textContent = finderNoteText(items.length);
    }

    function finderMeta(colour) {
        var bits = [];
        if (colour.finish) bits.push(PAINTS.finishLabel(colour.finish));
        if (colour.years) {
            bits.push(colour.years[0] === colour.years[1]
                ? String(colour.years[0])
                : colour.years[0] + "–" + colour.years[1]);
        }
        if (colour.dualTone) bits.push("bitono");
        return bits.join(" · ");
    }

    function finderNoteText(shown) {
        if (finderState.error) return finderState.error;
        var brandName = makeLabel(brandSelect.value);
        if (finderState.rows.length === 0) {
            return "No encontramos colores de " + brandName + " para esa combinación." +
                " Prueba otro año o quita el modelo, o usa la lectura digital o el taller.";
        }
        if (shown === 0) return "Ningún color de los cargados coincide con el filtro.";

        var modelName = finderModel.options[finderModel.selectedIndex];
        var where = finderModel.value && modelName
            ? "del " + modelName.textContent
            : "de " + brandName;
        var note = "Colores " + where +
            (finderYear.value ? " de " + finderYear.value : "") +
            " en el catálogo del fabricante.";
        // Más de la mitad de este catálogo cuelga de la marca y no del
        // modelo, así que conviene decir cuándo lo que se ve es eso.
        if (finderModel.value && finderState.rows.some(function (c) { return c.brandWide; })) {
            note += " Algunos están registrados para toda la marca, no para ese modelo.";
        }
        return note;
    }

    function pickFromFinder(colour) {
        // The code goes into the field too, so the panel reads the same as
        // after a search by code, and the summary names where it came from.
        codeInput.value = colour.code;
        showColour(colour, { level: "picked", label: "Elegido de la lista" });
        state.picked = true;
        colourNote.textContent = "Elegido por modelo y año, sin ver la etiqueta: confírmalo con el código " +
            "del vehículo si puedes. " + colourNote.textContent;
        renderFinder();
        colourCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    // Una petición nueva: se vuelve a la primera página y se tiran las filas
    // cargadas, porque describen otra combinación.
    function resetFinderPaging() {
        finderState.from = 0;
        finderState.rows = [];
        finderState.hasMore = false;
        finderState.error = "";
        requestFinder();
    }

    // El filtro de texto y las pastillas de tono no piden nada: trabajan
    // sobre lo que ya está cargado.
    function refilterFinder() {
        renderFinder();
    }

    if (finderToggle && finder && PAINTS) {
        fillFinderYears();
        fillFinderFamilies();

        finderToggle.addEventListener("click", function () {
            var open = finder.hidden;
            finder.hidden = !open;
            finderToggle.setAttribute("aria-expanded", String(open));
            if (open) {
                // Al abrir se pide de verdad: hasta ahora no había nada que
                // pintar, porque los colores ya no viven en la página.
                if (finderState.rows.length === 0) resetFinderPaging();
                else renderFinder();
                (brandSelect.value ? finderModel : brandSelect).focus();
            }
        });
        [finderModel, finderYear].forEach(function (select) {
            select.addEventListener("change", function () {
                select.classList.toggle("is-placeholder", select.value === "");
                resetFinderPaging();
            });
        });
        finderFamilies.addEventListener("click", function (e) {
            var btn = e.target.closest(".finder-family");
            if (!btn) return;
            finderState.family = btn.dataset.family;
            Array.prototype.forEach.call(finderFamilies.children, function (b) {
                var on = b === btn;
                b.classList.toggle("is-active", on);
                b.setAttribute("aria-pressed", String(on));
            });
            refilterFinder();
        });
        finderSearch.addEventListener("input", refilterFinder);
        finderSearch.addEventListener("keydown", function (e) {
            if (e.key === "Enter") e.preventDefault();
        });
        finderWiden.addEventListener("click", function () {
            // Keeps the year: "all of Chevrolet's 2017 colours" is the next
            // best list to the Tracker's own.
            finderModel.value = "";
            finderModel.classList.add("is-placeholder");
            resetFinderPaging();
            finderModel.focus();
        });
        finderMore.addEventListener("click", function () {
            // La base recorta el salto a 600 y contesta 400 pasado eso, así
            // que «ver más» se apaga antes de llegar en vez de dar vueltas.
            if (finderState.from + FINDER_PAGE > 600) {
                finderState.hasMore = false;
                finderMore.hidden = true;
                finderNote.textContent = "Son muchos colores para verlos de una." +
                    " Afina el modelo o el año para ver el resto.";
                return;
            }
            finderState.from += FINDER_PAGE;
            requestFinder();
        });
    } else if (finderToggle) {
        finderToggle.hidden = true;
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
            if (row.code) dd.className = "summary__code";
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
        model: "Elegido por modelo y año",
        reading: "Lectura digital",
        in_person: "Lectura en el taller"
    };

    function renderSummary() {
        if (!summaryBox) return;
        summaryBox.innerHTML = "";

        // El color -----------------------------------------------------
        var colourRows = [{ label: "Identificado", value: METHOD_LABELS[orderMethod()] }];
        var swatch = null;

        if (state.colour) {
            colourRows.push({ label: "Marca", value: state.colour.brand });
            colourRows.push({ label: "Código", value: state.colour.code, code: true });
            colourRows.push({ label: "Color", value: state.colour.name });
            colourRows.push({ label: "Acabado", value: PAINTS.finishLabel(state.colour.finish) });
            if (state.reading) {
                colourRows.push({
                    label: "Tu lectura",
                    value: "L* " + state.reading.L + " · a* " + state.reading.a + " · b* " + state.reading.b,
                    code: true
                });
            }
            swatch = document.createElement("span");
            swatch.className = "summary__swatch";
            setSwatch(swatch, state.colour.hex);
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
            { label: "RUC", value: companyRuc.value.trim(), code: true },
            { label: "Contacto", value: firstNameInput.value.trim() + " " + lastNameInput.value.trim() },
            { label: "Zona", value: provinceSelect.value && departmentSelect.value
                ? provinceSelect.value + ", " + departmentSelect.value : "" },
            { label: "Teléfono", value: "+51 " + phoneInput.value, code: true },
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

    function orderMethod() {
        return state.method === "code" && state.picked ? "model" : state.method;
    }

    function orderPayload() {
        return {
            method: orderMethod(),
            // Sin color en el camino del taller: los tres campos viajan vacíos
            // y el servidor los acepta así (ver validatePaintOrder).
            brand: state.colour ? state.colour.brand : "",
            brandId: state.colour ? state.colour.brandId : "",
            colorCode: state.colour ? state.colour.code : "",
            colorName: state.colour ? state.colour.name : "",
            // El id de Sherwin, cuando el color salió de la base. Es lo que el
            // servidor vuelve a resolver antes de guardar, y lo que encuentra
            // la fórmula en el mostrador. Vacío si vino del catálogo local.
            swCode: state.colour ? (state.colour.swCode || "") : "",
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
        state = { method: "code", colour: null, reading: null, picked: false, size: null, units: 1 };

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

    // Las 383 marcas del catálogo del fabricante, las diez que vende el taller
    // primero. Sale de un archivo, así que no hay espera ni nada que cargar.
    if (INDEX && brandSelect) {
        INDEX.makes.forEach(function (make) {
            var opt = document.createElement("option");
            opt.value = String(make[0]);
            opt.textContent = make[1];
            brandSelect.appendChild(opt);
        });
    } else if (PAINTS && brandSelect) {
        // Sin el índice queda el catálogo local: diez marcas, pero la página
        // vende igual. El valor sigue siendo un id, y searchByCode() distingue
        // los dos casos por SIDECAR_BY_LABEL.
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
