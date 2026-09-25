# Operations: running, deploying and the tools

## Requirements

- Node.js 18 or newer (`.nvmrc` pins 22 for Render).
- Postgres binaries. The scripts pin Postgres.app's
  (`/Applications/Postgres.app/Contents/Versions/latest/bin`), because this
  machine also has Homebrew's Postgres, and mixing `initdb` from one with
  `pg_ctl` from the other creates a cluster that will not start. Override with
  `AUTOCOLOR_PG_BIN`.
- Python 3 for `server/colordb/push.sh` and the `tools/*.py` scripts.

## First run

```bash
npm install                 # installs pg, the only dependency
cp .env.example .env        # then set AUTOCOLOR_STAFF_PASSWORD and AUTOCOLOR_WORKER_IDS
npm run db:init             # creates Autocolor's own Postgres on port 5434, the database and the schema
npm start                   # http://localhost:3000
```

After that, each session:

```bash
npm run db:start
npm start
```

`.claude/launch.json` describes the same `npm start` on port 3000 for tools
that launch the app.

## npm scripts

| Script | Runs | Purpose |
| --- | --- | --- |
| `start` | `node server/server.js` | The server. |
| `db:init` | `server/pgserver.sh init` | Create the cluster (once), start it, create the database, apply the schema. |
| `db:start` / `db:stop` / `db:status` | `pgserver.sh …` | Control the local server. |
| `db:psql` | `pgserver.sh psql` | A `psql` shell on `autocolor`. Extra arguments pass through. |
| `db:schema` | `pgserver.sh schema` | Apply `server/schema.sql` locally with `psql`. |
| `db:migrate` | `node server/migrate.js` | Apply `server/schema.sql` through the app's pool. Works locally and, with `DATABASE_URL`, against Neon. |
| `colordb:load` | `server/colordb/load.sh` | Build the colour subset locally. |
| `colordb:push` | `server/colordb/push.sh` | Publish it to Neon and apply the grants. |
| `colordb:verify` | `node server/colordb/verify.js` | Prove the published colour database is locked down. |

## Local Postgres

`server/pgserver.sh` runs a **separate** Postgres cluster just for Autocolor,
so stopping, upgrading or deleting another project's database never touches
this one.

| Setting | Default | Override |
| --- | --- | --- |
| Data directory | `~/Library/Application Support/Postgres/autocolor` | `AUTOCOLOR_PGDATA` |
| Port | `5434` (5432 and 5433 belong to other projects) | `AUTOCOLOR_PGPORT` |
| Database | `autocolor` | `AUTOCOLOR_PGDATABASE` |
| Log | `$PGDATA/postgresql.log` | `AUTOCOLOR_PGLOG` |

The data directory is where Postgres.app keeps its servers, so this cluster
also appears in Postgres.app's list and can be started from either place. It
is outside the repository, so `git clean -xfd` cannot delete customer data.
`init` also writes the port into `postgresql.conf`, so starting the cluster by
hand does not collide with 5432.

## Deploying

Production is **Render** (one web service, Virginia region, free plan) with
**Neon** for both databases. `render.yaml` is the blueprint, and its comments
explain every setting.

- `branch: main`, `autoDeploy: true`: **every merge to `main` deploys.**
- `buildCommand: npm ci`, `startCommand: npm start`.
- `healthCheckPath: /healthz`, which never touches the database.
- Fixed values: `HOST=0.0.0.0`, `TRUST_PROXY=3`,
  `AUTOCOLOR_STAFF_COOKIE_SECURE=1`, `ALLOWED_ORIGINS=""`,
  `AUTOCOLOR_MAIL_SHOP`.
- Secrets typed in Render's dashboard (`sync: false`): `DATABASE_URL`,
  `AUTOCOLOR_COLORDB_URL`, `AUTOCOLOR_STAFF_PASSWORD`, `AUTOCOLOR_WORKER_IDS`,
  `AUTOCOLOR_BOSS_ID`, `AUTOCOLOR_BREVO_KEY`, `AUTOCOLOR_SITE_URL`. All are
  read once at startup; changing one requires a restart.

### First deployment

1. Create the Neon project. Copy the **direct** connection URL (not
   `-pooler`), change `sslmode=require` to `sslmode=verify-full`, and remove
   `channel_binding`.
2. Apply the schema from the work machine:
   `DATABASE_URL='postgresql://…?sslmode=verify-full' npm run db:migrate`.
   The schema is never applied by the build: `schema.sql` touches live rows,
   and a failure there should not take the site down.
