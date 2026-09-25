# The quote wizard

`pgs/repair.html` is the customer's four-step quote form. `src/repair.js` runs
it, `src/lookup.js` runs the "check your request" form further down the same
page, and several data files feed both.

## The page

`pgs/repair.html` loads, all with `defer` (so in order, after parsing):

1. `src/config.js`: API origin and photo-service key.
2. `src/cities.js`: `PERU_DEPARTMENTS`.
3. `src/carModels.js`: `window.CAR_CATALOG`.
4. `src/statuses.js`: `window.AUTOCOLOR_STATUSES`.
5. `src/parts.js`: `window.AUTOCOLOR_PARTS`.
6. `src/repair.js`: the wizard.
7. `src/lookup.js`: the lookup form.

It also declares an **import map** so `src/carVisual.js` can
`import * as THREE from 'three'`:

```json
{ "imports": {
    "three": "../vendor/three@0.169.0/build/three.module.js",
    "three/addons/": "../vendor/three@0.169.0/examples/jsm/" } }
```

The markup has four `<section class="step" data-step="N">` blocks (only the
active one is not `hidden`), a progress bar of four dots, a footer with «Atrás»
(`#backLink`) and the main button (`#stepConfirm`), a success panel
(`#success`) and the lookup form (`#lookupForm`, reachable at `#consulta`).

## The four steps

| Step | Title | Collects | Valid when |
| --- | --- | --- | --- |
| 1 | Datos del vehículo | make, model, year, plate, mileage, colour code, first and last name | a model with a known body is chosen, year is 4 digits in range, plate matches `ABC-123`, mileage ≤ 2,000,000, both names filled |
| 2 | ¿Qué nivel de acabado deseas? | quality tier | a card is selected |
| 3 | ¿Qué zonas quieres pintar? | panels, on the 3D model or the checklist | at least one panel |
| 4 | Contacto | department, province, phone, email, notes | the `<form>`'s own `checkValidity()` passes |

## `src/repair.js`, piece by piece

The file is one IIFE. `state` (`:9`) holds what is not in a form field:

```js
var state = { vehicle: null, parts: [], quality: null };
```

- `vehicle` is the 3D silhouette. The customer never picks it; it follows from
  the model's body type.
- `parts` is the array of panel ids, the **single source of truth** for the
  selection. The 3D viewer reads it through a callback and never keeps its
  own copy.

### Navigation and the "never disabled" button

- `isStepValid(step)` (`:396`) is the rule table above.
- `refreshConfirm()` (`:415`) sets `aria-disabled` on the main button. It is
  **never** truly `disabled`: a disabled button gave no reason when tapped.
  Instead, a click on an incomplete step calls `explainStep(step)` (`:429`),
  which marks each invalid field with its message, moves focus to the first
  missing control, and shows a hint under the button.
- `goTo(step)` (`:485`) shows one section, updates the progress dots
  (`updateProgress()`, `:472`), relabels the button («Guardar y continuar» on
  step 1, «Enviar solicitud» on step 4, «Continuar» otherwise), and on step 3
  builds the checklist, mounts the 3D viewer, resizes it (it may have been
  measured while hidden) and redraws the parts list. It focuses the step's
  `<h1>` for screen readers and scrolls to the top.
- «Atrás» is ignored while a submission is in flight.

### Step 1: vehicle

- The make `<select>` is filled from `CATALOG.brands`. Choosing a make fills the
  model list (`populateModelOptions()`, `:801`).
- `selectedCar()` (`:780`) returns `{ brand, model, body }` from the catalogue,
  or `null`.
- `updateCarPreview()` (`:815`) is the only caller of `setVehicle()`. It sets
  the silhouette from `body.vehicle`, shows the model's name and body label, and
  shows a note when the body is drawn on a borrowed silhouette («En el paso 3
  elegirás las piezas sobre el esquema Familiar…»).
- `setVehicle(next)` (`:791`) **clears the chosen panels** when the silhouette
  changes. Panel ids differ between models, so a selection on one does not mean
  anything on another.
- **The photo** (`carPhotoUrl()`, `:752`): the imagin.studio cut-out if a key is
  configured, otherwise `imgs/assets/stock-models/<make>-<model>.jpg`. If the
  image fails to load, the make's logo is shown instead (`showBrandLogo()`).
- Inputs format as you type: the year keeps four digits, the plate is
  upper-cased and gets its dash after the third character, mileage keeps seven
  digits. Errors appear on blur and clear as soon as the value becomes valid.
