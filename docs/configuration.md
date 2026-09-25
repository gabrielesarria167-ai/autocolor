# Configuration

All server configuration is environment variables. Locally they come from a
`.env` file at the repository root (copy `.env.example`). On Render they are set
in the dashboard, and `render.yaml` declares which ones exist. The browser has
its own two settings in `src/config.js`.

## server/env.js

`server/env.js` loads `.env` into `process.env` the first time any server
module `require`s it. `server.js`, `auth.js`, `colordb.js` and `migrate.js` all
require it before reading a variable, and Node's module cache makes sure it
runs once.

How the parser works (`parse()`, `server/env.js:30`):

- It splits on `\r?\n`, trims each line, and skips blank lines and lines
  starting with `#`.
- It splits each remaining line at the **first** `=`. A line whose `=` is at
  position 0 or missing is skipped (`eq < 1`).
- If the value is wrapped in matching `"…"` or `'…'`, the quotes are
  stripped. That lets a password contain spaces or a `#`. There is no escape
  processing and no multi-line values.

`load()` (`server/env.js:55`) reads the file and, for each key, sets it **only
if `process.env[key]` is `undefined`**. So a variable exported in the shell,
or written before the command (`PORT=3001 npm start`), always wins over the
file. A missing `.env` is normal and silent. Any other read error is printed.

`.gitignore` excludes `.env` and `.env.*` (so a `.env.bak` is excluded too),
and re-includes `.env.example`, which holds no real values.

## Server variables

### Core

