# Architecture

## What the product is

Autocolor is the website of a body shop in Ayacucho, Peru. The shop does two
kinds of business, and the site has a form for each:

1. **Repainting vehicles.** A customer describes their car, picks a finish
   tier, taps the panels to paint on a 3D model, and leaves their contact
   details. The shop calls back with a firm quote. This is the **quote
   wizard** (`pgs/repair.html`). Its rows live in the `requests` table.
2. **Selling mixed paint ("matizado").** Another body shop or a dealership
   identifies a factory colour (by the code on the car's label, or by browsing
   make, model and year), picks a tin size, and orders it mixed. Or it books a
   visit to have the colour measured with a spectrophotometer. This is the
   **matizado page** (`pgs/paintings.html`). Its rows live in the
   `paint_orders` table.

Behind both is the **workshop panel** (`pgs/taller.html`), where staff log in
with a shared password and their own worker code. Workers take vehicles and
move them through the shop's stages. The boss sees who holds what, leaves
notes for workers, registers cars that arrive at the counter, and prices the
paint orders that were measured in person.

Customers can check their request's progress with their tracking code on the
wizard page (the «Consulta tu solicitud» form).

## The moving parts

```
                         Browser
  ┌──────────────────────────────────────────────────────────────┐
  │ index.html        pgs/repair.html     pgs/paintings.html     │
  │ src/home.js       src/repair.js       src/paintings.js       │
  │                   src/lookup.js       src/paints.js          │
  │                   src/carVisual.js ◄──┐ src/colourIndex.js    │
  │                   (three.js, lazy)    │ src/paintCatalog.js   │
  │                                       │                      │
  │ pgs/taller.html   src/staff.js ───────┘                      │
  │ shared: src/config.js src/parts.js src/statuses.js            │
  │         src/carModels.js src/cities.js styles.css             │
  └──────────────┬───────────────────────────────────────────────┘
                 │ HTTP (same origin)
  ┌──────────────▼───────────────────────────────────────────────┐
  │ server/server.js  (one Node process, no framework)           │
  │   static files (allowlist, ETag, brotli/gzip)                │
  │   /api/requests, /api/paint-orders     public forms          │
  │   /api/colours/*                       colour finder         │
  │   /api/staff/*                         workshop panel        │
  │   /healthz                             Render health check   │
  │                                                              │
  │ server/db.js ──────► Postgres "autocolor"  (requests,        │
  │                       local :5434 or Neon   paint_orders,    │
  │                                             worker_notes)    │
  │ server/colordb.js ─► Postgres "colordb"    (read-only,       │
  │                       Neon, role colordb_app, functions only)│
  │ server/auth.js       in-memory sessions                      │
  │ server/mail.js ────► Brevo HTTPS API  (in-memory outbox)     │
  └──────────────────────────────────────────────────────────────┘
```

Everything runs in **one process**. `render.yaml` explains why the site and
the API are not split: the panel's session cookie is `SameSite=Strict` and the
server sends no `Access-Control-Allow-Credentials`, so a panel served from a
different origin than its API would get `401` forever.

## How a quote request travels

This is the main flow. The other forms follow the same shape.

1. The customer opens `/pgs/repair.html`. `serveStatic()`
   (`server/server.js:866`) resolves the path, checks it against the
   allowlist in `isPublic()` (`server/server.js:106`), and returns the file
   with a content-hash `ETag` and `Cache-Control: no-cache`, compressed with
   brotli or gzip if the browser accepts it.
2. The page loads its scripts with `defer`: `config.js`, `cities.js`,
   `carModels.js`, `statuses.js`, `parts.js`, then `repair.js` and
   `lookup.js`. The data files attach globals on `window`
   (`CAR_CATALOG`, `PERU_DEPARTMENTS`, `AUTOCOLOR_PARTS`, and so on), and
   `repair.js` reads them.
3. On step 3, `repair.js` calls `import("../src/carVisual.js")`. That module
   imports three.js through the page's import map (`vendor/three@0.169.0/`),
   then downloads the vehicle's GLB model.
4. On «Enviar solicitud», `submitRequest()` (`src/repair.js:591`) POSTs JSON
   to `/api/requests`.
5. `handleApi()` (`server/server.js:1610`) checks, in order: the
   `Content-Type` is JSON (else `415`), the `Origin` is this site (else
   `403`), and the per-IP limit of 10 a minute (else `429`). Then
   `validateRequest(body, WIZARD_REQUIRED)` turns the body into a clean row
   or throws a `400` with a Spanish message.
6. `createRequest()` (`server/db.js:171`) draws a random 10-digit id and
   inserts the row. A clash on the primary key (very rare) draws again, up to
   five times.
7. The server answers `201 { id, status, createdAt }` **before** any email is
   attempted.
8. `mail.notifyNewRequest()` (`server/mail.js:819`) builds two messages (one
   to the customer with the code, one to the shop with the details), puts
   them in an in-memory queue and returns. The queue sends them one at a time
   over HTTPS to Brevo, and retries transient failures for about 48 minutes.
9. The browser shows the code. The customer can later type it into the lookup
   form, which calls `GET /api/requests/:id`. That route returns only the
   vehicle, first name, last name and status, never the phone or email.
10. In the panel, a worker takes the vehicle (`PATCH …/occupancy`) and moves
    its status (`PATCH /api/staff/requests/:id`). The lookup form shows the
    new status from then on.

