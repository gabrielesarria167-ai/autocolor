# Autocolor: the codebase guide

This folder explains the whole Autocolor codebase in English: what each
feature does, why it is built the way it is, and how the important functions
work line by line. The top-level `README.md` is the operator's manual, mostly
in Spanish. This guide is for someone who has to read, change or review the
code.

Nothing in `docs/` is served by the site. `server/server.js` only serves an
allowlist of folders (`pgs/`, `src/`, `imgs/`, `vendor/`, plus `index.html` and
`styles.css`), so these files stay out of the public site even though the
repository itself is public.

## Reading order

If you are new, read the first three in order. After that, read whichever
feature you are about to touch.

| # | File | What it covers |
| --- | --- | --- |
| 1 | [architecture.md](architecture.md) | The product, the moving parts, how a request travels, the design rules the code follows |
| 2 | [glossary.md](glossary.md) | The Spanish words used in the UI, the tables and the identifiers |
| 3 | [configuration.md](configuration.md) | Every environment variable, what reads it and what happens without it |
| 4 | [server.md](server.md) | `server/server.js`: static files, routing, validation, rate limits, client IPs, errors, startup and shutdown |
| 5 | [database.md](database.md) | `server/schema.sql` and `server/db.js`: the three tables, the migrations, and every query |
| 6 | [workshop-auth.md](workshop-auth.md) | `server/auth.js`, `server/names.js` and the `/api/staff/*` routes: the password, worker codes, the boss, sessions |
| 7 | [email.md](email.md) | `server/mail.js`, `server/mailhtml.js`, `server/netcheck.js`: the notices, the Brevo API, the outbox queue, the daily caps |
| 8 | [colour-database.md](colour-database.md) | `server/colordb.js` and `server/colordb/`: the read-only Sherwin-Williams catalogue, its build pipeline and its security model |
| 9 | [quote-wizard.md](quote-wizard.md) | `pgs/repair.html`, `src/repair.js`, `src/lookup.js` and their data files: the customer's four-step quote |
| 10 | [3d-viewer.md](3d-viewer.md) | `src/carVisual.js`: the three.js panel picker shared by the wizard and the panel |
| 11 | [matizado.md](matizado.md) | `pgs/paintings.html`, `src/paintings.js`, `src/paints.js`: selling mixed paint to other shops |
| 12 | [workshop-panel.md](workshop-panel.md) | `pgs/taller.html`, `src/staff.js`: the staff's queue, occupancy, the boss's monitor, notes, walk-ins, paint orders |
| 13 | [home-page.md](home-page.md) | `index.html`, `src/home.js`, `styles.css`: the landing page, the hero colour preview, the stylesheet's layout |
| 14 | [operations.md](operations.md) | Running locally, the npm scripts, deploying to Render and Neon, and the tools in `tools/` |
| 15 | [review-2026-09-25.md](review-2026-09-25.md) | Findings from a full code review of `main` at `f9438c4` |

## Conventions used in this guide

- **`file:line` references** point at `main` as of commit `f9438c4`. Lines move
  as the code changes, so treat them as "look around here", and search for the
  function name if the line is off.
- **Spanish in quotes** («Liberar», «Mis vehículos») is text a user sees on
  screen. The code keeps it in Spanish because the shop's customers and staff
  read Spanish. Everything else (identifiers, comments, logs, docs) should be
  in English. Older comments and logs are still in Spanish; see
  [architecture.md](architecture.md#languages).
- **"The shop"** is the Autocolor body shop in Ayacucho, Peru. **"The boss"**
  is the one staff member configured in `AUTOCOLOR_BOSS_ID`.

## One-paragraph summary

Autocolor is a single Node.js process with one dependency (`pg`). It serves a
static site (plain HTML, CSS and browser JavaScript, no build step) and a small
JSON API. Customers use two public forms: a four-step **quote wizard** for
repainting a vehicle, where they pick panels on a 3D model, and a four-step
**matizado page**, where other shops order paint mixed to a factory colour.
Both store a row in Postgres and hand back a random 10-digit tracking code.
Staff work the queue from a password-protected **workshop panel**. Notices go
out by email through the Brevo HTTPS API. Colour identification uses a second,
read-only Postgres database holding a subset of the Sherwin-Williams
catalogue. Production runs on Render (web service) and Neon (both databases).
