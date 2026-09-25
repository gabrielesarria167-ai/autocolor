# The workshop panel

`pgs/taller.html` is the staff tool, `src/staff.js` runs it (one IIFE,
about 3,200 lines). It is marked `noindex, nofollow`. Nothing in the page
protects data: the server checks the session on every call, and the page only
reacts to what it answers (see [workshop-auth.md](workshop-auth.md)).

Scripts: `config.js`, `statuses.js`, `carModels.js`, `parts.js`, `paints.js`
(without the colour catalogue), `staff.js`, plus the three.js import map for
the 3D viewer.

## The views

A single variable, `view`, decides what is on screen, and a single function,
`paintView()` (`src/staff.js:1827`), shows and hides everything, so no two code
paths can leave half a screen up.

| `view` | Section | Who | How you get there |
| --- | --- | --- | --- |
| `login` | `#staffLogin` «Acceso del taller» | everyone | no session, or a `401` anywhere |
| `profile` | `#staffProfile` | everyone | after login; «Volver al perfil» |
| `panel` | `#staffPanel` «Vehículos en el taller» / «Pedidos de matizado» | everyone | «Iniciar sesión» (work) or «Ver solicitudes» (look only) |
| `monitor` | `#staffMonitor` «Trabajadores» | boss | the boss's profile button |
| `intake` | `#staffIntake` «Registrar vehículo» | boss | the boss's profile button |

`paintView()` also:

- sets the top-right button: «Salir» on login and profile (logs out),
  «Terminar sesión» in working mode, «Volver al perfil» elsewhere;
- runs the clock on every screen except login;
- runs the monitor's 30-second refresh only while the monitor is visible;
- destroys the walk-in 3D viewer when leaving the intake view, and closes the
  parts viewer when leaving the panel (both hold tens of MB on the GPU, and
  the parts viewer animates);
- shows the «Código» column header only for the boss;
- switches the vehicles and paint tabs, their filters, title and search
  placeholder;
- shows the look-only notice, whose wording and button depend on whether the
  viewer is the boss.

### Startup

The last line of the file calls `loadRequests()`. The page does not know
whether a session exists, so it asks: a `401` shows the login, a `200` shows
the profile.

## Login and profile

`loginForm` submit (`:3111`) checks locally that the code has the right shape
(two letters, five digits) and that a password was typed, then POSTs to
`/api/staff/login`. On success it clears both fields and calls
`loadRequests()`.

`loadRequests()` (`:3054`) is the page's main data call. It stores
`body.viewer` and `body.requests`, builds each row's search text, paints the
profile, moves `login` to `profile` (but leaves `panel` alone, so refreshing a
filter does not bounce the user), renders the table, and loads paint orders the
first time so the tab count is ready.

**The profile** (`paintProfile()`, `:2014`) shows:

- the worker's name and code, and a photo sized by `sizePhoto()` (`:1982`) to
  the height of the column beside it (capped at 420 px, 4:5), iterating up to
  three times because resizing the photo can reflow the text;
- the boss's note to this worker, if any, with its date;
- a private notepad saved in `localStorage` under
  `autocolor.taller.notas.<code>`, 600 ms after typing stops, and on leaving
  the profile. It never goes to the server. A blocked `localStorage` is not an
  error;
- for workers: «Iniciar sesión» (work mode) and «Ver solicitudes» (look-only
  mode);
- for the boss: the monitor and «Registrar vehículo» instead of «Iniciar
  sesión».

**Look-only mode** (`readOnly`) draws the table with no controls. It is a
choice for the user, not a security boundary: the server knows nothing of it.

**Logging out** from the profile POSTs `/api/staff/logout` and clears the
in-memory rows **whether or not the request succeeds**: the point of the click
is to stop showing customer data.

## The vehicle table

Columns: Código (boss only), Placa, Cliente, Teléfono, Vehículo, Ingreso,
Piezas, Acabado, Estado, Ocupado. Built by `makeRow()` (`:1267`). The boss's
rows have one extra cell, rather than every row having a hidden one, so cells
and headers always line up. All customer-typed text goes through
`textContent`.

### Filters and search

