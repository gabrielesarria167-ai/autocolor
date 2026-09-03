/* =========================================================================
   lookup.js — "Consulta tu solicitud" (repair.html)

   Con el código de 10 dígitos que se entrega al enviar el formulario, este
   pequeño formulario pregunta por la solicitud a GET /api/requests/:id y
   muestra lo que el servidor devuelve: código, vehículo, nombre, apellido y
   estado. Nada más viaja al navegador — el teléfono, el correo y las notas
   se quedan en la base, porque el código anda escrito en papeles y mensajes
   y no debería alcanzar para sacar los datos de contacto de un cliente.
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

    // Igual que en repair.js: vacío es el mismo origen, y un 404/405/501 aquí
    // significa que este sitio se publicó sin la API detrás, no que el código
    // esté mal.
    var API_BASE = window.AUTOCOLOR_API_BASE || "";
    var API_MISSING_STATUS = [404, 405, 501];
    var API_MISSING_MESSAGE = "La consulta de solicitudes no está disponible en esta versión del sitio.";

    // Reserva para las solicitudes que se enviaron cuando el paso 1 solo
    // preguntaba la categoría del vehículo y no la marca y el modelo.
    var VEHICLE_LABELS = {
        van: "Furgoneta",
        wagon: "Familiar",
        pickup: "Pickup"
    };

    // Los estados y sus etiquetas viven en src/statuses.js, que esta página
    // carga antes que este archivo. El taller los cambia desde su panel
    // (pgs/taller.html); aquí solo se traducen a algo legible.
    var STATUSES = window.AUTOCOLOR_STATUSES;

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
        resultStatus.textContent = STATUSES.LABELS[request.status] || request.status;
        // El color del distintivo sale del estado en crudo (ver .status-pill
        // en styles.css), no de la etiqueta traducida.
        resultStatus.dataset.status = request.status;
        resultEl.hidden = false;
    }

    // Solo dígitos, como el campo de teléfono del paso 4.
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
            // Un 404 con cuerpo JSON es "ese código no existe", que es una
            // respuesta legítima de la API; uno sin JSON es un alojamiento
            // estático respondiendo por un archivo que no tiene.
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
        }).then(function (request) {
            showResult(request);
        }).catch(function (err) {
            resultEl.hidden = true;
            // Igual que al enviar el formulario: un TypeError significa que la
            // petición no llegó a salir, no que el servidor haya respondido.
            setError(err instanceof TypeError
                ? "No pudimos conectar con el servidor. Revisa tu conexión e inténtalo nuevamente."
                : err.message);
        }).then(function () {
            submitBtn.disabled = false;
            submitBtn.textContent = "Consultar";
        });
    });
})();
