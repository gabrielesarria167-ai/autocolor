/* =========================================================================
   lookup.js: "Consulta tu solicitud" (repair.html)

   With the 10-digit code handed out when the form is sent, this small form
   asks GET /api/requests/:id for the request and shows what the server
   returns: code, vehicle, first name, last name and status. Nothing else
   reaches the browser. Phone, email and notes stay in the database, because
   the code gets written on paper and in messages and should not be enough to
   pull a customer's contact details.
   ========================================================================= */

(function () {
    "use strict";

    var form = document.getElementById("lookupForm");
    if (!form) return;

    var input = document.getElementById("lookupId");
    var submitBtn = document.getElementById("lookupSubmit");
    var errorEl = document.getElementById("lookupError");
    var resultEl = document.getElementById("lookupResult");
    var resultId = document.getElementById("resultId");
    var resultVehicle = document.getElementById("resultVehicle");
    var resultFirstName = document.getElementById("resultFirstName");
    var resultLastName = document.getElementById("resultLastName");
    var resultStatus = document.getElementById("resultStatus");

    var CODE_DIGITS = 10;

    // Same as repair.js: empty means same origin, and a 404/405/501 here
    // means this site was published without the API behind it, not that the
    // code is wrong.
    var API_BASE = window.AUTOCOLOR_API_BASE || "";
    var API_MISSING_STATUS = [404, 405, 501];
    var API_MISSING_MESSAGE = "Todavía no podemos consultar solicitudes desde esta versión del sitio. " +
        "Escríbenos por WhatsApp al +51 935 646 304 con tu código y te decimos cómo va.";

    // Fallback for requests sent back when step 1 only asked for the vehicle
    // category, not the make and model.
    var VEHICLE_LABELS = {
        van: "Furgoneta",
        wagon: "Familiar",
        pickup: "Pickup",
        suv: "SUV"
    };

    // The statuses and their labels live in src/statuses.js, which this page
    // loads before this file. The workshop changes them from its panel
    // (pgs/taller.html); here they are only turned into something readable.
    //
    // Guarded like repair.js guards parts.js: without statuses.js the raw
    // status shows instead of a label, rather than a TypeError while painting
    // a lookup that succeeded.
    var STATUS_LABELS = (window.AUTOCOLOR_STATUSES && window.AUTOCOLOR_STATUSES.LABELS) || {};

    function setError(message) {
        if (!errorEl) return;
        errorEl.textContent = message || "";
        errorEl.hidden = !message;
    }

    function showResult(request) {
        resultId.textContent = request.id;
        var car = [request.brand, request.model].filter(Boolean).join(" ");
        resultVehicle.textContent = car || VEHICLE_LABELS[request.vehicle] || request.vehicle;
        resultFirstName.textContent = request.firstName;
        resultLastName.textContent = request.lastName;
        resultStatus.textContent = STATUS_LABELS[request.status] || request.status;
        // The badge colour comes from the raw status (see .status-pill in
        // styles.css), not from the translated label.
        resultStatus.dataset.status = request.status;
        resultEl.hidden = false;
    }

    // Digits only, like the phone field in step 4.
    input.addEventListener("input", function () {
        var digits = input.value.replace(/\D/g, "").slice(0, CODE_DIGITS);
        if (digits !== input.value) input.value = digits;
        if (errorEl && !errorEl.hidden) setError("");
    });

    form.addEventListener("submit", function (event) {
        event.preventDefault();

        var code = input.value.replace(/\D/g, "");
        if (code.length !== CODE_DIGITS) {
            resultEl.hidden = true;
            setError("El código tiene " + CODE_DIGITS + " dígitos. Revísalo e inténtalo nuevamente.");
            input.focus();
            return;
        }

        setError("");
        submitBtn.disabled = true;
        submitBtn.textContent = "Consultando…";

        fetch(API_BASE + "/api/requests/" + code).then(function (response) {
            // A 404 with a JSON body is "that code does not exist", a
            // legitimate API answer; one without JSON is a static host
            // answering for a file it does not have.
            return response.json().catch(function () { return null; }).then(function (body) {
                if (!body) {
                    throw new Error(API_MISSING_STATUS.indexOf(response.status) !== -1
                        ? API_MISSING_MESSAGE
                        : "No pudimos consultar tu solicitud.");
                }
                if (!response.ok) {
                    throw new Error(body.error || "No pudimos consultar tu solicitud.");
                }
                return body;
            });
        }, function (err) {
            // Only a rejected fetch means the request never left. A TypeError
            // thrown later, while painting the answer, is a bug in this page
            // and must not be reported as the customer's connection.
            err.offline = true;
            throw err;
        }).then(function (request) {
            showResult(request);
        }).catch(function (err) {
            resultEl.hidden = true;
            if (err.offline) {
                setError("No pudimos conectar con el servidor. Revisa tu conexión e inténtalo nuevamente.");
            } else if (err instanceof TypeError) {
                console.error("[lookup]", err);
                setError("No pudimos mostrar tu solicitud. Inténtalo nuevamente.");
            } else {
                setError(err.message);
            }
        }).then(function () {
            submitBtn.disabled = false;
            submitBtn.textContent = "Consultar";
        });
    });
})();