- `YEAR_MAX` is computed when the page opens (current year + 1); the server
  computes its own per request.

### Step 2: finish

Three cards with `role="radio"`. `selectQuality(card)` (`:943`) sets
`state.quality` from the card's `data-value`. A link from the home page can
preselect a card with `?acabado=standard|premium|custom` (`:962`).

### Step 3: panels

**The checklist.** `renderPartsPicker(vehicle)` (`:119`) builds one checkbox per
panel from `AUTOCOLOR_PARTS.BY_VEHICLE[vehicle]` inside a `<details>` element.
It is the way in for keyboards and screen readers, and the fallback when the 3D
viewer, three.js or the model fails to load. Before it existed, a failed viewer
meant no quote could be sent.

`toggleCarPart(id)` (`:106`) is the one function that changes the selection.
Both the checklist and the 3D viewer call it. It updates `state.parts`, asks
the viewer to redraw its overlays, re-renders the summary, and refreshes the
button.

**The 3D viewer.** `ensureCar3D(vehicle)` (`:296`) mounts it lazily:

1. If a viewer is already mounted for this vehicle and its model did not fail,
   do nothing.
2. Otherwise destroy the old viewer and replace the `<canvas>` with a fresh
   one (a destroyed viewer drops its WebGL context, and a canvas cannot get a
   new one).
3. `import("../src/carVisual.js")` once, cached in `car3dModule`.
4. `car3dMountId` is incremented for every mount. When the import resolves,
   a mount whose id is no longer current does nothing: the customer changed
   vehicle while it was loading.
5. `mountCar3D({ vehicle, canvasEl, …, isPartSelected, onPartToggle,
   onLoadError: openPartsPicker })`.

If the **import** fails: the cached promise is dropped (the browser's module
map remembers failures), `car3dRetries` is bumped so the next import uses a new
URL (`carVisual.js?reintento=1`), and one automatic retry happens 600 ms later.
If that fails too, the overlay shows «No se pudo cargar el visor 3D. Elige las
piezas en la lista de abajo.» and the checklist opens. (A failed three.js
import stays failed until reload, because the import map resolves it to the
same URL. That is what the checklist is for.)

**The summary and estimate.** `renderPartsSummary()` (`:165`) lists the chosen
panels with their price and a remove button. `renderEstimate()` (`:212`) uses
`AUTOCOLOR_PARTS.estimate(parts, quality)`: subtotal, the multi-part discount
row, the total, a nudge («Agrega 1 pieza más y el descuento sube a 7%»), and a
note that panels without a list price are not included and that the price is
indicative.

### Step 4: contact

- Department and province: `populateProvinceOptions(department)` (`:979`)
  fills the provinces from `PERU_DEPARTMENTS`, sorted with
  `localeCompare(…, "es")`. The province stays disabled until a department is
  chosen.
- Phone: digits only, nine of them; the `+51` is fixed in the UI.
- Email: disallowed characters are removed as you type; the format is checked
  on blur. It is required, because it is how the tracking code arrives. An
  empty field and a malformed one get different messages.

### Sending

`requestPayload()` (`:562`) builds the body:

```js
{ vehicle, quality, parts, brand: car.brand.name, model: car.model.name,
  bodyType: car.model.type, year, plate, mileage, colorCode,
  firstName, lastName, department, province,
  phone: "+51" + digits, email, notes }
```

Make and model go as **display names** because that is what the shop reads.
The phone is rebuilt from the visible field rather than taken from the hidden
`#phoneFull`, which browser autofill does not always update.

`submitRequest()` (`:591`):

- guards against double submission (`submitting`), disables both buttons and
  shows «Enviando…»;
- a `404`, `405` or `501` means the site is on a static host with no API
  behind it, and the customer is told to use WhatsApp instead of "try again";
- other errors show the server's Spanish message;
- a `TypeError` from `fetch` means the request never left, and the message
  says to check the connection;
- the success screen is shown **only** after the server confirms. Promising
  something was received when it was not stored is worse than asking to retry.

`showSuccess(id)` (`:633`) hides the steps, bar and footer, shows the code with
a «Copiar» button (Clipboard API, failing silently if blocked), and pre-fills
the lookup form with the code. «Nueva solicitud» (`#resetBtn`) resets every
field and returns to step 1; the 3D viewer stays mounted so choosing the same
vehicle again is free.

### The menu

`setMenu()` / `closeMenu()` (`:1077`): the same mobile menu as the home page.
The button's label says what it will do, tapping a link closes it, Escape
closes it and returns focus, and a click outside closes it.

