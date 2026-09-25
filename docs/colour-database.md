# The colour database

The matizado page identifies factory colours with a subset of the
Sherwin-Williams Collision Core catalogue, extracted from the shop's own
mixing software. It lives in a **separate, read-only Postgres database** on
Neon (`colordb`), reached only through six SQL functions by a role that cannot
read any table.

This guide covers the runtime side (`server/colordb.js` and the routes that use
it) and the build side (`server/colordb/`). The folder's own
`server/colordb/README.md` has the data history in more depth (why each brand
and paint system is kept, the licence).

## What is published and what is not

The full extract has about 95,000 colours, 1.47 million vehicle→colour links
and 257,000 tinting formulas. **Only the vehicle→colour lookup leaves the work
machine.** The formulas are the valuable part and the part a competitor would
want, so they never exist on an internet-facing host.

Published tables (schema `colour` on Neon), per `server/colordb/README.md`:

| Table | Rows | Content |
| --- | ---: | --- |
| `vehicle_colour` | 232,306 | make / model / year range + factory code → colour |
| `colour` | 28,562 | colour code → names, finish, family, hex |
| `model` | 1,441 | models of the 13 brands |
| `make` | 27 | source make names, grouped into 13 brands |
| `meta` | 1 | build date and counts, so `api.stats()` never runs `count(*)` |

The 13 brands are the ones the shop sells: Toyota, Chevrolet, Ford, Nissan,
BMW, Audi, Mercedes-Benz, Subaru, Jeep, Fiat, Volkswagen, Kia and Mitsubishi.
The source has 383 make names; everything else (Lada, Pantone, fleet books…)
is left out by an allowlist in `sql/10_makes.sql`.

> Several comments and the main README still say "383 makes" and "68,717
> colours / 693,636 associations". Those numbers are from before the 13-brand
> subset. The table above is current.

## Security model

The catalogue is licensed data with no personal information. The goal is to
make **copying it wholesale** expensive and visible. Four layers, each weak
alone:

1. **No table access.** Tables live in schema `colour`, functions in schema
   `api`. Role `colordb_app` has `USAGE` on `api` and `EXECUTE` on six
   functions, and nothing on `colour`. It cannot name a table, so there is no
   query it can write and no `LIMIT` it can leave out.
2. **Limits inside the functions.** Each function is `SECURITY DEFINER`
   (runs as the table owner), has a pinned `search_path` and a 4 s
   `statement_timeout`, and caps its own output: 61 rows per page, offset
   clamped to 600, 12 rows per code search, no "all colours" query, and
   exact-match code search only (no `LIKE`, no prefix, which would make
   enumeration cheap).
3. **Role settings.** `default_transaction_read_only = on` (refuses writes even
   inside a definer function), empty `search_path`, 5 s statement timeout,
   10 s idle-in-transaction timeout, 2 s lock timeout, `CONNECTION LIMIT 8`.
   The grants script fails if the role has superuser, replication, bypass-RLS,
   create-db or create-role, or is a member of **any** role.
