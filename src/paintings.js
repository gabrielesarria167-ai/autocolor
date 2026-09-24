/* =========================================================================
   paintings.js: the matizado sales wizard (pgs/paintings.html)

   Four steps: the colour, the container, the company and the summary. It
   resembles the quote wizard (src/repair.js) and shares its shell, step bar
   and footer with it, but not its path: here there is a route that ends
   early.

   THE SHORT ROUTE. Whoever chooses to settle the colour at the workshop
   cannot pick a quantity or see a price: both come from the formula, and the
   formula does not exist yet. That order skips step 2 (both ways) and
   reaches the summary with no container. What gets confirmed then is a
   visit, and the summary and the email both say so.

   Nothing seen here decides the final price: the amounts are referential
   (see src/paints.js) and the workshop settles them when mixing.
   ========================================================================= */

(function () {
    "use strict";

    var TOTAL_STEPS = 4;
    var CONFIRM_LABELS = { 4: "Confirmar pedido" };

    // The catalogue. Guarded as in repair.js: without it the page is useless,
    // but a file that never arrived must not also take the listeners further
    // down with it through a TypeError on the first line.
    var PAINTS = window.AUTOCOLOR_PAINTS || null;

    /* The manufacturer catalogue: 68,717 colours and 383 makes, on the server.
       See server/colordb/README.md.

       Makes and models come in src/colourIndex.js, a file, so the two
       <select>s fill without asking for anything. The colours do not fit in
       a file (693,636 associations) and are the only thing that travels.

       PAINTS stops being the catalogue and becomes what the database lacks:
       the on-screen swatch of 528 measured colours and their finish. It
       decorates the rows that arrive; it no longer produces them. */
    var INDEX = window.AUTOCOLOR_COLOUR_INDEX || null;
    var API = (window.AUTOCOLOR_API_BASE || "") + "/api/colours";

    // From the name the database shows to the local catalogue id, so the
    // swatch can be asked for. Only the ten makes the workshop sells have one.
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

    /* A database row, dressed with whatever the local catalogue knows of it.

       The swatch can come from two places. The local catalogue has it
       measured off a printed chip, for 746 colours; the database has it
       computed from the tint formula, for all of them. The measured one wins
       where it exists, and the page says which one it is showing, because
       they are not worth the same.

       Same for the finish: the database's is inferred from the name, the
       catalogue's is measured, so that one wins. */
    function fromDb(row, makeId) {
        var label = makeLabel(makeId);
        var brandId = SIDECAR_BY_LABEL[label] || "";
        var chip = brandId && PAINTS ? PAINTS.findColour(brandId, row.code) : null;
        var measured = !!(chip && chip.hex);
        return {
            swCode: row.swCode,
            // With no factory code, Sherwin's is shown, the only name it
            // has: 5,782 colours that did not show up before.
            code: row.code || row.swCode,
            // The other codes the make sells this same paint under.
            altCodes: row.altCodes || [],
            name: row.name,
            swName: row.swName && row.swName !== row.name ? row.swName : "",
            finish: (chip && chip.finish) || FINISH_OF[row.finish] || null,
            finishGuessed: !(chip && chip.finish),
            family: row.family || "otro",
            // Either end can be missing on its own: the database leaves
            // year_max NULL when the colour is still sold, and year_min when
            // nobody knows since when. Both are kept as they are and
            // finderMeta() decides how to read them; dropping the whole pair
            // because one is missing threw away data we do have.
            years: row.years && (row.years[0] !== null || row.years[1] !== null)
                ? row.years : null,
            brandWide: !!row.brandWide,
            dualTone: !!row.dualTone,
            modelName: row.modelName || "",
            hex: (measured ? chip.hex : row.hex) || "",
            hexMeasured: measured,
            brand: label,
            brandId: brandId,
            makeId: makeId
        };
    }

    /* A paint's factory codes, on one line.

       Jeep sells the same blue as KBX and as PBX. The database used to return
       one row per code and the grid showed the same colour twice; now it
       returns a single row with both, and they read together.

       But only when they really are synonyms. Some colours carry ten codes
       (Ford's red 234487 comes out as 718, ASQC, MR, G1, VBN, K1 and five
       more, by model and market) and then the list explains nothing: the one
       searched for is shown and that is it. Single letters are dropped too,
       because «VR847 / C» reads like a typo. */
    function codeLabel(colour) {
        var alt = (colour.altCodes || []).filter(function (c) {
            return String(c).length > 1;
        });
        var parts = alt.length && alt.length <= 2
            ? [colour.code].concat(alt)
            : [colour.code];
        // And Sherwin's at the end, always. It is the code the paint is
        // ordered by at the counter, it works for all thirteen makes and it
        // is the only one colours without a factory code have (there it is
        // already first, which is why it is checked before adding). It goes
        // bare, with no «SW» in front, because the search above accepts it as
        // is and whoever copies it off the screen must be able to paste it
        // without trimming anything.
        if (colour.swCode && parts.indexOf(colour.swCode) === -1) {
            parts.push(colour.swCode);
        }
        return parts.join(" / ");
    }

    // The letters the database stores, mapped to the FINISHES ids in
    // src/paints.js. 'u' means «no name to read»: it stays without a finish
    // and the customer picks it, because the finish multiplies the price.
    var FINISH_OF = { s: "solido", m: "metalico", p: "perlado", t: "tricapa", u: null };

    var state = {
        // 'code' | 'in_person': how the colour was identified.
        method: "code",
        // The colour found, with its make, code, name and finish. On the
        // workshop route it stays null and travels to the server that way.
        colour: null,
        // Kept for compatibility with the server, which still accepts a
        // CIELAB reading; the page no longer asks for it, so it is always null.
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
        in_person: document.getElementById("methodPanelShop")
    };

    var brandSelect = document.getElementById("colorBrand");
    var codeInput = document.getElementById("colorCode");
    var codeSearchBtn = document.getElementById("colorSearch");

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
    var firstNameInput = document.getElementById("firstName");
    var lastNameInput = document.getElementById("lastName");
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

    /* ---------------------------------------------------------------------
       Wizard footer: the button says what is missing instead of switching
       off (same treatment as in src/repair.js).
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
            // The workshop route needs no colour: the order is the visit.
            if (state.method === "in_person") return true;
            // Always with a finish: it is what multiplies the price, and the
            // manufacturer catalogue lacks it for one colour in eight.
            // Without it there is nothing to quote in step 2.
            return !!state.colour && !!state.colour.finish;
        }
        if (step === 2) return !!state.size;
        if (step === 3) {
            return companyName.value.trim() !== "" &&
                firstNameInput.value.trim() !== "" &&
                lastNameInput.value.trim() !== "" &&
                PHONE_PATTERN.test(phoneInput.value) &&
                (emailInput.value === "" || EMAIL_PATTERN.test(emailInput.value));
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
            // Colour found but no finish: what is missing is a chip, not the
            // code, so the hint points there and not at the field above.
            if (state.colour && !state.colour.finish) {
                first = colourFinishPick ? colourFinishPick.querySelector(".finish-chip") : null;
                setStepHint("Elige el acabado para poder cotizar el color.");
            } else {
                need(!!brandSelect.value, brandSelect);
                need(codeInput.value.trim() !== "", codeInput);
                setStepHint("Busca tu código de color para continuar.");
            }
        } else if (step === 2) {
            first = sizeCards.querySelector(".size-card");
            setStepHint("Elige un envase para continuar.");
        } else if (step === 3) {
            need(companyName.value.trim() !== "", companyName);
            need(firstNameInput.value.trim() !== "", firstNameInput);
            need(lastNameInput.value.trim() !== "", lastNameInput);
            var phoneOk = PHONE_PATTERN.test(phoneInput.value);
            setFieldValidity(phoneInput, phoneError, phoneOk, "Ingresa " + PHONE_DIGITS + " dígitos después de +51.");
            need(phoneOk, phoneInput);
            var emailOk = emailInput.value === "" || EMAIL_PATTERN.test(emailInput.value);
            setFieldValidity(emailInput, emailError, emailOk,
                "Ingresa un email válido, por ejemplo nombre@dominio.com.");
            need(emailOk, emailInput);
            setStepHint("Completa los datos marcados para continuar.");
        }

        if (first && typeof first.focus === "function") first.focus();
    }

    /* ---------------------------------------------------------------------
       Navigation

       Step 2 is skipped entirely when the colour is settled at the workshop,
       in both directions: stepAfter() and stepBefore() are the only places
       that know about the skip, so no button has to remember it.
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
            // The skipped step is not removed from the bar, it is marked. A
            // bar that loses a dot when an option is picked reads as an error.
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
       Step 1: the colour
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

        // Switching route drops the colour the previous one found: if it
        // stayed, the summary would show a colour that was no longer found
        // the way the card says.
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
        codeAnswered(false);
        if (finderState.pinned) {
            // The finder was pinned to the versions of a code that no longer
            // matches (the field was edited or cleared). Drop them and go back
            // to the brand's own colours, so the list is reachable again
            // instead of stuck on the old variants.
            finderState.pinned = false;
            if (finder && !finder.hidden) resetFinderPaging();
            else { finderState.rows = []; finderState.hasMore = false; }
        } else if (finder && !finder.hidden) {
            // the grid's selection mark follows the card. renderFinder() and
            // not requestFinder(): this only repaints what is loaded.
            renderFinder();
        }
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
        colourCode.textContent = codeLabel(colour);
        paintFinish();

        colourCard.hidden = false;
        colourMiss.hidden = true;
        refreshConfirm();
    }

    /* The finish, and the note beneath it.

       When the manufacturer catalogue does not say (one colour in eight has
       no name to read), the page asks instead of guessing: the finish
       multiplies the price in src/paints.js, so a wrong guess is a wrong
       charge. When it does say but it was inferred from the name, it can be
       corrected, because the inference is right seven times out of ten. */
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
        // The on-screen swatch is an approximation and that has to be said
        // where it is being looked at: a metallic does not fit in a colour
        // rectangle, and whoever buys by the swatch complains later. Most of
        // the database's colours have none, and then the note says so.
        colourNote.textContent = note + (colour.hexMeasured
            ? " La muestra es referencial: el color se aprueba con plancha de prueba."
            : " La muestra la calculamos de la fórmula, así que es orientativa:"
              + " el color se aprueba con plancha de prueba.");
    }

    if (colourFinishPick) {
        colourFinishPick.addEventListener("click", function (e) {
            var btn = e.target.closest(".finish-chip");
            if (!btn || !state.colour) return;
            state.colour.finish = btn.dataset.finish;
            state.colour.finishGuessed = true;
            paintFinish();
            // Each container's price follows from the finish, so it is redone.
            refreshSizePrices();
            refreshConfirm();
        });
    }

    /* «¿No sabes el código?» is for whoever has no label to read. Once a code
       typed with its brand has found the colour, the question has been
       answered, and the button goes, along with the finder under it if it
       was open. It comes back as soon as that answer stops holding: the code
       is edited or cleared, the brand changes, or the code is not found,
       which is exactly when looking the colour up by model and year helps.

       The finder stays open when it is showing the code's own versions
       (finderState.pinned): that grid is the rest of the answer. */
    function codeAnswered(found) {
        if (!finderToggle || !finder || !PAINTS) return;
        finderToggle.hidden = found;
        if (found && !finderState.pinned && !finder.hidden) {
            finder.hidden = true;
            finderToggle.setAttribute("aria-expanded", "false");
        }
    }

    function showMiss(message) {
        codeAnswered(false);
        state.colour = null;
        colourCard.hidden = true;
        colourMiss.textContent = message;
        colourMiss.hidden = false;
        refreshConfirm();
    }

    // The <select> value is a database id when there is an index, and a local
    // catalogue id when there is not. This returns the second from the first,
    // which is what the swatch needs.
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
        // findColour() also searches the alternate codes, so it can return a
        // card whose main code is not the one typed. The typed one is shown:
        // the customer copied «KBX» off their label, and seeing «PBX» in its
        // place looks like the page changed their code, not like the same
        // paint is sold under both.
        var typed = PAINTS.normalizeCode(code);
        var swapped = PAINTS.normalizeCode(found.code) !== typed;
        // No swCode: this colour came from the local catalogue, not the
        // database, and the server has nothing to resolve again.
        return {
            swCode: "",
            code: swapped ? String(code).trim().toUpperCase() : found.code,
            altCodes: swapped ? [found.code] : [],
            name: found.name, swName: "",
            finish: found.finish, finishGuessed: false, family: found.family || "otro",
            years: found.years || null, brandWide: false, dualTone: false, modelName: "",
            hex: found.hex, hexMeasured: !!found.hex,
            brand: found.brand, brandId: brandId, makeId: value
        };
    }

    function missMessage(brandName, code) {
        return "No tenemos «" + code.toUpperCase() + "» entre los colores de " + brandName +
            ". Revisa el código en la etiqueta, o tráelo al taller: " +
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

        // Without the index there is no database to ask: the local catalogue
        // remains, which is how the page worked before all this.
        if (!INDEX) {
            var local = searchLocally(value, code);
            if (local) { state.picked = false; showColour(local, null); codeAnswered(true); }
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
                    codeAnswered(true);
                    return;
                }
                // One factory code can have several versions, by year or by
                // model. They are shown in the grid so whoever does know
                // which one their car is can pick it.
                //
                // Except when the car is two-tone: then they are not versions
                // to choose between but the two paints it wears, and telling
                // someone who has to mix both «pick the one for your year»
                // sends them off with half the job.
                var twoTone = items.length > 1 && items.every(function (c) {
                    return c.dualTone;
                });
                showColour(items[0], null);
                finderState.rows = items;
                finderState.hasMore = false;
                finderState.error = "";
                finderState.pinned = true;
                if (finder && finder.hidden) {
                    finder.hidden = false;
                    finderToggle.setAttribute("aria-expanded", "true");
                }
                codeAnswered(true);
                renderFinder();
                finderNote.textContent = twoTone
                    ? "El código «" + code.toUpperCase() + "» es de un coche de dos"
                      + " tonos: son " + items.length + " pinturas distintas. Elige la"
                      + " que vas a matizar."
                    : "El código «" + code.toUpperCase() + "» tiene " +
                      items.length + " versiones. Elige la de tu modelo o año.";
            })
            .catch(function (err) {
                if (mine !== searchToken) return;
                // With the database down or offline, the local catalogue
                // still knows ten makes: the page degrades, it does not break.
                var offline = err instanceof TypeError;
                var fallback = (offline || err.soft) ? searchLocally(value, code) : null;
                if (fallback) {
                    state.picked = false;
                    showColour(fallback, null);
                    codeAnswered(true);
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
            // Enter searches and sends nothing: the field does not live inside
            // a <form>, but the phone keyboard offers «go» anyway.
            if (e.key === "Enter") {
                e.preventDefault();
                searchByCode();
            }
        });
        // A half-typed code no longer describes the card beneath it.
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

    // The page asks for 60 at a time because the database answers 60 at a
    // time: the limit lives inside the SQL function, not here, and here we
    // only know whether there are more.
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
    // `pinned` marks the grid as holding a code's versions (from searchByCode)
    // rather than a browse, so clearing the code can put the browse back.
    var finderState = { family: "", from: 0, rows: [], hasMore: false, error: "", pinned: false };

    function setSwatch(el, hex) {
        // A colour with no chip in the guides gets a hatch, not a guessed
        // hex: an invented swatch is exactly what the customer would trust.
        el.style.background = hex || "";
        el.classList.toggle("swatch--none", !hex);
    }

    /* The six cans, painted in the chosen colour.

       Called every time the step is entered, not only when building the
       cards: the customer can go back and change colour, and then the cans
       have to change with it. With no colour to show they are striped, like
       the card's swatch. */
    function paintSizeJars() {
        if (!sizeCards) return;
        var hex = state.colour && state.colour.hex ? state.colour.hex : "";
        Array.prototype.forEach.call(sizeCards.querySelectorAll(".size-card__jar"),
            function (jar) {
                if (hex) {
                    jar.style.setProperty("--jar", hex);
                } else {
                    jar.style.removeProperty("--jar");
                }
                jar.classList.toggle("swatch--none", !hex);
            });
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
        // A make with no models of its own does not leave the <select> dead:
        // its colours sit at make level, which is where more than half of
        // this catalogue lives, and «todos los modelos» brings them anyway.
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

    /* The page asks for the colours; it used to have them.

       Two things at once so they do not trample each other: a number that
       goes up on each request, and an AbortController. The number is what
       guarantees a slow answer does not write over a fast one that left
       later; the abort is what avoids spending bytes on the one that no
       longer matters.

       There is no debounce, and that is not an oversight: the only things
       that fire a request are changing one of the two <select>s or pressing
       «ver más». The text search and the hue chips filter what is already
       on screen. */
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
                // Offline or with the database down, the local catalogue's
                // 777 colours remain: ten makes, but something. It only helps
                // if the chosen make is one of them.
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

    // Paints what is already loaded. It asks for nothing: the text filter and
    // the hue chips work on the rows at hand, as before.
    function renderFinder() {
        if (!finder || finder.hidden || !PAINTS) return;

        // A code's versions are shown on their own: the model and year
        // selects, the tone chips and the text filter are for browsing a
        // make, and next to the versions of a code already typed they only
        // invite a second search. See .colour-finder.is-variants in styles.css.
        var variants = finderState.pinned;
        finder.classList.toggle("is-variants", variants);

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
            // The versions all show: a tone or text left over from browsing
            // would hide some of them behind controls that are not on screen.
            if (variants) return true;
            if (finderState.family && c.family !== finderState.family) return false;
            if (!text) return true;
            if (c.name.toLowerCase().indexOf(text) !== -1) return true;
            if (c.swName && c.swName.toLowerCase().indexOf(text) !== -1) return true;
            if (!q) return false;
            if (PAINTS.normalizeCode(c.code).indexOf(q) === 0) return true;
            // And by Sherwin's, the one on the can's label and the one the
            // grid just showed.
            if (c.swCode && PAINTS.normalizeCode(c.swCode).indexOf(q) === 0) return true;
            // Also by the other codes of the same paint: whoever types «PBX»
            // over the grid is after the card headed «KBX».
            return (c.altCodes || []).some(function (a) {
                return PAINTS.normalizeCode(a).indexOf(q) === 0;
            });
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
            code.textContent = codeLabel(colour);

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

        // «Ver más» and not «ver N más»: the database never says how many
        // there are, on purpose, so the page cannot promise it either.
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
            var from = colour.years[0];
            var to = colour.years[1];
            // «2012–null» showed as is on the tile when one end was missing,
            // which always happens while the colour is still on sale.
            if (from !== null && to !== null) {
                bits.push(from === to ? String(from) : from + "–" + to);
            } else if (from !== null) {
                bits.push("desde " + from);
            } else if (to !== null) {
                bits.push("hasta " + to);
            }
        }
        if (colour.dualTone) bits.push("bitono");
        return bits.join(", ");
    }

    function finderNoteText(shown) {
        if (finderState.error) return finderState.error;
        var brandName = makeLabel(brandSelect.value);
        if (finderState.rows.length === 0) {
            return "No encontramos colores de " + brandName + " para esa combinación." +
                " Prueba otro año o quita el modelo, o tráelo al taller.";
        }
        if (shown === 0) return "Ningún color de los cargados coincide con el filtro.";

        var modelName = finderModel.options[finderModel.selectedIndex];
        var where = finderModel.value && modelName
            ? "del " + modelName.textContent
            : "de " + brandName;
        var note = "Colores " + where +
            (finderYear.value ? " de " + finderYear.value : "") +
            " en el catálogo del fabricante.";
        // More than half of this catalogue hangs off the make and not the
        // model, so it is worth saying when that is what is showing.
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

    // A new request: back to the first page and the loaded rows are thrown
    // away, because they describe another combination.
    function resetFinderPaging() {
        finderState.from = 0;
        finderState.rows = [];
        finderState.hasMore = false;
        finderState.error = "";
        finderState.pinned = false;
        requestFinder();
    }

    // The text filter and the hue chips ask for nothing: they work on what
    // is already loaded.
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
                // Opening makes the real request: until now there was nothing
                // to paint, because the colours no longer live in the page.
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
            // The database caps the offset at 600 and answers 400 past that,
            // so «ver más» switches off before getting there instead of looping.
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

    /* ---------------------------------------------------------------------
       Step 2: the container
       --------------------------------------------------------------------- */

    function unitPrice() {
        if (!PAINTS || !state.size || !state.colour) return null;
        return PAINTS.price(state.size, state.colour.finish);
    }

    function orderTotalAmount() {
        var unit = unitPrice();
        return unit === null ? null : unit * state.units;
    }

    // The six cards are built once; the prices every time the step is
    // entered, because they depend on the chosen colour's finish, which can
    // change by going back (a solid and a tri-coat do not cost the same).
    function renderSizeCards() {
        if (!sizeCards || !PAINTS) return;
        if (sizeCards.childElementCount > 0) {
            refreshSizePrices();
            paintSizeJars();
            return;
        }

        PAINTS.SIZES.forEach(function (size) {
            var card = document.createElement("button");
            card.type = "button";
            card.className = "size-card";
            card.setAttribute("role", "radio");
            card.setAttribute("aria-checked", "false");
            card.dataset.size = size.id;

            // The six containers drawn: the same can at different sizes,
            // standing on one line. It is the comparison really needed (which
            // is bigger than which) and it depends on no image. The side grows
            // with the cube root of the volume, which is how a real container
            // grows: twice the paint is not twice as tall.
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

        paintSizeJars();
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
       Step 3: the company
       --------------------------------------------------------------------- */

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
       Step 4: the summary

       Each block carries its link to the step where it is changed. This is
       the screen where someone finds they picked the wrong container, and
       sending them to hunt for «Atrás» three times is worse than a shortcut.
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
        in_person: "Lectura en el taller"
    };

    function renderSummary() {
        if (!summaryBox) return;
        summaryBox.innerHTML = "";

        // The colour ---------------------------------------------------
        var colourRows = [{ label: "Identificado", value: METHOD_LABELS[orderMethod()] }];
        var swatch = null;

        if (state.colour) {
            colourRows.push({ label: "Marca", value: state.colour.brand });
            colourRows.push({ label: "Código", value: codeLabel(state.colour), code: true });
            colourRows.push({ label: "Color", value: state.colour.name });
            colourRows.push({ label: "Acabado", value: PAINTS.finishLabel(state.colour.finish) });
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

        // The order ----------------------------------------------------
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

        // The company --------------------------------------------------
        summaryBox.appendChild(summaryBlock("La empresa", 3, [
            { label: "Nombre taller", value: companyName.value.trim() },
            { label: "Contacto", value: firstNameInput.value.trim() + " " + lastNameInput.value.trim() },
            { label: "Teléfono", value: "+51 " + phoneInput.value, code: true },
            { label: "Email", value: emailInput.value.trim() },
            { label: "Notas", value: notesInput.value.trim() }
        ]));

        // The price ----------------------------------------------------
        var total = skipsQuantity() ? null : orderTotalAmount();
        if (summaryPrice) {
            summaryPrice.hidden = total === null;
            if (total !== null) summaryTotal.textContent = PAINTS.formatSoles(total);
        }
        if (summaryLegal) {
            // The delivery note depends on whether they left an email: the
            // WhatsApp always goes (the phone is required), the email only if
            // they wrote one. «código de la visita» / «código del pedido»
            // depending on whether there is a price.
            var hasEmail = emailInput.value.trim() !== "";
            var codeWord = total === null ? "de la visita" : "del pedido";
            var send = "Al confirmar te escribimos por WhatsApp dentro de 24 h con el código " +
                codeWord + (hasEmail ? ", y te lo enviamos también por correo" : "") + ".";
            summaryLegal.textContent = total === null
                ? send + " Quedas en nuestra agenda."
                : "Precio referencial, sin IGV. " + send +
                  " El taller cierra el precio al matizar el color.";
        }
    }

    /* ---------------------------------------------------------------------
       Sending

       Same treatment as the quote wizard: no success screen until the server
       confirms. See src/repair.js for the reason behind each error branch.
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
            // No colour on the workshop route: the three fields travel empty
            // and the server accepts them that way (see validatePaintOrder).
            brand: state.colour ? state.colour.brand : "",
            brandId: state.colour ? state.colour.brandId : "",
            colorCode: state.colour ? state.colour.code : "",
            colorName: state.colour ? state.colour.name : "",
            // Sherwin's id, when the colour came from the database. It is what
            // the server resolves again before saving, and what finds the
            // formula at the counter. Empty if it came from the local catalogue.
            swCode: state.colour ? (state.colour.swCode || "") : "",
            finish: state.colour ? state.colour.finish : "",
            reading: state.reading,
            size: skipsQuantity() ? "" : state.size,
            units: skipsQuantity() ? null : state.units,
            // The price the customer had in front of them when confirming.
            // Stored so the workshop knows what was promised, not to charge
            // it: the server does not recalculate it and the page calls it
            // referential.
            price: skipsQuantity() ? null : orderTotalAmount(),
            company: companyName.value,
            firstName: firstNameInput.value,
            lastName: lastNameInput.value,
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
            var isVisit = skipsQuantity();
            var lead = isVisit
                ? "Te esperamos en el taller con el vehículo o la pieza."
                : "Estamos preparando tu matizado.";
            // What really closes the order: within 24 h we write on WhatsApp
            // to the phone to arrange the appointment or the pickup.
            lead += " Te escribimos por WhatsApp dentro de 24 h para coordinar " +
                (isVisit ? "la cita" : "la entrega") + " y los detalles.";
            var email = emailInput.value.trim();
            if (email) lead += " También te enviamos el código por correo a " + email + ".";
            successLead.textContent = lead;
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
                // The clipboard may be blocked: the code stays on screen and
                // can be selected.
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

        Array.prototype.forEach.call(sizeCards.querySelectorAll(".size-card"), function (card) {
            card.classList.remove("is-selected");
            card.setAttribute("aria-checked", "false");
        });
        renderOrderBar();

        companyForm.reset();
        [phoneInput, emailInput].forEach(function (input) {
            var field = input.closest(".field");
            if (field) field.classList.remove("field--invalid");
            input.removeAttribute("aria-invalid");
        });
        phoneError.hidden = true;
        emailError.hidden = true;
        setSubmitError("");
        if (successCode) successCode.textContent = "";

        progressNav.hidden = false;
        confirmBtn.hidden = false;
        if (wizardFoot) wizardFoot.hidden = false;
        successPanel.hidden = true;
        goTo(1);
    });

    /* ---------------------------------------------------------------------
       Menu (same as the rest of the site, see src/home.js)
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

    // The manufacturer catalogue's 383 makes, the ten the workshop sells
    // first. It comes from a file, so there is no wait and nothing to load.
    if (INDEX && brandSelect) {
        INDEX.makes.forEach(function (make) {
            var opt = document.createElement("option");
            opt.value = String(make[0]);
            opt.textContent = make[1];
            brandSelect.appendChild(opt);
        });
    } else if (PAINTS && brandSelect) {
        // Without the index the local catalogue remains: ten makes, but the
        // page still sells. The value is still an id, and searchByCode()
        // tells the two cases apart by SIDECAR_BY_LABEL.
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