- **Status chips** (`buildFilters()`, `:409`): «Todas» plus one per status,
  using the short labels. A chip reloads from the server with `?status=`,
  because the query returns at most 200 finished rows and filtering those in
  the browser would miss older ones.
- **«Mis vehículos»** (`buildMineFilter()`, `:371`): a toggle that shows only
  rows the viewer holds. Filtered in the browser, combinable with a status.
  Hidden for the boss.
- **Search** (`applySearch()`, `:1210`): matches code, plate, names, make,
  model and phone against a precomputed lower-case `searchText`. It only hides
  and shows existing rows. Rebuilding rows per keystroke used to create about
  2,200 status options with listeners per character.
- The count reads «N solicitudes», or «M de N solicitudes» when filtered.

### The status pill

`buildStatusCell(row, request, editable, spec)` (`:554`) draws a coloured pill
with a custom dropdown. A native `<select>` cannot colour its options, so the
menu rebuilds what the native control gives for free: open on click or arrow
keys, arrow navigation that wraps, Escape and outside-click to close, focus
return, close on any scroll or resize (the menu is `position: fixed` to escape
the table's horizontal scroll, and is placed by `placeMenu()`, which opens it
upwards near the bottom of the screen). Only one menu can be open (`openMenu`).

The pill is disabled, with a tooltip explaining why, unless the viewer holds
the vehicle (`canEditStatus()`, `:1262`). The same component serves paint
orders through a different `spec` (labels, route, what to do after saving).

`choose(next)` (`:659`) saves:

- **one change at a time** per row (`wrap.dataset.saving`), because two PATCHes
  in flight could land in the opposite order to their commits;
- on success, update the label, the menu's selected option and the in-memory
  row; if a status filter is active and the row no longer matches, reload; if
  the new status released the vehicle, rebuild the row;
- on `401`, show the login with «Tu sesión venció…»; on other errors, show the
  server's message and leave the pill as it was.

### «Ocupado»: taking and releasing vehicles

`buildOccupiedCell()` (`:1009`) shows, for up to two holders:

- the viewer's own hold as a pill with their name that reveals «Liberar» on
  hover or focus. Because the column is last and may be cut off by the table's
  scroll, `revealRelease()` (`:964`) scrolls the table to its right edge first;
- other holders' names as plain text;
- a join button while there is room and the viewer is not a holder:
  «Disponible» on a free vehicle, «Acompañar» when one person already holds it.
  With two holders there is no button (the server would answer `409`).

In look-only mode the cell is text only.

`setOccupied(request, occupied)` (`:1104`) PATCHes
`/api/staff/requests/:id/occupancy`, then stores the returned `holders` and
rebuilds the row (taking a car also makes its status editable). On any error it
reloads the list, because occupancy changed underneath.

### «Piezas»: the 3D parts viewer

`buildPartsCell()` (`:731`) shows the panel count. When the row has a
silhouette and panels, the count is a button that opens a dialog:
`openPartsView()` (`:777`) fills the subtitle with plate and model, lists the
panel names, and mounts the 3D viewer **read-only and spinning**
(`interactive: false, spin: true`, no view buttons). See
[3d-viewer.md](3d-viewer.md).

- `partsViewMountId` is bumped on every open and close, so an `import()` that
  resolves after the dialog closed builds nothing.
- The module is loaded through `loadCar3d()` (`:197`), shared with the intake
  form. A failed download drops the cached promise (`forgetCar3d()`) so the
  next attempt uses a fresh URL. A module that downloaded but failed to build
  keeps the cache.
- Close with ✕, Escape or a click on the backdrop. Focus returns to the
  button, and Tab is trapped inside while open.

## Paint orders tab

The second table, behind the «Vehículos / Matizado» switch
(`setPanelTab()`, `:1581`), which reloads orders on every visit because orders
arrive from the website on their own. The tab shows the count and «N nuevos»
(orders still `recibido`).

Columns: Código (boss), Taller / contacto (notes as a tooltip), Teléfono,
Color, Acabado, Envase, Precio ref., Ingreso (date and time), Estado.

`buildColourCell()` (`:1446`):

- an undefined `in_person` order shows «Lectura en el taller» with a pending
  swatch;