## Design rules the code follows

These rules show up in every file. Knowing them makes the code much easier to
read.

**The server decides, the browser only reflects.** Every rule that matters
(who may change a status, how many people can hold a vehicle, which fields are
required) is enforced on the server, and the hardest ones in the database
itself through `CHECK` constraints and single-statement SQL. The browser
repeats some checks only to save a round trip and to explain what is missing.

**Fail closed and fail visibly.** The static server uses an allowlist, not a
denylist. With no staff password configured, the panel answers `503` instead
of opening. A mail failure is logged, and the startup log says whether mail
works. A missing colour database switches only the finder off, and the log
says so.

**Nothing secondary can take down something primary.** An email failure can
never lose a request (the row is stored and answered first). A colour database
outage makes the page fall back to a local catalogue of 777 colours. A 3D
viewer that fails to load leaves a plain checklist of panels to pick from. A
missing data script degrades to raw ids instead of throwing.

**One copy of each shared list, where that is possible.** `src/parts.js` and
`src/paints.js` load both in the browser (as a `window` global) and in Node
(through `module.exports`), so the emails name panels and tins exactly the way
the pages do. Where a copy cannot be avoided (the status list lives in
`src/statuses.js`, `STATUSES` in `server/server.js` and the `CHECK` in
`server/schema.sql`), the comments next to each copy name the others.

**No build step and one dependency.** Browser code is ES5-style IIFEs that
attach to `window`, except `src/carVisual.js`, which is an ES module because
three.js is. three.js is vendored under `vendor/` rather than loaded from a
CDN. The only npm dependency is `pg`. Email uses the built-in `fetch`.

**Tracking codes are credentials.** They are random (`crypto.randomInt`), not
sequential, so neighbouring numbers reveal nothing. Lookups by code return no
contact details. Lookups are rate-limited per IP.

## Languages

The site's customers and staff read Spanish, so every string a visitor sees
(HTML copy, API error messages, email bodies) is in Spanish. The project's
working language is English: identifiers, new comments, commit messages,
documentation and new log lines are in English. Many older comments and log
lines in `server/` and `src/` are still in Spanish. They predate the rule, and
they are not the style to copy.

## Directory map

| Path | What it is | Guide |
| --- | --- | --- |
| `index.html`, `src/home.js` | Home page | [home-page.md](home-page.md) |
| `pgs/repair.html`, `src/repair.js`, `src/lookup.js` | Quote wizard and code lookup | [quote-wizard.md](quote-wizard.md) |
| `pgs/paintings.html`, `src/paintings.js` | Matizado sales page | [matizado.md](matizado.md) |
| `pgs/taller.html`, `src/staff.js` | Workshop panel | [workshop-panel.md](workshop-panel.md) |
| `src/carVisual.js` | 3D panel picker (ES module) | [3d-viewer.md](3d-viewer.md) |
| `src/parts.js` | Panel names, per-vehicle panel lists, prices, discounts | [quote-wizard.md](quote-wizard.md#srcpartsjs) |
| `src/paints.js` | Finishes, tin sizes, prices, local colour lookup, CIELAB maths | [matizado.md](matizado.md#srcpaintsjs) |
| `src/paintCatalog.js` | Generated: 777 measured colours from 10 brands | [matizado.md](matizado.md#the-two-colour-sources) |
| `src/colourIndex.js` | Generated: the colour database's 13 makes and 1,441 models | [colour-database.md](colour-database.md#build-indexjs) |
| `src/carModels.js` | The wizard's makes, models and body types | [quote-wizard.md](quote-wizard.md#srccarmodelsjs) |
| `src/statuses.js` | Status order and labels for requests and paint orders | [quote-wizard.md](quote-wizard.md#srcstatusesjs) |
| `src/cities.js` | Peru's departments and provinces | [quote-wizard.md](quote-wizard.md#srccitiesjs) |
| `src/config.js` | API origin and the optional photo service key | [configuration.md](configuration.md#browser-configuration) |
| `styles.css` | Every style on the site | [home-page.md](home-page.md#stylescss) |
| `server/server.js` | HTTP server, routing, validation | [server.md](server.md) |
| `server/db.js`, `server/schema.sql`, `server/migrate.js` | The `autocolor` database | [database.md](database.md) |
| `server/auth.js`, `server/names.js` | Panel login, worker roster, sessions | [workshop-auth.md](workshop-auth.md) |
| `server/mail.js`, `server/mailhtml.js`, `server/netcheck.js` | Email notices | [email.md](email.md) |
| `server/colordb.js`, `server/colordb/` | The colour database | [colour-database.md](colour-database.md) |
| `server/env.js` | Loads `.env` into `process.env` | [configuration.md](configuration.md#serverenvjs) |
| `server/pgserver.sh` | Local Postgres on port 5434 | [operations.md](operations.md#local-postgres) |
| `render.yaml`, `.nvmrc` | Deployment | [operations.md](operations.md#deploying) |
| `tools/` | Model, logo, catalogue and email tools | [operations.md](operations.md#tools) |
| `vendor/three@0.169.0/` | Self-hosted three.js (four files) | [3d-viewer.md](3d-viewer.md) |
| `imgs/` | Brand assets, car photos, GLB models, shop photos | [home-page.md](home-page.md#images) |
| `design/` | Design canvases (`*.dc.html`), not served | none |
