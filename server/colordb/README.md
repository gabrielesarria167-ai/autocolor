# Colour database

The Sherwin-Williams Collision Core catalogue: 95,059 colours, 1,471,129
vehicle→colour associations and 257,530 formulas, extracted on 2026-09-20 from
the `MX.db` of the shop's own Lazzumix install (data version `202606081414`).

It is the source of colour identification for the matizado page
(`pgs/paintings.html`). It replaces `src/paintCatalog.js` in that role — 777
colours, 10 brands, US model years 2010-2018 — which stays on as a sidecar for
the one thing this database does not have: a colour you can put on a screen.

**Thirteen brands are published, not all 383.** Toyota, Chevrolet, Ford,
Nissan, BMW, Audi, Mercedes-Benz, Subaru, Jeep, Fiat, Volkswagen, Kia and
Mitsubishi — the ones the shop sells. See *Thirteen brands* below.

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
| `colour.vehicle_colour` | 232,306 | make/model/year + OEM code → colour code |
| `colour.colour` | 28,562 | colour code → name, finish, family, hex |
| `colour.model` | 1,441 | the model list behind the page's second `<select>` |
| `colour.make` | 27 | make names, grouped into the 13 brands and labelled |

That is 9 MB of CSV against Neon's free 0.5 GB. The full bundle loads to
~1.2 GB, which is both over quota and far more than the page needs.

**Every paint system, not three.** The first version of this subset kept only
75 (Ultra 9K), 79 (Ultra BC8) and 41 (Ultra 9K América do Sul), on the grounds
that the other 23 are industrial, truck and legacy lines a body shop never
reaches for. That was wrong, and it cost 16,495 colours.

Lazzudur (04), Ultrabase (44), Legacy (94) and Poliuretano (15) are the
Brazilian automotive range, which for a shop in Peru is nearer the work than
the two lines that were kept. Jeep's VR847 — GRANITE CRYSTAL MET. — is sold in
04, 44 and 94 and nowhere else, so it did not exist at all; the Grand Cherokee's
PSE was the same. Both were reported missing by the shop, which is how this was
found.

The paint system is a property of the *product*, not of the colour: the same
colour appears once per system it is sold in, and that is what makes the raw
table 1,446,130 rows for 84,117 colours. Dropping that dimension and folding
the make aliases takes it to 699,437. Which lines a colour came from survives
as a bitmask on `colour.colour.systems` — 1 U9K, 2 BC8, 4 América do Sul, 8 the
rest — and `sql/35_hex.sql` reads it back to pick the right formula.

## Layout