- otherwise the swatch (hatched if unknown), name, code and brand;
- a «Confirmar» tag on `method: model` orders (picked without the label);
- a «Medido» tag on defined `in_person` orders;
- for the boss on `in_person` orders, a «Definir» or «Editar» button.

The status pill is editable by workers, not by the boss and not in look-only
mode (`canEditPaintStatus()`). Nobody "holds" a paint order.

### The boss's definition form

`openPaintDefine(order)` (`:1701`) opens a dialog with brand (with a
`<datalist>` of known brands), code, name, finish, an optional swatch colour,
size, units and price. The price follows the list price
(`listPrice()` = size price × finish factor × units) **until the boss types
his own**, after which it stays his (`definePriceTouched`). The hint always
shows the list price.

Submitting validates locally (`defineProblem()`), PUTs
`/api/staff/paint-orders/:id/definition`, copies the answer into the in-memory
order, and rebuilds the row.

## The boss's monitor

`loadWorkers()` (`:2463`) GETs `/api/staff/workers` and `renderWorkers()`
draws one card per worker (`monitorCard()`, `:2160`): name, code, number of
vehicles, each vehicle (plate, model, code, status badge), and the boss's note.
Idle workers' cards are dimmed. The header says «N de M con vehículo» or
«Nadie tiene un vehículo ahora mismo».

It is fetched separately rather than derived from the table, because the table
may be filtered or capped and a missing vehicle would make its worker look
free. It refreshes every 30 seconds while visible, and on «Actualizar».

### Notes to workers

Each card has a «⋯» menu (`buildNoteMenu()`, `:2251`) with «Escribir nota» /
«Editar nota» and, when there is one, «Quitar nota». It reuses the status
menu's open/close/keyboard machinery.

`openNoteEditor()` (`:2332`) adds a textarea (max 500) to the card. Only one
editor can be open on the board. While it is open, `holdMonitorRefresh()`
stops the 30-second refresh and disables «Actualizar», because a refresh
would rebuild the list and erase what is being typed.

`putNote(worker, text, card, save)` (`:2394`) PUTs the note (empty text
deletes it), then closes the editor and reloads the board, so what is shown is
what the server stored.

## Registering a walk-in

The boss's «Registrar vehículo» form for a car that arrives at the counter.
The server stores it in `requests` like any other, with fewer required fields
(`WALK_IN_REQUIRED`). Nothing can be edited afterwards, so everything except
the notes is required.

- **Customer**: first and last name, email, phone.
- **Silhouette**: four radio buttons (Sedán / Familiar, SUV, Pickup,
  Furgoneta). `buildChoices()` (`:2536`) builds radio-like button groups.
- **Finish**: the three quality tiers.
- **Vehicle**: make and model selects from `CAR_CATALOG`. Choosing a model
  sets the silhouette from its body type (`syncVehicleToModel()`, `:2624`); the
  boss can still override it.
- **Plate**: formatted as `ABC-123` while typing.
- **Panels**: the 3D picker (`mountIntake3d()`, `:2814`), the same viewer as
  the wizard, remounted when the silhouette changes. Changing silhouette clears
  the chosen panels, since ids differ between models.
- **Quote** (`renderIntakeQuote()`, `:2717`): the total for **each** finish
  side by side, discount included, the chosen one marked, and tapping another
  selects it. At the counter the boss needs a number to say out loud, and the
  customer's "and the cheaper one?" is already answered.
- **Notes**: optional.

`firstIntakeProblem()` (`:2937`) checks fields in reading order and focuses the
first problem. Submitting POSTs `/api/staff/requests`. The success screen shows
the name and the code, and says whether the email was queued (`mailQueued`):
if not, «dale el código en persona». «Registrar otro» resets the form.

## Other details

- **Clock** (`paintClock()`, `:307`): `hh:mm:ss AM/PM`, built by hand because
  `es-PE` formats it as «p. m.».
- **Dates** use `toLocaleDateString("es-PE")`.
- **Errors** appear in one banner (`setError()`). Network failures say to check
  the server is on.
- A `401` from any call brings back the login with «Tu sesión venció», since a
  deploy or restart empties the in-memory sessions.