| Variable | Default | Read by | Effect |
| --- | --- | --- | --- |
| `PORT` | `3000` | `server.js:64` | HTTP port. Render provides it. |
| `HOST` | `127.0.0.1` | `server.js:69` | Bind address. Loopback on purpose: the panel exposes customer phone numbers. Set `0.0.0.0` to test from a phone on the LAN, and always on Render (`render.yaml` does). |
| `TRUST_PROXY` | `0` | `server.js:76` | Number of trusted proxies that append to `X-Forwarded-For`. `3` on Render (client → Cloudflare → Render router). See [server.md](server.md#client-ip-addresses). |
| `ALLOWED_ORIGINS` | empty | `server.js:123` | Comma-separated origins allowed to call the API cross-origin. Only for a site hosted apart from the API. Empty on Render on purpose. |

### The `autocolor` database

| Variable | Default | Effect |
| --- | --- | --- |
| `DATABASE_URL` | empty | When set, it is the whole connection (host, port, db, user, password, TLS) and the `PG*` variables are ignored. Use `sslmode=verify-full`. |
| `PGHOST` | `localhost` | Local connection only. |
| `PGPORT` | `5434` | Local connection only. The port is pinned so the app never writes to the machine's general Postgres on 5432. |
| `PGDATABASE` | `autocolor` | Local connection only. |
| `PGUSER`, `PGPASSWORD` | libpq defaults | Local connection only. |

See [database.md](database.md#connecting).

### The workshop panel

| Variable | Default | Effect |
| --- | --- | --- |
| `AUTOCOLOR_STAFF_PASSWORD` | empty | The shared password. Without it every `/api/staff/*` route answers `503`. Read once at startup. |
| `AUTOCOLOR_WORKER_IDS` | empty | `CODE:Name,CODE:Name`. Codes are two letters plus five digits. Without any code (and no boss), login answers `503`. |
| `AUTOCOLOR_BOSS_ID` | empty | One `CODE:Name` entry. Optional. The boss gets the monitor, walk-in registration and paint pricing, and cannot take vehicles or move statuses. |
| `AUTOCOLOR_STAFF_COOKIE_SECURE` | off | `1` adds `Secure` to the session cookie. Must be on behind HTTPS, off on `http://localhost`. |

See [workshop-auth.md](workshop-auth.md).

### Email

| Variable | Default | Effect |
| --- | --- | --- |
| `AUTOCOLOR_BREVO_KEY` | empty | Brevo API key. Without it no email is sent and everything else works. |
| `AUTOCOLOR_MAIL_SHOP` | the owner's Gmail | Where the shop's copy goes. |
| `AUTOCOLOR_MAIL_FROM` | `AUTOCOLOR_MAIL_SHOP` | Sender address. **Must be verified in Brevo → Senders**, or the API answers `400`. |
| `AUTOCOLOR_MAIL_FROM_NAME` | `Autocolor` | Sender display name. |
| `AUTOCOLOR_SITE_URL` | `RENDER_EXTERNAL_URL` | Public base URL for links and logo images in emails, and accepted as "this site" by the `Origin` check. |
| `AUTOCOLOR_MAIL_DAILY_CAP` | `280` | All outgoing mail per UTC day. |
| `AUTOCOLOR_MAIL_CUSTOMER_DAILY_CAP` | `120` | Customer confirmations per UTC day. |
| `AUTOCOLOR_BREVO_URL`, `AUTOCOLOR_BREVO_ACCOUNT_URL` | Brevo's endpoints | For pointing tests at a fake server. Never set in production. |

See [email.md](email.md).

### The colour database

| Variable | Default | Effect |
| --- | --- | --- |
| `AUTOCOLOR_COLORDB_URL` | empty | Connection for role `colordb_app`. Must carry `sslmode=verify-full` unless it points at loopback; otherwise the finder switches itself off at startup. Without it, the finder answers `503` and the page uses its local catalogue. |
| `AUTOCOLOR_COLORDB_MAX` | `4` | Pool size. Small because it shares Neon's connection budget with the requests database. |
| `AUTOCOLOR_COLORDB_DISABLED` | off | `1` switches the finder off without touching the URL. |
| `AUTOCOLOR_COLORDB_DAILY_IP` | `2000` | Finder requests per IP (or IPv6 /64) per 24 h. |
| `AUTOCOLOR_COLORDB_DAILY_TOTAL` | `60000` | Finder requests for the whole process per 24 h. |
| `AUTOCOLOR_COLORDB_ADMIN_URL` | empty | Owner role. **Only** for `npm run colordb:push` on the work machine. Never on Render. |
| `AUTOCOLOR_COLORDB_APP_PASSWORD` | empty | Password `push.sh` sets on `colordb_app`. Work machine only. |

See [colour-database.md](colour-database.md).

### Set by Render

| Variable | Used for |
| --- | --- |
| `RENDER` | Enables two startup warnings: loopback `HOST` and missing `TRUST_PROXY`. |
| `RENDER_EXTERNAL_URL` | The onrender.com URL. Fallback for `AUTOCOLOR_SITE_URL`, printed in the startup log, and accepted by the `Origin` check. |
| `RENDER_GIT_COMMIT`, `RENDER_GIT_BRANCH` | Printed at startup as «Desplegado: branch @ sha», so the log says which code is running. |

### Local scripts only

| Variable | Default | Read by |
| --- | --- | --- |
| `AUTOCOLOR_PGDATA` | `~/Library/Application Support/Postgres/autocolor` | `server/pgserver.sh` |
| `AUTOCOLOR_PGPORT` | `5434` | `pgserver.sh`, `colordb/load.sh` |
| `AUTOCOLOR_PGDATABASE` | `autocolor` | `pgserver.sh` |
| `AUTOCOLOR_PG_BIN` | Postgres.app's `latest/bin` | `pgserver.sh`, `colordb/load.sh`, `colordb/push.sh` |
| `AUTOCOLOR_PGLOG` | `$PGDATA/postgresql.log` | `pgserver.sh` |
| `AUTOCOLOR_COLORDB_BUILD` | `colordb_src` | `colordb/load.sh`: the throwaway build database |
| `PAINT_ASSETS` | `~/Downloads/claude-autocolor-assets` | `tools/paint-catalog/*` |
| `MAILPREVIEW_OUT` | none | `tools/mailpreview.js` |

## Browser configuration

`src/config.js` sets two globals, loaded first by every page that talks to
the API:

- `window.AUTOCOLOR_API_BASE = ""`. Empty means "the origin this page came
  from", which is right when one process serves both. For a site on a static
  host with the API elsewhere, set it to the API's origin (no trailing slash)
  and list the site's origin in the server's `ALLOWED_ORIGINS`. The workshop
  panel cannot work that way (see [architecture.md](architecture.md)).
- `window.AUTOCOLOR_CAR_IMAGE_CUSTOMER = ""`. An imagin.studio customer key.
  When set, step 1 of the wizard shows cut-out car photos from that paid
  service instead of the site's own photos in `imgs/assets/stock-models/`.

## What happens when something is missing

| Missing | Result |
| --- | --- |
| `.env` | Nothing unusual. Environment variables are used as they are. |
| Database unreachable at startup | The process exits with a message. Against Neon it tries 4 times first. |
| Staff password or worker codes | The panel answers `503`, and the startup log names what is missing. |
| Brevo key | Requests are stored; no email goes out; the startup log says so. |
| Colour database URL, or a URL without `verify-full` | The finder answers `503`; the matizado page falls back to its 777 local colours. |
| `TRUST_PROXY` behind a proxy | All visitors share one rate-limit bucket. On Render, a startup warning says so. |