## `src/lookup.js`

The «Consulta tu solicitud» form.

- The input keeps digits only, at most ten.
- On submit, a code that is not ten digits is refused locally.
- `fetch(API_BASE + "/api/requests/" + code)`:
  - a response with no JSON body and status `404`/`405`/`501` means no API
    behind the site;
  - a JSON `404` is "no request with that code";
  - otherwise it shows code, vehicle (make and model, or the silhouette label
    for very old requests), first name, last name, and the status label from
    `AUTOCOLOR_STATUSES.LABELS`. `data-status` on the pill picks its colour in
    CSS.
- Only a rejected `fetch` is reported as a connection problem. A `TypeError`
  thrown later, while drawing the result, is a page bug and is reported as
  such.

The server never returns phone, email or notes on this route.

## Shared data files

### `src/parts.js`

Loads two ways: in the browser it sets `window.AUTOCOLOR_PARTS`; in Node
(`server/mail.js`) it is `require`d. The UMD-style wrapper at the top picks
one.

| Export | What it is |
| --- | --- |
| `LABELS` | GLB node id → Spanish panel name. |
| `BY_VEHICLE` | The panel ids each silhouette offers, in the viewer's order. A copy of `VEHICLE_MODELS[*].parts` in `carVisual.js`, needed for the no-3D checklist; `tools/verify-3d.mjs` fails if the two disagree. |
| `PRICES` | Nine panel kinds (bumper front/rear, fender front/rear, door, hood, roof, trunk, sill), each with a price per quality tier. |
| `PRICE_GROUP_OF` | Node id → panel kind. The van's `rear_window_*` are body panels priced as rear fenders; the pickup's `tonneau` and the SUV's `tailgate` are priced as the trunk; the wagon's `Object_26` roof trim takes the lowest row. |
| `DISCOUNT_STEPS` | `[0, 0, 5, 7, 9, 10]`: percent off the subtotal by number of priced panels, capped at 10 % from five up. |
| `price(id, quality)` | One panel's price or `null`. |
| `estimate(ids, quality)` | `{ subtotal, priced, rate, discount, total, unpriced }`. The discount is rounded to whole soles. Unpriced panels are counted but add nothing, and do not count towards the discount. |
| `discountRate(count)`, `discountHint(count)` | The rate, and the nudge sentence. |
| `formatSoles(amount)` | «S/ 1,250» with `Intl.NumberFormat("es-PE")`. |
| `label(id)` | The Spanish name, or the raw id. Uses `hasOwnProperty`, so an id like `constructor` does not return `Object`'s prototype function. |

The home page describes the same discount steps in its «acabados» section, so
a change here must be copied there.

### `src/carModels.js`

`window.CAR_CATALOG` with:

- `BODY_TYPES`: eight bodies, each with a label and the silhouette it is drawn
  on (sedan, hatchback, coupe and wagon → `wagon`; minivan and van → `van`).
- `BRANDS`: ten makes, each with `id`, `name`, `logo` (relative to `pgs/`),
  a brand `color`, and `models: [{ id, name, type, family }]`. There are 109
  models. `type` is the body; `family` is how imagin.studio spells the model.
- `findBrand(id)`, `findModel(brandId, modelId)`, `photoFor(brandId, modelId)`.

It is a file and not a database table on purpose: it changes a couple of times
a year, and a table would need a server round trip just to fill two selects.
To add a model, add one line and drop its photo at
`imgs/assets/stock-models/<make>-<model>.jpg`. A missing photo falls back to
the make's logo. Photo credits are in `imgs/assets/stock-models/CREDITS.md`.

### `src/statuses.js`

`window.AUTOCOLOR_STATUSES` with `ORDER`, `LABELS` (what the customer sees),
`FILTER_LABELS` (the panel's short chips: PL, D/M, PI…), and the paint-order
equivalents `PAINT_ORDER`, `PAINT_LABELS`, `PAINT_FILTER_LABELS`. Request
labels are feminine («Recibida») because the subject is «la solicitud»; paint
labels are masculine because it is «el pedido».

**Adding a status** touches four places: this file, `STATUSES` or
`PAINT_STATUSES` in `server/server.js`, the `CHECK` in `server/schema.sql`,
and the `DROP CONSTRAINT` / `ADD CONSTRAINT` migration in the same file.

### `src/cities.js`

`PERU_DEPARTMENTS`: each of Peru's departments mapped to its provinces.
Global, loaded before `repair.js`.
