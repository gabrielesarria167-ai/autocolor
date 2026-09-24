/* =============================================================================
   The makes and models catalogue for step 1.

   Everything the wizard knows about a vehicle before asking the customer
   comes from here: which models each make offers, which body each model has
   and which picture shows it.

   It lives in a file and not in the database on purpose. It is a reference
   table that changes once or twice a year (when a new model comes in), the
   browser reads it before any request exists, and putting it in Postgres
   would force a round trip to the server (and require a server) just to
   fill two <select>s. Editing this file is all the upkeep it needs.

   How to add a model:

       { id: "corolla", name: "Corolla", type: "sedan", family: "corolla" }

   `id`      identifies the model within its make and names its photo in
             stock-models/; it does not change once published. The request
             stores `name`, not `id`.
   `type`    the body, one of BODY_TYPES. The category the step 3 3D viewer
             works with follows from it.
   `family`  the model name as the paid photo provider spells it (see
             carPhotoUrl() in repair.js).

   Each model's photo is not declared: the file is called
   `<make>-<model>.jpg` inside imgs/assets/stock-models/, so it follows from
   the two ids (photoFor(), below). A new model only needs its photo dropped
   there under that name; if it is missing, the step 1 card falls back to the
   make's logo instead of going blank.
   ========================================================================== */

