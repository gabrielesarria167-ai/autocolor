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
       Two layers stacked on the photo, both cut to the bodywork by the same
       mask (see .hero__vehicle-paint in styles.css):

         data-filter        light/dark and saturation of the paint
         data-tint          the hue, blended in `color` mode
         data-tint-opacity  how much of that hue lands

       Chromatic finishes need both — the tint alone over light beige comes out
       pink rather than red, so the filter darkens the panel first. The neutral
       finishes need only the filter: a grey in `color` mode has no hue to give.

       Whatever an attribute doesn't say falls back to the neutral value, so a
       swatch that sets nothing shows the original paint. */
    var vehicle = document.getElementById("heroVehicle");
    var swatchRow = document.querySelector(".swatches__row");

    if (vehicle && swatchRow) {
        var swatches = Array.prototype.slice.call(swatchRow.querySelectorAll(".swatch"));

        var apply = function (button) {
            var tint = button.getAttribute("data-tint") || "";
            var filter = button.getAttribute("data-filter") || "";
            var opacity = button.getAttribute("data-tint-opacity") || "";

            vehicle.style.setProperty("--vehicle-tint", tint || "transparent");
            vehicle.style.setProperty("--vehicle-tint-opacity", tint ? (opacity || "1") : "0");
            vehicle.style.setProperty("--vehicle-filter", filter || "none");

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
