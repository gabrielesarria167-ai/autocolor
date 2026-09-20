# Colour database

The Sherwin-Williams Collision Core catalogue: 95,059 colours, 1,471,129
vehicle→colour associations and 257,530 formulas, extracted on 2026-09-20 from
the `MX.db` of the shop's own Lazzumix install (data version `202606081414`).

It is the source of colour identification for the matizado page
(`pgs/paintings.html`). It replaces `src/paintCatalog.js` in that role — 777
colours, 10 brands, US model years 2010-2018 — which stays on as a sidecar for
the one thing this database does not have: a colour you can put on a screen.

## What goes to Neon, and what never leaves this machine

**Only the vehicle→colour lookup is published.** `formulas`,
`formula_ingredients`, `products` and `color_usage_notes` are loaded locally,
used to build and verify the subset, and then left here. The recipes are the
valuable part of this catalogue and the part a competitor would want; the
cheapest way not to leak them is for them not to exist on an internet-facing
host. `server/colordb/verify.js` asserts exactly that, by checking those four
tables answer `42P01 undefined_table` to the application role.

What is published, after the subset in `sql/`:

| | Rows | Why |
|---|---:|---|
| `colour.vehicle_colour` | ~683,000 | make/model/year + OEM code → colour code |
| `colour.colour` | 68,791 | colour code → name, finish, family |
| `colour.model` | ~3,540 | the model list behind the page's second `<select>` |
| `colour.make` | 453 | make names, grouped and labelled |

That is 95-130 MB against Neon's free 0.5 GB. The full bundle loads to ~1.2 GB,
which is both over quota and far more than the page needs.

**Three paint systems of 26.** 75 (Ultra 9K) and 79 (Ultra BC8) are 93% of the
table between them; 41 (Ultra 9K América do Sul) is another 919 rows carrying
214 colours found nowhere else, which matters for a shop selling in Peru. The
other 23 are industrial, truck and legacy lines — Shertruck, Lazzudur, Legacy,
Polane — that a body shop matching car paint never reaches for.

The paint system is a property of the *product*, not of the colour: the same
colour appears once per system it is sold in. Dropping that dimension takes
1,367,482 rows to 741,665, and folding the make aliases takes it to ~683,000.
The systems survive as a bitmask on `colour.colour.systems`.

## Layout

```
bundle/       the extract, exactly as generated. Do not edit.
  0[1-4]_*.sql  schema, load, indexes, verify
  README.it.md  the original Italian documentation, kept as provenance
  data/         400 MB of CSV — gitignored
sql/          10-40 build the subset locally; 50-80 publish and harden it
export/       the subset's CSVs, the only thing that goes to Neon — gitignored
load.sh       local build      (npm run colordb:load)
push.sh       Neon load+harden (npm run colordb:push)
verify.js     proves the app role is boxed in (npm run colordb:verify)
```

The four `bundle/*.sql` files are byte-identical to the generated bundle and
must stay that way. They are produced together from the source database, so
editing one lets it drift from the CSVs — which is the exact failure
`04_verify.sql` exists to catch. To take a newer extract, replace all four and
`data/` together.

Nothing here is reachable over HTTP. `serveStatic()` in `server/server.js` works
from a fail-closed allowlist (`PUBLIC_DIRS`) of `/pgs/`, `/src/`, `/imgs/` and
`/vendor/`, checked against the resolved path; `server/` is not on it and cannot
be reached by climbing out of one that is.

## Four things to know before writing a query

The first three are the bundle author's, and they are right.

**1. 56% of colours hang off the make, not the model.** `model` is NULL on
825,592 of 1,471,129 rows. That is not missing data — the source attaches many
colours to a whole brand rather than to one model, and `is_brand_level` says
which. A search filtering on `model` alone loses more than half of what the
shop can actually mix. Every query needs the fallback, which `api.colours_for()`
carries as `OR v.model_id IS NULL`.

**2. Historic formulas sit beside current ones.** 71,099 rows of `formulas`
have `is_history = true` and share a `color_code` with the live version. Group
by `formulas_id`, never by `color_code`, or the two versions' ingredients mix.
Local queries only — none of this reaches Neon.

**3. Year 0 became NULL.** `YearMinimum = 0` in the source (48,998 rows) means
"unspecified", not the year zero.

**4. There is no colour in the colour database.** No hex, no RGB, no L\*a\*b\*,
in any of the ten tables. `solid_type` and `color_family` exist as columns but
are empty on every row of systems 75, 79 and 41. So:

- the **swatch** comes from `src/paintCatalog.js`, which has a measured chip for
  528 colours — about 17% of what the page will show. The rest render as the
  hatch `setSwatch()` already draws for a missing hex.
- the **finish**, which multiplies the price in `src/paints.js`, is derived from
  the `MET` / `PEARL` / `MICA` / `NACRE` / `3C` markers in `colors.color_name`.
  Of 68,791 codes, 41,299 carry a marker, 19,022 have a name and no marker and
  so read as solid, and 8,470 have no name at all and stay unknown. Measured
  against the local catalogue where
  both know a colour, that agrees exactly 70% of the time and on the
  solid-vs-effect axis 89% of the time. It is a good guess and it is still a
  guess, which is why the colour card lets the customer correct it.
- the **family** chips come from the same names, landing on a real family for
  about 75% of codes.

## Make names are not tidy

453 makes appear in the three published systems, and they are neither unique nor
all vehicles. FORD is seven names (`FORD`, `FORD USA`, `FORD ARGENTINA`,
`FORD AUSTRALIA`, `FORD BRAZIL - ARGENTINA`, `FORD NEW ZEALAND`,
`FORD SOUTH AFRICA`); MERCEDES is `MERCEDES` plus `MERCEDES TRUCKS`, while
`MERCEDES BENZ` has no rows here at all. About 51 entries are not cars —
RAL, PANTONE, SIKKENS, VALSPAR, COLOR MAP and 31 national FLEETOWNER rows.

`sql/20_makes.sql` holds the grouping and the labels as an explicit list, not a
pattern. A regex is worse here: it works until the day the source adds
`FORD FLEET` and quietly folds it into Ford. A list is auditable and someone has
to mean it.

The ten labels for the brands the shop sells must stay byte-identical to
`BRAND_NAMES` in `src/paints.js`. `colourHex()` in `server/mail.js` matches the
brand by display name to draw the swatch in the order email, and if a label
drifts the email loses its chip silently. `verify.js` checks this.

## Licence

This is a commercial Sherwin-Williams database. Using it at the counter and
publishing a searchable copy of 682,000 associations are different acts, and no
amount of hardening changes that. The controls in `sql/80_neon_grants.sql` and
`server/colordb.js` raise the cost of bulk extraction; they do not grant a right
to republish.