4. **Counters in the app server.** Per-minute limits per route and two daily
   budgets (per IP and per process). See
   [server.md](server.md#rate-limits-and-daily-budgets).

**Create `colordb_app` with SQL (`sql/80_neon_grants.sql`), never in the Neon
console.** A console-created role gets `neon_superuser`, which reads every
table and makes all of the above pointless. The membership check in the grants
script exists to catch exactly this.

## Runtime: `server/colordb.js`

### Enforcing TLS: `sslComplaint(raw)` (`:56`)

`AUTOCOLOR_COLORDB_URL` must use `sslmode=verify-full`. The check reads the
**URL text**, not `pg`'s parsed options, because `pg-connection-string` turns
`require`, `prefer`, `verify-ca` and `verify-full` into the same `ssl: {}`
today, so after parsing they cannot be told apart. It returns `''` when the URL
is acceptable, otherwise a reason:

- not a URL, or a scheme other than `postgres:` / `postgresql:`;
- `sslmode` missing or not `verify-full`, unless the host is loopback and the
  mode is `disable` or absent (the local build database);
- `uselibpqcompat=true`, which switches `pg` to libpq's weaker reading;
- `sslrootcert=disable`;
- `sslrootcert=system`: psql needs it, but `pg` reads it as a **file name**
  and would throw `ENOENT` while building the pool, crashing startup. Refusing
  it here disables only the finder;
- `ssl=false`.

At module load (`:102-126`), `offReason` is set from
`AUTOCOLOR_COLORDB_DISABLED=1`, a missing URL, or a complaint. If there is a
reason, no pool is created and `isEnabled()` is `false`.

A second check runs on every new connection (`pool.on('connect')`, `:135`):
if the host is not loopback and the socket is not `encrypted`, the finder
disables itself. The URL check says what was asked for; this says what
actually happened.

### Pool

`max` from `AUTOCOLOR_COLORDB_MAX` (default 4, sharing Neon's connection
budget with the requests database, which must not queue), 30 s idle timeout,
7 s connect timeout. An `error` listener logs dropped idle connections.

### Errors: outage vs bug

`call(sql, params)` (`:238`) is the only way queries run:

```js
if (!enabled) throw new ColourDbUnavailable();
for (let attempt = 1; ; attempt += 1) {
    try { return await pool.query(sql, params); }
    catch (err) {
        if (attempt >= CALL_ATTEMPTS || !transient(err)) throw classify(err);
        await new Promise((resolve) => setTimeout(resolve, 300));
    }
}
```

- `transient(err)` (`:204`): DNS and socket failures, `57P01`–`57P03` (Neon
  closing a connection across a suspend, or still starting), and the three
  code-less `pg` timeout messages. These are retried **once** after 300 ms.
  Every function is read-only, so a retry is harmless.
- `classify(err)` (`:220`): outage-class errors (the transient ones, plus
  `08xxx`, too-many-connections `53300`, `53400`, database missing `3D000`, and
  auth failures `28000`/`28P01`) become a detail-free `ColourDbUnavailable`, so
  the route answers `503` and the page falls back to its local catalogue.
  Anything else is re-thrown as is and becomes a `500`, because an outage and a
  bug should not look the same.

### Queries

Every call names the function in full (`api.makes()`), because the role's
`search_path` is empty.

| Function in JS | SQL | Returns |
| --- | --- | --- |
| `makes()` | `api.makes()` | `[{ makeId, label, sortKey }]` |
| `models(makeId)` | `api.models($1)` | `[{ modelId, name }]` |
| `coloursFor({ makeId, modelId, year, from })` | `api.colours_for(…)` | `{ items, from, hasMore }`: asks for 61, returns 60, and `hasMore` is whether the 61st existed. The API never says how many rows there are. |
| `colourByCode(makeId, code)` | `api.colour_by_code(…)` | colour rows plus `modelName` |
| `colourById(swCode)` | `api.colour($1)` | one colour or `null` |
| `stats()` | `api.stats()` | the `meta` row |

`colourRow(r)` (`:280`) shapes a row: `swCode`, `code` (the first factory
code, or `''` for the 5,782 colours without one), `altCodes` (the other codes
the same paint is sold under, such as Jeep's KBX and PBX), `name`, `swName`,
`finish` (a one-letter code), `family`, `hex`, `years: [min, max]`,
`brandWide` (registered for the whole make rather than a model) and
`dualTone`.

## The six SQL functions (`sql/70_neon_api.sql`)

The script drops and recreates schema `api` whole. `CREATE OR REPLACE
FUNCTION` is keyed on argument types, so changing a parameter type would add an
overload instead of replacing the function. Parameters are `integer` rather
than `smallint`, because Postgres will not narrow an integer literal to
`smallint` when resolving a function.

- **`api.makes()`**: vehicle makes whose `make_id = group_id` (one row per
  brand), ordered by `sort_key` then label.
- **`api.models(p_make)`**: models of a brand group, by name, `LIMIT 500`.
- **`api.colours_for(p_make, p_model, p_year, p_from)`**:
  - `v_from` clamps the offset to 0–600 inside the function;
  - rows match the make and, if given, the model **or** make-level rows
    (`model_id IS NULL`), because more than half the catalogue hangs off the
    make rather than a model;
  - a year matches with one year of tolerance either side (a car sold in
    December is next year's model), or when the colour has no year range;
  - rows are **grouped per colour**, because `vehicle_colour` has one row per
    model, and browsing a make would otherwise repeat the same tile for every
    model that wore it;
  - the factory codes are aggregated into an array of at most six, with
    one-letter codes sorted last so a stray "C" never leads the tile;
  - ordered model-specific first, then most recent, then by name;
    `OFFSET v_from LIMIT 61`.
- **`api.colour_by_code(p_make, p_code)`**: normalises the code the same way
  the page does (upper-case, strip everything but `A-Z0-9`), requires 2–10
  characters, and matches by **equality** on the factory code **or** the
  Sherwin code. A `hit` CTE finds up to 12 matching colours, then the outer
  query gathers every code each one goes by, with the typed code first. It
  also returns one model name so the customer recognises the car.
- **`api.colour(p_code)`**: one colour by Sherwin id. Used by the server to
  re-confirm an order's colour.
- **`api.stats()`**: the build-time counts from `meta`.

## Building and publishing

The pipeline runs on the work machine. Nothing in the build reaches Neon until
the last step, and the formulas never do.

```
server/colordb/bundle/data/*.csv      (the extract, ~400 MB, gitignored)
        │  npm run colordb:load   (server/colordb/load.sh)
        ▼
local Postgres :5434, database colordb_src  (dropped and recreated each run)
   bundle/01_schema → 02_load → 03_indexes → 04_verify      (the extract's own scripts)
   sql/10_makes     the 13-brand allowlist, 27 source names grouped
   sql/20_subset    models, colours, links; paint systems folded into a bitmask
   sql/30_derive    finish and colour family inferred from the colour name
   sql/35_hex       a screen hex mixed from each colour's tinting formula
   sql/36_cleanup   two-tone cross-references resolved; undrawable rows removed
   sql/45_audit     fails the build if something the brands list fell out
   sql/40_export    four CSVs + meta into export/ (gitignored)
        │  node reconcile-hex.js   hex hue pulled back into the family the name states
        │  node build-index.js     writes src/colourIndex.js
        ▼
        │  npm run colordb:push   (server/colordb/push.sh)
        ▼
Neon database colordb
   sql/50_neon_schema   drops and recreates schema colour (tables only)
   sql/60_neon_load     \copy the CSVs, then indexes, then a row-count check
   sql/70_neon_api      the six functions
   sql/80_neon_grants   role colordb_app, revokes, grants, role settings
        │  npm run colordb:verify   (server/colordb/verify.js)
        ▼
   proves, as colordb_app, that the box holds
```

### `load.sh`

Pins the Postgres binaries (Postgres.app and Homebrew are both installed, in
different `PATH` orders for different commands), checks the local server is up
on 5434, recreates `colordb_src`, runs the extract's scripts from the bundle
folder (their `\copy` paths are relative), then the project's SQL, then the two
Node steps. Nothing leaves the machine.

### `sql/35_hex.sql` and `reconcile-hex.js`

The source has no RGB or Lab values at all. What it has is each colour's
recipe, built from 223 named pigments. `35_hex.sql` assigns each pigment a
colour and mixes a hex from the recipe with a weighted subtractive model. Only
the resulting six characters are exported.

The model has no absorption or scattering, so it gets two things visibly wrong:
a transparent tint over a metallic base reads as the surface colour, and a
tri-coat's ground coat is sometimes not the colour at all. `reconcile-hex.js`
checks each mixed hex's colour family against the family the colour's **name**
states and, where they disagree, rotates the hue into the named family while
keeping the mixed lightness and saturation. About 1 colour in 8 moves. The page
says this swatch is computed and approximate (see
[matizado.md](matizado.md#swatches)).

### `build-index.js`

Writes `src/colourIndex.js` from `export/`: the 13 makes and 1,441 models as a
static file (`window.AUTOCOLOR_COLOUR_INDEX = { version, makes, models }`), so
the page's make and model `<select>`s fill without a network call. Only colours
travel over the network.

### `push.sh`

- Reads `AUTOCOLOR_COLORDB_ADMIN_URL` and `AUTOCOLOR_COLORDB_APP_PASSWORD` from
  the environment, falling back to `.env`. Never from arguments, which any
  process can see in `ps`.
- Requires `sslmode=verify-full` on the admin URL (loopback excepted).
- Appends `sslrootcert=system` for psql (libpq otherwise looks for
  `~/.postgresql/root.crt`). This must never go into the server's URL; see
  `sslComplaint()` above.
- Splits the password out of the URL with a small Python snippet and passes it
  as `PGPASSWORD`, so it does not appear on psql's command line.
- Runs `50` → `60` → `70` → `80`.

### `sql/80_neon_grants.sql`

1. Reads the app password with `\getenv`, refusing to run without it.
2. Creates or updates `colordb_app` (`LOGIN NOINHERIT NOCREATEDB NOCREATEROLE`,
   connection limit 8).
3. Fails if the role has any dangerous attribute or **any** membership.
4. Revokes everything from `PUBLIC` on the database, `public`, `colour` and
   `api`; grants `CONNECT`, `USAGE` on `api`, and `EXECUTE` on the six
   functions by signature; sets default privileges so future objects are not
   public either.
5. Sets the role's per-database settings (read-only, empty `search_path`,
   timeouts).
6. Prints what the role may execute and which schemas it may use.

### `verify.js`

Connects **as `colordb_app`** with the server's own URL and checks, among other
things: the URL passes `sslComplaint`, TLS is on the wire, the session is
read-only, the `search_path` is empty, a statement timeout is set, schema
`colour` is invisible, the unpublished tables (`formulas` and friends) answer
`undefined_table`, pages never exceed 61 rows even with a huge offset, a code is
normalised like the page does, a Sherwin code finds its colour, the catalogue is
exactly the 13 brands, two-tone codes resolve to real paints, and every
`BRAND_NAMES` label in `src/paints.js` exists as a make. Run it after every push
and after any change to `sql/70` or `sql/80`: a privilege mistake is otherwise
silent, since the page keeps working with the door open.