3. Create the Render blueprint from the repository and fill in the secrets.
4. For the colour finder: create the `colordb` database, then run
   `npm run colordb:load`, `npm run colordb:push` and `npm run colordb:verify`
   from the work machine (see [colour-database.md](colour-database.md)). Put
   the `colordb_app` URL in `AUTOCOLOR_COLORDB_URL`.

After that, every push to `main` redeploys. When `schema.sql` changes, repeat
step 2 **before** merging code that needs the new schema.

### Checking a deployment

The startup log says, in order: the URL, «Desplegado: main @ <sha>», the
database, whether the panel is on, the colour database's size (or why it is
off), and whether mail works. If something looks unchanged after a
configuration change, check the commit line first: the running code may be
older than expected.

`GET /api/staff/whoami` (logged in as the boss) shows the client IP the server
sees, the proxy headers, `TRUST_PROXY`, and the mail configuration with its
pending queue length. Use it after any change to `TRUST_PROXY` or the hosting
topology.

### What the free plan means

- The service sleeps after 15 minutes without traffic. The next visitor waits
  30–60 s, plus Neon's own wake-up.
- Panel sessions, rate-limit counters, mail caps and the mail queue are in
  memory, so each sleep and each deploy logs the workshop out and resets them.
- Do not add a cron to keep it awake: 24/7 is about 730 of the 750 free hours
  a month.
- Bandwidth: 5 GB a month included, then $0.15/GB. A first visit that reaches
  step 3 downloads one model (4.4–9.4 MB compressed). Repeat visits get a
  `304`.

### GitHub Pages

The README notes that GitHub Pages was still enabled on the repository,
building from `main`. If it still is, every merge also publishes a static copy
of the whole repository, including `pgs/taller.html` and `server/`, at
`gabrielesarria167-ai.github.io/autocolor`. Check Settings → Pages and turn it
off.

## Tools

Developer tools, none needed at runtime.

### `tools/verify-3d.mjs`

```bash
node tools/verify-3d.mjs                   # check the four models in the repo
node tools/verify-3d.mjs base.glb new.glb  # compare a re-exported model
```

Reads only each GLB's JSON chunk (no dependencies). Checks that every panel id
in `VEHICLE_MODELS[*].parts` (read from `src/carVisual.js`, not copied) still
resolves to a mesh carrying the paint material, that `BY_VEHICLE` in
`src/parts.js` matches, and that every part has a price group. Run it before
committing any model change: optimisers rename and merge nodes, and a panel
that stops resolving fails silently in the browser.

### `tools/weld-smooth-normals.mjs`

Welds a model's duplicated vertices and recomputes smooth normals. Written for
the van, whose Blender export gave every triangle corner its own vertex (2.57
million vertices for 953,000 triangles, 20.5 MB). `gltf-transform weld` could
not join them because each copy had a different normal. This tool drops the
normals, welds by position and UV, and recomputes area-weighted smooth
normals: 550,046 vertices and 6.9 MB. Only safe on models whose normals were
already smooth; the header explains how that was checked.

### `tools/build-paint-mask.py`

Regenerates the home page hero's bodywork mask from `imgs/assets/suv.png`,
and the WebP copies the page serves. See
[home-page.md](home-page.md#the-hero-colour-preview).

### `tools/tracelogo.py`

Traces the supplied logo raster (`design/rebrand/logo-source.jpeg`) into SVG
paths with measured bands, and renders the brand assets in `imgs/brand/`,
including the transparent PNG logos used in emails.

### `tools/mailpreview.js`

Prints the notice emails for a sample request without sending anything, and
writes their HTML to files. See [email.md](email.md#previewing-without-sending).

### `tools/paint-catalog/`

Builds `src/paintCatalog.js` (the local catalogue of 777 colours with measured
swatches) from Sherwin-Williams PDF guides:

```bash
python3 -m venv .venv && .venv/bin/pip install pdfplumber
./fetch.sh                        # ~130 PDFs, 200 MB, into $PAINT_ASSETS (outside the repo)
.venv/bin/python parse_compat.py  # model / code / name rows per model year
.venv/bin/python parse_chips.py   # sample the printed chips for a swatch colour
.venv/bin/python build.py         # write src/paintCatalog.js
```

`merge.py` holds model-name aliases between markets (the Tracker is the US
Trax) and, run alone, writes a coverage report. The generated file's
`colours[brand]` rows are `[code, name, finish, hex, from, to, family,
altCodes]`. Its `models` table is still built but no longer read by the page.

### `server/colordb/*`

The colour database pipeline. See
[colour-database.md](colour-database.md#building-and-publishing).

## Branches and deploys

`main` deploys to production on every push. Work goes on a feature branch,
pushed to the `autocolor` remote, and is reviewed before merging.
