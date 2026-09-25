# The HTTP server (`server/server.js`)

One file, no framework. It serves the static site, the public API, the colour
finder API and the staff API, all from `http.createServer`. This guide walks
through it top to bottom.

## Contents

- [Module setup](#module-setup)
- [The request pipeline](#the-request-pipeline)
- [Static files](#static-files)
- [Validation helpers](#validation-helpers)
- [Validating a quote request](#validating-a-quote-request)
- [Validating a paint order](#validating-a-paint-order)
- [Client IP addresses](#client-ip-addresses)
- [Rate limits and daily budgets](#rate-limits-and-daily-budgets)
- [Origin checks and CORS](#origin-checks-and-cors)
- [Reading JSON bodies](#reading-json-bodies)
- [Public routes](#public-routes)
- [Colour routes](#colour-routes)
- [Staff routes](#staff-routes)
- [Errors](#errors)
- [Startup](#startup)
- [Shutdown and process-level handlers](#shutdown-and-process-level-handlers)
- [Complete route table](#complete-route-table)

## Module setup

`server/server.js:37` requires `./env` first, so `.env` is in `process.env`
before any constant below reads it. Then it loads Node built-ins, promisifies
`zlib.brotliCompress` and `zlib.gzip` (`:48-49`), and requires the local
modules: `db`, `auth`, `colordb`, `names`, `mail`, `netcheck`, and
`../src/paints.js` (the same file the matizado page loads, used here for
swatch colours).

Constants worth knowing:

| Constant | Line | Value | Why |
| --- | --- | --- | --- |
| `HOST` | 69 | `127.0.0.1` | Loopback unless told otherwise, so the panel is not on the shop's LAN by accident. |
| `TRUST_PROXY` | 76 | `0` | How many proxies to trust in `X-Forwarded-For`. |
| `ROOT` | 78 | repo root | Base for static files. |
| `MAX_BODY_BYTES` | 79 | 32 KiB | Largest JSON body accepted. |

## The request pipeline

`http.createServer` at `server/server.js:1701`:

```js
let pathname;
try {
    pathname = new URL(req.url, 'http://localhost').pathname;
} catch {
    sendJson(res, 400, { error: 'La dirección no es válida.' });
    return;
}
```

A fixed base (`http://localhost`) is used instead of the `Host` header, and
the parse is in its own `try`: a request line like `GET //` or a bad `Host`
makes `new URL` throw, and a throw outside any `try` would leave the
connection open with no response.

Then, inside the main `try` (`:1713`):

1. `/healthz` answers `200 { ok: true }` immediately. It never touches the
   database: Render restarts the service when this fails, and a database that
   is waking up should not cause a restart (which would also drop every
   in-memory panel session).
2. Anything under `/api/` goes to `handleApi()`.
3. `GET` and `HEAD` go to `serveStatic()`.
4. Anything else is `405`.

The `catch` (`:1736`) is described under [Errors](#errors).

## Static files

### What is public

`PUBLIC_FILES` and `PUBLIC_DIRS` (`:94-95`) are an **allowlist**:

```js
const PUBLIC_FILES = new Set(['/index.html', '/styles.css']);
const PUBLIC_DIRS = ['/pgs/', '/src/', '/imgs/', '/vendor/'];
```

`ROOT` also holds `.env`, `.git/`, `server/`, the docs and, on the work
machine, large Blender sources. A denylist would have to name every one of
those and would silently serve anything it forgot. With an allowlist, a new
file at the root is private until someone adds it.

`isPublic(pathname)` (`:106`) decides, working on the lower-cased path
because the work machine's filesystem (APFS) is case-insensitive, so
`/SERVER/auth.js` would otherwise open `server/auth.js`:

```js
const lower = pathname.toLowerCase();
if (!MIME[path.posix.extname(lower)]) return false;          // known extension only
const segments = lower.split('/');
if (segments.some((segment) => segment.startsWith('.'))) return false;  // no dotfiles
if (lower.startsWith('/imgs/') && segments.includes('src')) return false; // raw GLB sources
return PUBLIC_FILES.has(lower) || PUBLIC_DIRS.some((dir) => lower.startsWith(dir));
```

### Serving a file

`serveStatic(req, res, pathname)` (`:866`), step by step:

1. **Decode** the path with `decodeURIComponent`. A stray `%` throws
   `URIError`; that becomes a `400` rather than a `500`.
2. **Resolve** it: `path.join(ROOT, decoded === '/' ? 'index.html' : decoded)`.
   `path.join` normalises `..`, so the next line checks the result is still
   inside `ROOT` (`filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)`
   → `403`).
3. **Allowlist** the **resolved** path, not the raw one: `/pgs/../.env` starts
   with `/pgs/` but resolves to `/.env`. `repoPath()` (`:99`) turns the
   absolute path back into `/relative/with/slashes`. A non-public path gets
   `404`, not `403`, so probing does not confirm a file exists.
4. **Stat** the file. Missing → `404`. Directory → `403`.
5. **Cache headers**: `Cache-Control: no-cache` for everything, plus a strong
   `ETag`. `no-cache` means "revalidate every time", not "do not store". The
   files have no version in their names and depend on each other (panel ids in
   `carVisual.js` are node names inside the GLBs; the hero mask must match its
   photo pixel for pixel), so a stale one must never be used. The ETag makes
   revalidation a cheap `304`.
6. **ETag** comes from `fileInfo()` (`:815`): the SHA-1 of the file content,
   base64url-encoded. Content and not mtime, because every deploy is a fresh
   checkout with new mtimes, and an mtime ETag would make every visitor
   re-download the 10 MB models after each deploy.
7. **Conditional request**: if any tag in `If-None-Match` (weak prefix `W/`
   ignored) equals the ETag, answer `304` with the headers and no body.
8. **Non-compressible files** (images, fonts) are streamed from disk with
   `fs.createReadStream(...).pipe(res)`. Only their hash is cached.
9. **Compressible files** (`COMPRESSIBLE`, `:802`: html, css, js, mjs, json,
   svg, glb, md) are kept in memory. `pickEncoding()` (`:850`) chooses `br`,
   then `gzip`, from `Accept-Encoding`. `compressed()` (`:834`) compresses once
   per file version and encoding and caches the promise. Brotli quality is 5
   above 1 MiB (0.3 s on the 12.6 MB pickup, within 1 % of quality 9, which
   takes 5.7 s) and 9 below it.
10. **`X-File-Size`** carries the uncompressed length. three.js's `FileLoader`
    reads it for progress events; with only the compressed `Content-Length`,
    the 3D progress bar reached 100 % with a quarter of the model still
    arriving.
11. `HEAD` gets the same headers and no body.

### The file cache

`fileCache` (`:809`) maps keys to **promises**, so two simultaneous requests
for the same file share one read and one compression. Keys are
`path:size:mtimeMs` (`cacheKey()`, `:811`) and `…:br` / `…:gzip` for
compressed bodies. A failed read deletes its own entry (`entry.catch(() =>
fileCache.delete(key))`). `pruneFileCache()` (`:860`) drops entries for older
versions of the same path, so editing `styles.css` all day does not keep every
version in memory. In production that means roughly 40 MB of raw files plus
30 MB compressed, nearly all of it the four 3D models.

## Validation helpers

The browser validates too, but anyone can call the API directly, so the server
checks everything again. The helpers throw `BadRequest` (a `400`) with a
Spanish message that the page shows as is.

### Gendered messages

Spanish adjectives agree with the noun. `INVALID` and `TOO_LONG` (`:183-184`)
have masculine, feminine and feminine-plural forms, chosen by the `agree`
option (`'m'` default, `'f'`, `'fp'`). Without this the customer read «La placa
no es válido».

### `text(value, { max, required, field, agree })` (`:186`)

```js
if (value === undefined || value === null || value === '') {
    if (required) throw new BadRequest(`Falta ${field}.`);   // "Missing the plate."
    return null;
}
if (typeof value !== 'string') throw new BadRequest(`${capitalize(field)} ${INVALID[agree]}.`);
const trimmed = value.trim();
if (required && trimmed === '') throw new BadRequest(`Falta ${field}.`);
if (trimmed.length > max) throw new BadRequest(`${capitalize(field)} ${TOO_LONG[agree]}.`);
return trimmed === '' ? null : trimmed;
```

Empty or whitespace-only becomes `null`, never `''`, so the database only
holds real values or `NULL`. Inner whitespace (including newlines) is kept;
`mail.js` flattens it where needed.

### `integer(value, { min, max, required, field, agree })` (`:201`)

Form numbers arrive as strings (`'2020'`, `''`). It accepts a number or a
string, converts with `Number(String(value).trim())`, and requires
`Number.isInteger` and the range. `'12abc'` becomes `NaN` and fails.

### `yearMax()` (`:147`)

`new Date().getFullYear() + 1`, computed **per request**. The form computes
its own maximum when the page opens; a module-level constant in a process that
lived across New Year would reject a year the form had just accepted.

## Validating a quote request

`validateRequest(body, required)` (`:254`) serves both the public wizard and
the boss's walk-in form. The rules are shared; only the set of required fields
differs:

- `WIZARD_REQUIRED` (`:215`): vehicle, bodyType, plate, quality, parts, phone,
  email, brand, model, year, firstName, lastName, department, province.
- `WALK_IN_REQUIRED` (`:239`): vehicle, quality, phone, email, firstName,
  lastName, brand, model, plate, parts. No year, department, province or body
  type: the customer is at the counter.

Field by field:

| Field | Rule |
| --- | --- |
| `vehicle` | Always required: one of `van`, `wagon`, `pickup`, `suv`. |
| `bodyType` | If required or present: one of the eight `BODY_TYPES`. |
| `plate` | `text` max 7, then upper-cased and matched against `^[A-Z0-9]{3}-[A-Z0-9]{3}$`. Stored upper-case. |
| `quality` | Always required: `standard`, `premium` or `custom`. |
| `parts` | Must be an array (or missing, treated as `[]`). Non-empty if required. At most 40. Each id must match `^[A-Za-z0-9_]{1,40}$`. Duplicates removed with `[...new Set(parts)]`. |
| `phone` | `text` max 20, must match `^\+51[0-9]{9}$`. |
| `email` | `text` max 254, simple `local@domain.tld` regex. |
| `brand`, `model` | `text`, max 40 and 60. Not checked against a catalogue: the catalogue lives in the browser. |
| `year` | `integer` 1980 to `yearMax()`. |
| `mileage` | `integer` 0 to 2,000,000, optional. |
| `colorCode` | `text` max 20, optional. |
| `firstName`, `lastName`, `department`, `province` | `text` max 80. |
| `notes` | `text` max 2000, optional. |

Panel ids are validated by **shape**, not against a list, because they are
node names inside each GLB, and adding a model should not require a server
change.

## Validating a paint order

`validatePaintOrder(body)` (`:417`). The rule that is not obvious: an
`in_person` order has **no colour and no tin**, because the colour is going to
be measured at the shop.

```js
const inPerson = body.method === 'in_person';
const colorCode = text(body.colorCode, { max: 20, required: !inPerson, ... });
```

- `method` must be one of `code`, `model`, `reading`, `in_person`.
- `colorCode`, `colorName`, `brand` are required unless `in_person`.
- `swCode` (the Sherwin-Williams id from the colour database) is optional,
  max 12, shape `^[0-9A-Za-z-]{1,12}$`.
- `finish` is required unless `in_person`; if present it must be one of the
  four finishes.
- `reading` (CIELAB): if an object is sent, all three of `L` (0–100), `a` and
  `b` (−128–128) must be present, rounded to two decimals by `labValue()`
  (`:356`). Two of three is refused, since it describes no colour.
- `size` is required unless `in_person`, and **refused** if `in_person`
  sends one. `units` (1–20) and `price` (0–100,000) are `null` for
  `in_person`.
- `phone` is required; `email` is optional (the shop can send the code by
  WhatsApp); `company` is required (max 120).
- `ruc`, `department`, `province` are always stored as `null`; the form no
  longer asks for them and the columns stay for old rows.

The `price` is what the page showed. The server stores it as sent (see the
[review](review-2026-09-25.md) about this).

### Confirming the colour: `confirmColour(data)` (`:1584`)

Before storing an order that carries a `swCode`, the server asks the colour
database for that colour again:

- If the database is off, or the lookup throws, the order goes through
  unchanged. Losing a sale over a secondary lookup would be worse.
- If the `swCode` does not exist, it is dropped (`data.swCode = null`) with a
  warning.
- If the name differs from the database's, the database's name wins. The email
  and the shop's table are read as if they were the database.
- `colorCode` (the factory code the customer read off the label) and `finish`
  (which set the price) are **not** touched.
- `data.hex` is set from the database row, so the email can paint a swatch.

### The boss's definition: `validatePaintDefinition(body)` (`:374`)

For `PUT /api/staff/paint-orders/:id/definition`. Brand, code, name, finish,
size, units and price are all required; `hex` is optional and normalised to
`#rrggbb` lower-case by `normalizeHex()` (`:350`).

### Swatches in listings: `paintHex(order)` (`:403`)

The panel's paint table needs a swatch per row. It uses the stored `hex` if
there is one. Otherwise it looks the brand name up in `paints.BRAND_NAMES`,
then the code in the local catalogue with `paints.findColour()`. If neither
knows the colour it returns `''` and the panel draws a hatched "unknown"
swatch.

## Client IP addresses

Three per-IP limits and the failed-login log need the client's address.
`clientIp(req)` (`:568`):

```js
const socketIp = req.socket.remoteAddress || 'desconocida';
if (TRUST_PROXY <= 0) return socketIp;
```

With no proxy the socket address is the client. Behind proxies it is the
proxy's, the same for everyone, so the header must be read.

```js
const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',').map(bareIp).filter(Boolean);
```

`bareIp()` (`:519`) strips ports: `[2001:db8::1]:443` → `2001:db8::1`, and
`203.0.113.7:53411` → `203.0.113.7`. A string with more than one `:` and no
brackets is an IPv6 address and is left whole.

**Why read from the right.** Each proxy *appends* the address of whoever
connected to it. A client can put anything at the start of the header, but it
cannot change what our proxies append. With `n` trusted proxies, the last `n`
entries are theirs, and the client is the first of those:

```js
if (forwarded.length < TRUST_PROXY) { /* warn once */ return socketIp; }
const candidate = forwarded[forwarded.length - TRUST_PROXY];
if (net.isIP(candidate) === 0) return socketIp;
return candidate.startsWith('::ffff:') ? candidate.slice(7) : candidate;
```

On Render the header looks like `client, cloudflare, render-router`, and
`TRUST_PROXY=3` picks the client. The `net.isIP` check stops junk values
(RFC 7239 allows `unknown`) from becoming arbitrary keys in the rate-limit map.
IPv4-mapped IPv6 is folded to IPv4 so one client does not get two buckets.

If the chain is shorter than `TRUST_PROXY`, the request did not come through
the expected proxies (a health check, or someone reaching the container
directly), and the socket address is used. A one-time warning says the
topology may have changed. `GET /api/staff/whoami` shows what the server sees,
which is the only way to check this setting from outside.

### `rateKey(ip)` (`:608`)

IPv4 addresses are used as they are. IPv6 addresses are expanded (the `::`
is filled with zero groups) and cut to their first four groups, giving a
`/64` key such as `2001:db8:0:1::/64`. One IPv6 client usually controls a
whole `/64`, and could otherwise use a fresh address, and a fresh bucket, per
request.

## Rate limits and daily budgets

### The per-minute limiter

`rateLimit(key, limit)` (`:653`) is a fixed 60-second window per key, stored
in the `buckets` map:

```js
if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
}
bucket.count += 1;
return bucket.count <= limit;
```

A `setInterval` (`:665`, `unref`'d so it never keeps the process alive)
deletes expired buckets every minute.

| Key | Limit | Route |
| --- | --- | --- |
| `post:<ip>` | 10/min | `POST /api/requests` |
| `paint:<ip>` | 10/min | `POST /api/paint-orders` |
| `get:<ip>` | 30/min | `GET /api/requests/:id` |
| `login:<ip>` | 5 **failures**/min | `POST /api/staff/login` |
| `colour:list:<ip>` | 30/min | makes and models lists |
| `colour:browse:<ip>` | 20/min | `/api/colours/browse` |
| `colour:code:<ip>` | 20/min | `/api/colours/search` |
| `colour:one:<ip>` | 30/min | `/api/colours/:code` |

The login limit only counts failures: the handler reads the bucket first and
only calls `rateLimit()` after a wrong code or password, because a whole shift
logs in from one NAT address.

### The colour finder's daily budgets

A per-minute window stops bursts, not patience: 20 a minute is 28,800 a day.
The colour catalogue is the one thing worth copying, so `colourBudget(key)`
(`:685`) adds two 24-hour counters:

- a process-wide total (`AUTOCOLOR_COLORDB_DAILY_TOTAL`, default 60,000). Past
  it, the finder answers `503` and logs once;
- a per-IP count (`AUTOCOLOR_COLORDB_DAILY_IP`, default 2,000). Past it, `429`.

The total is counted before the per-IP check. See the
[review](review-2026-09-25.md) for what that allows.

## Origin checks and CORS

### `isOwnOrigin(req)` (`:628`)

Browsers send `Origin` on every POST, same-origin ones included. So:

- no `Origin` → not a browser → allowed (rate limits and mail caps handle
  scripts);
- an `Origin` in `ALLOWED_ORIGINS` → allowed;
- otherwise its host must equal one of: the `Host` header,
  `X-Forwarded-Host`, `RENDER_EXTERNAL_URL`'s host or `AUTOCOLOR_SITE_URL`'s
  host.

This stops any other website from making its visitors submit the form, each
from their own IP, and sending the shop's branded confirmation email to
addresses of its choosing.

The public POST routes also require `Content-Type: application/json`
(`:1626`). A cross-site HTML form can post a body that parses as JSON with
`enctype="text/plain"`, but it cannot set that content type without a CORS
preflight, which this server does not grant.

### `applyCors(req, res)` (`:974`)

Only for origins in `ALLOWED_ORIGINS`: it echoes the origin, sets
`Vary: Origin`, and allows `GET, POST, PATCH, OPTIONS` with `Content-Type`.
Every `OPTIONS` request is answered `204` so a preflight never hangs; with no
CORS headers the browser rejects it on its own.

## Reading JSON bodies

`readJsonBody(req)` (`:738`) buffers chunks up to 32 KiB. When a chunk pushes
the total over:

```js
req.off('data', onData);
req.pause();
reject(new BadRequest('El formulario es demasiado grande.'));
```

It stops listening and pauses instead of destroying the request, because
destroying tore the socket down before the `400` could be written, and the
browser saw a network error instead of the reason. An empty body parses as
`{}`. Bad JSON is a `400`.

`requireObject(body)` (`:773`) then rejects `null`, arrays and primitives:
`JSON.parse('3')` is valid JSON, and reading a property of it would otherwise
be a `500`.

## Public routes

All in `handleApi()` (`:1610`). `clientIp()` runs first, then `applyCors()`.

**`POST /api/requests`** (`:1622`): JSON content type → own origin → 10/min →
`validateRequest(…, WIZARD_REQUIRED)` → `createRequest()` → log → `201`
with `{ id, status, createdAt }` → `mail.notifyNewRequest(created, data)`.
The mail call comes **after** the response and is not awaited. It only queues
messages, and never throws.

**`POST /api/paint-orders`** (`:1652`): the same three gates, then
`validatePaintOrder()` → `confirmColour()` → `createPaintOrder()` → `201` →
`mail.notifyNewPaintOrder()`.

**`GET /api/requests/:id`** (`:1679`): the id must be exactly ten digits
(`LOOKUP_PATH`). 30/min per IP. `findRequest()` returns only
`{ id, brand, model, vehicle, firstName, lastName, status }`. Any other path
under `/api/requests/` gets the same `404` as a missing code, so the valid
shape is not revealed.

## Colour routes

`handleColours()` (`:1449`), for `/api/colours*`. All `GET`. In order:

1. Not `GET` → `405`.
2. A foreign `Origin` → `403`. (A same-origin `GET` sends no `Origin`, so
   the site's own requests pass. `curl` passes too; this only stops another
   page from reading the catalogue through a visitor's browser.)
3. Database off → `503`.
4. The daily budgets above → `503` or `429`.
5. The route's per-minute limit → `429`.

| Route | Query | Returns | Cache |
| --- | --- | --- | --- |
| `/api/colours/makes` | none | `{ items: [{ makeId, label, sortKey }] }` | `public, max-age=3600` |
| `/api/colours/makes/:id/models` | none | `{ items: [{ modelId, name }] }` | `public, max-age=3600` |
| `/api/colours/browse` | `make` (required), `model`, `year`, `from` (0–600) | `{ items, from, hasMore }`, 60 per page | `private, max-age=300` |
| `/api/colours/search` | `make` (required), `code` (2–10 alphanumerics after cleaning) | `{ items }`, up to 12 | `private, max-age=300` |
| `/api/colours/:swCode` | none | one colour | `private, max-age=300` |

`intParam()` (`:1440`) returns `null` when a parameter is absent, `undefined`
when it is malformed or out of range (`?make=12abc` is malformed, not make
12), and the number otherwise.

The colour responses are `private` on purpose. Cloudflare sits in front, and a
shared cache would let someone copy the catalogue without any of the counters
seeing the requests.

A `ColourDbUnavailable` error becomes `503`, which tells the page to fall back
to its local catalogue. Anything else is re-thrown and becomes a `500`.

## Staff routes

`handleStaff()` (`:1100`). The auth model is described in
[workshop-auth.md](workshop-auth.md); the gates are:

- `requireStaff(req)` (`:1034`): `503` if no password is configured, `401` if
  there is no live session.
- `requireBoss(req)` (`:1047`): `requireStaff` plus `403` unless the session
  is the boss's.
- `refuseBoss(req)` (`:1058`): `403` if the session **is** the boss's. The
  boss takes no vehicles and changes no statuses.

| Route | Gate | What it does |
| --- | --- | --- |
| `POST /api/staff/login` | none | See [workshop-auth.md](workshop-auth.md#logging-in). Sets the cookie. |
| `POST /api/staff/logout` | none | Deletes the session and clears the cookie. `204`. |
| `GET /api/staff/whoami` | staff | `{ clientIp, workerId, isBoss }`, plus socket address, `trustProxy`, forwarding headers and `mail.describe()` for the boss. |
| `GET /api/staff/requests?status=` | staff | `{ requests, viewer }`. Rows get `holders: [{ workerId, name }]` from `withHolders()` (`:1010`). `viewer` is `{ workerId, name, isBoss, note }`. |
| `POST /api/staff/requests` | boss | Walk-in: `validateRequest(…, WALK_IN_REQUIRED)`, insert, queue mail with `walkIn: true`, answer `201` with `mailQueued`. No rate limit (it is behind the password, and the boss may book three cars in a row). |
| `GET /api/staff/workers` | boss | The monitor: every roster worker with the vehicles they hold and the boss's note. Built from the roster plus `listOccupied()`, so idle workers show too, and codes no longer on the roster still show if they hold a car. Sorted busy-first, then by name (`localeCompare(…, 'es')`). |
| `PUT /api/staff/workers/:code/note` | boss | Text sets the note (max 500); empty text deletes it. The code must be on the roster, else `404`. |
| `GET /api/staff/paint-orders?status=` | staff | `{ orders }`, each with a swatch from `withPaintHex()`. |
| `PUT /api/staff/paint-orders/:id/definition` | boss | Defines an `in_person` order. `404` unknown, `409` if the order was not `in_person`. |
| `PATCH /api/staff/paint-orders/:id` | staff, not boss | Moves a paint order's status. Anyone on shift may. |
| `PATCH /api/staff/requests/:id` | staff, not boss | Moves a vehicle's status. Only one of its holders may: `403` names who holds it, or says to take it first. |
| `PATCH /api/staff/requests/:id/occupancy` | staff, not boss | `{ occupied: true }` takes or joins (`409` when two already hold it); `false` releases the caller's own hold (`403` if they do not hold it). |

The holder names in error messages come from `holderNames()` (`:1022`):
«Ana Bravo y Carlos Díaz», with the code when no name is configured.

## Errors

```js
class HttpError extends Error { constructor(status, message) { … } }
class BadRequest extends HttpError { constructor(message) { super(400, message); } }
```

The top-level `catch` (`:1736`):

1. `HttpError` → its status and message. These messages are written for the
   customer.
2. `db.unreachable(err)` (a connection-class failure; see
   [database.md](database.md#retries-and-unreachable)) → `503` «La base de
   datos no responde…», and says nothing was saved. Neon suspends when idle,
   and a first request that times out while it wakes is a wait, not a bug.
3. Anything else → logged with its stack, and a generic `500` «No pudimos
   procesar la solicitud». The client never sees internal details.

Every branch checks `res.headersSent` first, because the public POST routes
send their `201` before the mail call.

`sendJson(res, status, payload, cache)` (`:728`) always sets
`Content-Type`, `Content-Length` and `Cache-Control` (default `no-store`).

## Startup

`start()` (`:1770`):

1. `ping({ attempts: DATABASE_URL ? 4 : 1 })`. Against Neon, four tries with
   growing waits, because the ping runs **before** the port opens and a
   failure fails the deploy. Locally, one try: a local database that does not
   answer is off. On failure it prints a specific message (and unwraps Node's
   `AggregateError`, whose own message is empty) and exits.
2. A `server.on('error')` handler turns `EADDRINUSE` into a readable message
   with the `lsof` and `kill` commands to fix it.
3. On Render (`process.env.RENDER`), two warnings: `HOST` on loopback (Render
   only sees ports bound to `0.0.0.0`), and `TRUST_PROXY` unset.
4. `server.listen(PORT, HOST)`, then in the callback:
   - the URL, and «Desplegado: branch @ sha» on Render;
   - the database description, without the password (`db.describe()`);
   - whether the panel is on, or which variable is missing;
   - the colour database: pinged in the background (three tries), then its
     stats, or a clear «NO RESPONDE» line. It never blocks startup;
   - mail: `mail.verify()` in the background. On failure it prints the reason
     and runs `netcheck.run()` to show which hosts are reachable (see
     [email.md](email.md#netcheckjs));
   - `ALLOWED_ORIGINS`, if any.

## Shutdown and process-level handlers

```js
process.on('unhandledRejection', (reason) => { console.error(…); });
```

Since Node 15 an unhandled rejection ends the process. Here that would take
the site and every panel session down over something secondary, so it is
logged instead.

On `SIGINT` and `SIGTERM` (`:1938`):

```js
server.close(() => {
    mail.close();
    pool.end().then(() => process.exit(0));
});
```

The order matters: stop accepting and let in-flight requests finish, **then**
drop the mail queue (which logs any unsent notices by name) and close the
database pool. The reverse order used to cut off notices that were being sent.

## Complete route table

| Method | Path | Handler |
| --- | --- | --- |
| GET | `/healthz` | inline |
| GET, HEAD | any public file | `serveStatic` |
| OPTIONS | `/api/*` | `applyCors` |
| POST | `/api/requests` | `handleApi` |
| GET | `/api/requests/:id` | `handleApi` |
| POST | `/api/paint-orders` | `handleApi` |
| GET | `/api/colours/makes` | `handleColours` |
| GET | `/api/colours/makes/:id/models` | `handleColours` |
| GET | `/api/colours/browse` | `handleColours` |
| GET | `/api/colours/search` | `handleColours` |
| GET | `/api/colours/:swCode` | `handleColours` |
| POST | `/api/staff/login` | `handleStaff` |
| POST | `/api/staff/logout` | `handleStaff` |
| GET | `/api/staff/whoami` | `handleStaff` |
| GET | `/api/staff/requests` | `handleStaff` |
| POST | `/api/staff/requests` | `handleStaff` |
| PATCH | `/api/staff/requests/:id` | `handleStaff` |
| PATCH | `/api/staff/requests/:id/occupancy` | `handleStaff` |
| GET | `/api/staff/workers` | `handleStaff` |
| PUT | `/api/staff/workers/:code/note` | `handleStaff` |
| GET | `/api/staff/paint-orders` | `handleStaff` |
| PATCH | `/api/staff/paint-orders/:id` | `handleStaff` |
| PUT | `/api/staff/paint-orders/:id/definition` | `handleStaff` |

The header comment at the top of `server/server.js` lists only part of this
table; this one is complete.
