/* Autocolor — home page behaviour.
   Menu panel, colour preview swatches, scroll reveal, footer year.
   Everything degrades gracefully: with the script blocked the page is still
   complete and readable. */
(function () {
    "use strict";

    var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* ===== Mobile menu ===== */
    var toggle = document.getElementById("menuToggle");
    var panel = document.getElementById("navPanel");

    if (toggle && panel) {
        var setOpen = function (open) {
            toggle.classList.toggle("is-open", open);
            panel.classList.toggle("is-open", open);
            toggle.setAttribute("aria-expanded", String(open));
        };

        toggle.addEventListener("click", function () {
            setOpen(!panel.classList.contains("is-open"));
        });

        panel.addEventListener("click", function (event) {
            if (event.target.closest("a")) setOpen(false);
        });

        document.addEventListener("click", function (event) {
            if (!panel.classList.contains("is-open")) return;
            if (panel.contains(event.target) || toggle.contains(event.target)) return;
            setOpen(false);
        });

        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape" && panel.classList.contains("is-open")) {
                setOpen(false);
                toggle.focus();
            }
        });
    }

    /* ===== Hero colour preview =====
       The tint layer is masked with the vehicle silhouette and blended in
       `color` mode, so it repaints the bodywork while keeping the original
       highlights and shadows. Neutral finishes (pearl white, onyx) can't be
       produced that way — a grey in `color` mode just desaturates — so those
       swatches drive a filter on the image instead. */
    var vehicle = document.getElementById("heroVehicle");
    var swatchRow = document.querySelector(".swatches__row");

    if (vehicle && swatchRow) {
        var swatches = Array.prototype.slice.call(swatchRow.querySelectorAll(".swatch"));

        var apply = function (button) {
            var tint = button.getAttribute("data-tint") || "";
            var filter = button.getAttribute("data-filter") || "";
            var boost = button.getAttribute("data-boost") || "";

            vehicle.style.setProperty("--vehicle-tint", tint || "transparent");
            vehicle.style.setProperty("--vehicle-tint-opacity", tint ? "1" : "0");
            vehicle.style.setProperty("--vehicle-filter", filter || "none");
            vehicle.style.setProperty("--vehicle-boost", boost || "none");

            swatches.forEach(function (other) {
                var active = other === button;
                other.classList.toggle("is-active", active);
                other.setAttribute("aria-checked", String(active));
            });
        };

        swatches.forEach(function (button, index) {
            button.addEventListener("click", function () {
                apply(button);
            });

            // Arrow keys move through the group, as a radiogroup should.
            button.addEventListener("keydown", function (event) {
                var step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1
                    : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1
                        : 0;
                if (!step) return;
                event.preventDefault();
                var next = swatches[(index + step + swatches.length) % swatches.length];
                next.focus();
                apply(next);
            });
        });
    }

    /* ===== Scroll reveal ===== */
    var revealables = document.querySelectorAll(".reveal");

    if (revealables.length && "IntersectionObserver" in window && !reduceMotion) {
        document.body.classList.add("reveal-ready");

        var observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                entry.target.classList.add("is-visible");
                observer.unobserve(entry.target);
            });
        }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });

        revealables.forEach(function (element) {
            observer.observe(element);
        });
    }

    /* ===== Footer year ===== */
    var year = document.getElementById("year");
    if (year) year.textContent = String(new Date().getFullYear());
})();