```
bundle/       the extract, exactly as generated. Do not edit.
  0[1-4]_*.sql  schema, load, indexes, verify
  README.it.md  the original Italian documentation, kept as provenance
  data/         400 MB of CSV — gitignored
sql/          10-45 build the subset locally; 50-80 publish and harden it
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

- the **swatch** is mixed from the colour's own tinting formula, in
  `sql/35_hex.sql`. 28,095 of the 28,562 published colours carry one, and the
  rest fall back to a representative tone for their family. It is built from 223 named
  pigments — AZUL MEDIO, VERMELHO OXIDO, PRETO INTENSO, PEROLA AZUL GALAXIA.
  Name the pigments once and the mix follows: a weighted geometric mean in
  linear light, because paint is subtractive and an arithmetic mean turns every
  strong tint in a white base into a pastel. The recipe never leaves the build
  machine; only the six resulting characters are exported, which keeps the
  lookup-only decision intact.

  It is an approximation of a Kubelka-Munk mix without the coefficients, so it
  reads a transparent tint over a metallic ground as if it were the surface,
  and a tricoat's ground coat as if it were the colour. `reconcile-hex.js`
  turns those back into the family the name states, keeping the lightness and
  saturation the formula produced; it moves about one colour in eight. Measured
  against the scanned chips in `src/paintCatalog.js`, that takes the median
  ΔE76 from 18.5 to 17.0, and pearls from 22.1 to 18.9.

  Where the catalogue has a measured chip — 746 colours — that wins, and the
  page says which of the two it is showing.
- the **finish**, which multiplies the price in `src/paints.js`, is derived from
  the `MET` / `PEARL` / `MICA` / `NACRE` / `3C` markers in `colors.color_name`.
  Of the 28,562 colours published, most carry a marker (metallic 51.8%, pearl
  22.2%, tricoat 0.4%) and the rest read as solid because they have a name and
  no marker. Measured against the
  local catalogue where
  both know a colour, that agrees exactly 70% of the time and on the
  solid-vs-effect axis 89% of the time. It is a good guess and it is still a
  guess, which is why the colour card lets the customer correct it.
- the **family** chips come from the same names, landing on a real family for
  85.8% of colours; the rest fall to `otro`. German writes a colour as one word
  — TORNADOROT, ACAPULCOBLAU, ACHATGRAU, IMOLAGELB — so the rules in
  `sql/30_derive.sql` match those four as compound suffixes and not only as
  bare words. Without that, 1,684 German colours read as `otro`, and thirteen
  of them were dropped outright for having no family tone to fall back on.

## Thirteen brands

The shop sells Toyota, Chevrolet, Ford, Nissan, BMW, Audi, Mercedes-Benz,
Subaru, Jeep, Fiat, Volkswagen, Kia and Mitsubishi. Those are the only brands
published. The extract holds 383 others — Lada, Wartburg, Zastava, RAL,
PANTONE, a Pantone fan deck and sixty national FLEETOWNER books — and a body
shop in Peru will never mix any of them, while a search for a short code could
land on one.

`sql/10_makes.sql` holds the list. It is an allow-list, not a pattern: a make
is published because somebody wrote it down, or it is not published. A regex
works until the day the source adds `FORD FLEET` and quietly folds it into
Ford.

**One brand is several names.** The source spells a brand once per market, so
Ford is seven names (`FORD`, `FORD USA`, `FORD ARGENTINA`, `FORD AUSTRALIA`,
`FORD BRAZIL - ARGENTINA`, `FORD NEW ZEALAND`, `FORD SOUTH AFRICA`),
Volkswagen three and Mercedes-Benz two. 27 names fold onto 13 brands. Which
name leads a brand is stated in the file rather than left to the alphabet,
which would otherwise elect `BEIJING JEEP` to speak for Jeep.

**What is deliberately left out**, because each looks like an oversight and is
not: the sibling marques — Lexus and Scion (Toyota), Infiniti and Datsun
(Nissan), Dodge, Ram and Chrysler (Jeep's group), Alfa Romeo, Lancia and
Abarth (Fiat's), Seat and Skoda (Volkswagen's), Smart (Mercedes) — and the
truck and motorcycle arms, `BMW MOTOR`, `MERCEDES TRUCKS` and
`VOLKSWAGEN TRUCK`. They are separate code spaces. Adding one back is a line in
`brand` in `sql/10_makes.sql` and a rebuild.

A guard in the same file fails the build if the extract ever spells one of the
thirteen a way that is in neither list — a new `FORD EUROPE`, a
`MITSUBISHI FUSO` — so a new spelling is an error message rather than a brand
that is quietly half its size.

The labels for the ten brands the sidecar also knows must stay byte-identical
to `BRAND_NAMES` in `src/paints.js`. `colourHex()` in `server/mail.js` matches
the brand by display name to draw the swatch in the order email, and if a label
drifts the email loses its chip silently. `verify.js` checks this, and checks
that 746 of the 777 sidecar colours still resolve to a database colour, so a
regression in the make list shows up as a number rather than as a quietly
emptier finder.

## Two-tone cars keep their code

A `CC:` row is not a paint. It is a cross-reference naming two others —
`CC: TOY 8W7 / MAZ 41W` — for a car painted two colours, and there are 5,134
of them across the thirteen brands.

They have no formula of their own, so no swatch, and one of them answering a
search reads as a bug: a Ford customer typing AE used to be shown
`CC: TOY 6M1 / TOY 192` above GRABBER BLUE MET. So they were deleted.

But the code on the door jamb of a two-tone car *is* the code on the `CC:` row
— Toyota's D15, Nissan's 2H8 — and it appears nowhere else in the extract.
Deleting the row took the code with it, and 4,141 codes a customer could read
off a car answered "no encontramos ese color".

`sql/36_cleanup.sql` reads the reference instead: both halves are looked up by
brand token and factory code, and the customer's code is attached to the real
paints it stands for, flagged `dual_tone`. 5,098 of the 5,134 resolve. What is
left is 29 codes whose components are not in this catalogue at all.

## Nothing falls off the edge quietly

`sql/45_audit.sql` runs before the export and compares the extract against what
was made of it. It fails the build if the extract prints a code the catalogue
cannot answer, if a brand that sells a surviving colour has lost its link to
it, if a model that still has colours has gone from the list, or if a colour
belongs to no brand in the allow-list.

It exists because of a bug that produced no error at all: `sql/10_makes.sql`
used to build its make list from paint systems 75, 79 and 41 only, so
`SUBARU JAPAO` — which appears in none of them — had no row there, and the join
in `sql/20_subset.sql` silently dropped every link it had.

Of the 33,650 colours the thirteen brands offer, 28,562 are published, 5,086
are cross-references rather than paints, and 2 have neither a formula to mix
nor a colour word in the name to fall back on. Of the codes the extract prints,
29 answer nothing.

## Licence

This is a commercial Sherwin-Williams database. Using it at the counter and
publishing a searchable copy of 682,000 associations are different acts, and no
amount of hardening changes that. The controls in `sql/80_neon_grants.sql` and
`server/colordb.js` raise the cost of bulk extraction; they do not grant a right
to republish.