(function () {
    "use strict";

    // Each body is drawn in step 3 with one of the four 3D models that exist
    // (van, wagon, pickup, suv), because they are the only ones with
    // selectable panels. `vehicle` is that mapping: a sedan and a hatchback
    // are painted on the car silhouette (wagon). The customer sees the
    // `label` name, which is their actual vehicle's.
    //
    // SUVs have had their own silhouette since the `suv` model arrived.
    // Before that they were painted on the pickup's, the only tall one with
    // that bulk; they were 48 of the catalogue's 108 models, so almost half
    // the catalogue picked panels on a body that was not theirs.
    var BODY_TYPES = {
        sedan: { label: "Sedán", vehicle: "wagon" },
        hatchback: { label: "Hatchback", vehicle: "wagon" },
        coupe: { label: "Coupé", vehicle: "wagon" },
        wagon: { label: "Station wagon", vehicle: "wagon" },
        suv: { label: "SUV", vehicle: "suv" },
        pickup: { label: "Pickup", vehicle: "pickup" },
        minivan: { label: "Minivan", vehicle: "van" },
        van: { label: "Furgoneta", vehicle: "van" }
    };

    // Logo paths are relative to pgs/, where both pages that load this
    // catalogue live (repair.html and taller.html).
    var BRANDS = [
        {
            id: "toyota",
            name: "Toyota",
            logo: "../imgs/brands/toyota.svg",
            color: "#EB0A1E",
            models: [
                { id: "yaris-sedan", name: "Yaris Sedán", type: "sedan", family: "yaris" },
                { id: "yaris-hatchback", name: "Yaris Hatchback", type: "hatchback", family: "yaris" },
                { id: "corolla", name: "Corolla", type: "sedan", family: "corolla" },
                { id: "corolla-cross", name: "Corolla Cross", type: "suv", family: "corolla cross" },
                { id: "rav4", name: "RAV4", type: "suv", family: "rav4" },
                { id: "rush", name: "Rush", type: "suv", family: "rush" },
                { id: "fortuner", name: "Fortuner", type: "suv", family: "fortuner" },
                { id: "land-cruiser-prado", name: "Land Cruiser Prado", type: "suv", family: "land cruiser prado" },
                { id: "hilux", name: "Hilux", type: "pickup", family: "hilux" },
                { id: "avanza", name: "Avanza", type: "minivan", family: "avanza" },
                { id: "hiace", name: "Hiace", type: "van", family: "hiace" }
            ]
        },
        {
            id: "chevrolet",
            name: "Chevrolet",
            logo: "../imgs/brands/chevrolet.svg",
            color: "#CD9834",
            models: [
                { id: "spark", name: "Spark GT", type: "hatchback", family: "spark" },
                { id: "sail", name: "Sail", type: "sedan", family: "sail" },
                { id: "onix", name: "Onix", type: "sedan", family: "onix" },
                { id: "cruze", name: "Cruze", type: "sedan", family: "cruze" },
                { id: "groove", name: "Groove", type: "suv", family: "groove" },
                { id: "tracker", name: "Tracker", type: "suv", family: "tracker" },
                { id: "captiva", name: "Captiva", type: "suv", family: "captiva" },
                { id: "equinox", name: "Equinox", type: "suv", family: "equinox" },
                { id: "tahoe", name: "Tahoe", type: "suv", family: "tahoe" },
                { id: "colorado", name: "Colorado", type: "pickup", family: "colorado" },
                { id: "n300", name: "N300 Max", type: "van", family: "n300" }
            ]
        },
        {
            id: "ford",
            name: "Ford",
            logo: "../imgs/brands/ford.svg",
            color: "#003478",
            models: [
                { id: "fiesta", name: "Fiesta", type: "hatchback", family: "fiesta" },
                { id: "focus", name: "Focus", type: "hatchback", family: "focus" },
                { id: "mustang", name: "Mustang", type: "coupe", family: "mustang" },
                { id: "ecosport", name: "EcoSport", type: "suv", family: "ecosport" },
                { id: "escape", name: "Escape", type: "suv", family: "escape" },
                { id: "territory", name: "Territory", type: "suv", family: "territory" },
                { id: "edge", name: "Edge", type: "suv", family: "edge" },
                { id: "explorer", name: "Explorer", type: "suv", family: "explorer" },
                { id: "bronco-sport", name: "Bronco Sport", type: "suv", family: "bronco sport" },
                { id: "ranger", name: "Ranger", type: "pickup", family: "ranger" },
                { id: "f-150", name: "F-150", type: "pickup", family: "f-150" },
                { id: "transit", name: "Transit", type: "van", family: "transit" }
            ]
        },
        {
            id: "subaru",
            name: "Subaru",
            logo: "../imgs/brands/subaru.svg",
            color: "#013C74",
            models: [
                { id: "impreza", name: "Impreza", type: "hatchback", family: "impreza" },
                { id: "legacy", name: "Legacy", type: "sedan", family: "legacy" },
                { id: "wrx", name: "WRX", type: "sedan", family: "wrx" },
                { id: "brz", name: "BRZ", type: "coupe", family: "brz" },
                { id: "outback", name: "Outback", type: "wagon", family: "outback" },
                { id: "crosstrek", name: "Crosstrek (XV)", type: "suv", family: "crosstrek" },
                { id: "forester", name: "Forester", type: "suv", family: "forester" },
                { id: "ascent", name: "Ascent", type: "suv", family: "ascent" }
            ]
        },
        {
            id: "nissan",
            name: "Nissan",
            logo: "../imgs/brands/nissan.svg",
            color: "#C3002F",
            models: [
                { id: "march", name: "March", type: "hatchback", family: "march" },
                { id: "note", name: "Note", type: "hatchback", family: "note" },
                { id: "versa", name: "Versa", type: "sedan", family: "versa" },
                { id: "sentra", name: "Sentra", type: "sedan", family: "sentra" },
                { id: "kicks", name: "Kicks", type: "suv", family: "kicks" },
                { id: "qashqai", name: "Qashqai", type: "suv", family: "qashqai" },
                { id: "x-trail", name: "X-Trail", type: "suv", family: "x-trail" },
                { id: "murano", name: "Murano", type: "suv", family: "murano" },
                { id: "pathfinder", name: "Pathfinder", type: "suv", family: "pathfinder" },
                { id: "frontier", name: "Frontier (NP300)", type: "pickup", family: "frontier" },
                { id: "urvan", name: "Urvan", type: "van", family: "urvan" }
            ]
        },
        {
            id: "bmw",
            name: "BMW",
            logo: "../imgs/brands/bmw.svg",
            color: "#0066B1",
            models: [
                { id: "serie-1", name: "Serie 1", type: "hatchback", family: "1 series" },
                { id: "serie-2", name: "Serie 2 Gran Coupé", type: "sedan", family: "2 series" },
                { id: "serie-3", name: "Serie 3", type: "sedan", family: "3 series" },
                { id: "serie-4", name: "Serie 4", type: "coupe", family: "4 series" },
                { id: "serie-5", name: "Serie 5", type: "sedan", family: "5 series" },
                { id: "z4", name: "Z4", type: "coupe", family: "z4" },
                { id: "x1", name: "X1", type: "suv", family: "x1" },
                { id: "x3", name: "X3", type: "suv", family: "x3" },
                { id: "x5", name: "X5", type: "suv", family: "x5" },
                { id: "x6", name: "X6", type: "suv", family: "x6" },
                { id: "x7", name: "X7", type: "suv", family: "x7" }
            ]
        },
        {
            id: "audi",
            name: "Audi",
            logo: "../imgs/brands/audi.svg",
            color: "#BB0A30",
            models: [
                { id: "a1", name: "A1", type: "hatchback", family: "a1" },
                { id: "a3", name: "A3", type: "sedan", family: "a3" },
                { id: "a4", name: "A4", type: "sedan", family: "a4" },
                { id: "a4-avant", name: "A4 Avant", type: "wagon", family: "a4 avant" },
                { id: "a5", name: "A5", type: "coupe", family: "a5" },
                { id: "a6", name: "A6", type: "sedan", family: "a6" },
                { id: "tt", name: "TT", type: "coupe", family: "tt" },
                { id: "q2", name: "Q2", type: "suv", family: "q2" },
                { id: "q3", name: "Q3", type: "suv", family: "q3" },
                { id: "q5", name: "Q5", type: "suv", family: "q5" },
                { id: "q7", name: "Q7", type: "suv", family: "q7" },
                { id: "q8", name: "Q8", type: "suv", family: "q8" }
            ]
        },
        {
            id: "mercedes",
            name: "Mercedes-Benz",
            logo: "../imgs/brands/mercedes.svg",
            color: "#242424",
            models: [
                { id: "clase-a", name: "Clase A", type: "hatchback", family: "a-class" },
                { id: "cla", name: "CLA", type: "sedan", family: "cla" },
                { id: "clase-c", name: "Clase C", type: "sedan", family: "c-class" },
                { id: "clase-e", name: "Clase E", type: "sedan", family: "e-class" },
                { id: "clase-s", name: "Clase S", type: "sedan", family: "s-class" },
                { id: "gla", name: "GLA", type: "suv", family: "gla" },
                { id: "glb", name: "GLB", type: "suv", family: "glb" },
                { id: "glc", name: "GLC", type: "suv", family: "glc" },
                { id: "gle", name: "GLE", type: "suv", family: "gle" },
                { id: "gls", name: "GLS", type: "suv", family: "gls" },
                { id: "clase-v", name: "Clase V", type: "minivan", family: "v-class" },
                { id: "vito", name: "Vito", type: "van", family: "vito" },
                { id: "sprinter", name: "Sprinter", type: "van", family: "sprinter" }
            ]
        },
        {
            id: "fiat",
            name: "Fiat",
            logo: "../imgs/brands/fiat.svg",
            color: "#AF1E2D",
            models: [
                { id: "mobi", name: "Mobi", type: "hatchback", family: "mobi" },
                { id: "500", name: "500", type: "hatchback", family: "500" },
                { id: "argo", name: "Argo", type: "hatchback", family: "argo" },
                { id: "uno", name: "Uno", type: "hatchback", family: "uno" },
                { id: "cronos", name: "Cronos", type: "sedan", family: "cronos" },
                { id: "pulse", name: "Pulse", type: "suv", family: "pulse" },
                { id: "fastback", name: "Fastback", type: "suv", family: "fastback" },
                { id: "toro", name: "Toro", type: "pickup", family: "toro" },
                { id: "fiorino", name: "Fiorino", type: "van", family: "fiorino" },
                { id: "doblo", name: "Doblò", type: "van", family: "doblo" },
                { id: "ducato", name: "Ducato", type: "van", family: "ducato" }
            ]
        },
        {
            id: "jeep",
            name: "Jeep",
            logo: "../imgs/brands/jeep.svg",
            color: "#004A25",
            models: [
                { id: "avenger", name: "Avenger", type: "suv", family: "avenger" },
                { id: "renegade", name: "Renegade", type: "suv", family: "renegade" },
                { id: "compass", name: "Compass", type: "suv", family: "compass" },
                { id: "commander", name: "Commander", type: "suv", family: "commander" },
                { id: "cherokee", name: "Cherokee", type: "suv", family: "cherokee" },
                { id: "grand-cherokee", name: "Grand Cherokee", type: "suv", family: "grand cherokee" },
                { id: "wrangler", name: "Wrangler", type: "suv", family: "wrangler" },
                { id: "gladiator", name: "Gladiator", type: "pickup", family: "gladiator" }
            ]
        }
    ];

    // The photos come from Wikimedia Commons and each keeps its licence and
    // author in imgs/assets/stock-models/CREDITS.md.
    var PHOTO_DIR = "../imgs/assets/stock-models/";

    function photoFor(brandId, modelId) {
        return PHOTO_DIR + brandId + "-" + modelId + ".jpg";
    }

    function findBrand(brandId) {
        for (var i = 0; i < BRANDS.length; i++) {
            if (BRANDS[i].id === brandId) return BRANDS[i];
        }
        return null;
    }

    function findModel(brandId, modelId) {
        var brand = findBrand(brandId);
        if (!brand) return null;
        for (var i = 0; i < brand.models.length; i++) {
            if (brand.models[i].id === modelId) return brand.models[i];
        }
        return null;
    }

    window.CAR_CATALOG = {
        brands: BRANDS,
        bodyTypes: BODY_TYPES,
        findBrand: findBrand,
        findModel: findModel,
        photoFor: photoFor
    };
})();
