# The matizado page

`pgs/paintings.html` sells paint mixed to a factory colour to other body shops,
dealerships and workshops. `src/paintings.js` runs it. `src/paints.js` holds
the finishes, tin sizes and prices, and is also used by the server and the
emails.

## The page

Scripts, in order: `config.js`, `carModels.js`, `colourIndex.js` (the colour
database's makes and models), `paintCatalog.js` (the local 777-colour
catalogue), `paints.js`, `paintings.js`.

Four steps: **Color** («¿Qué color necesitas?»), **Cantidad** («¿Cuánta
pintura necesitas?»), **Empresa** («¿A nombre de quién va el pedido?») and
**Resumen** («Revisa tu pedido»), then a success panel.

## Two routes

Step 1 has two tabs:

- **«Por código»** (`method: code`): the customer picks the make and types the
  factory code from the car's label, or opens the finder («¿No sabes el
  código?») and picks a colour by model and year. A colour picked from the
  finder is sent as `method: model`, so the shop knows to confirm it.
- **«En el taller»** (`method: in_person`): the customer will bring the car or
  a loose part to be measured with the spectrophotometer. There is no colour,
  so there is no tin and no price yet. **Step 2 is skipped in both
  directions** and the order is really a booked visit.

`stepAfter()` and `stepBefore()` (`src/paintings.js:323-333`) are the only
places that know about the skip. `updateProgress()` marks the skipped dot
`is-skipped` with a tooltip instead of removing it, because a progress bar that
loses a dot reads as an error.

## The two colour sources

| | Colour database (server) | Local catalogue (`src/paintCatalog.js`) |
| --- | --- | --- |
| Size | 13 brands, ~28,500 colours | 10 brands, 777 colours |
| Source | The shop's Sherwin-Williams mixing data | Sherwin-Williams PDF guides, US model years 2008–2018 |
| Swatch | Computed from the tinting formula (approximate) | Measured from a printed chip |
| Finish | Inferred from the name (right ~70 % of the time) | Measured |
| Loaded | Over the network, per request | As a static file |

The database is the source of truth for **which colours exist**. The local
catalogue "decorates" database rows where it knows the same colour, and is the
**fallback** when the database is off or unreachable.

`fromDb(row, makeId)` (`:72`) turns a database row into the page's colour
object:

- it looks up the make's label, maps it to the local brand id
  (`SIDECAR_BY_LABEL`), and asks `PAINTS.findColour()` for the same code;
- `code` is the factory code, or the Sherwin code for colours with none;
- `finish` is the local catalogue's (measured) if present, else the database's
  letter mapped by `FINISH_OF` (`s`, `m`, `p`, `t`; `u` means unknown and stays
  `null`); `finishGuessed` records which;
- `hex` is the measured one if present, else the computed one; `hexMeasured`
  records which;
- `years` keeps either end even if the other is missing (a colour still on sale
  has no end year).

`codeLabel(colour)` (`:118`) prints the codes as «KBX / PBX / 12345»: the main
code, the alternates if there are at most two (ten alternates explain nothing),
single letters dropped, and the Sherwin code last, bare, so it can be copied
and pasted into the search.

## Step 1 in detail

### Searching by code: `searchByCode()` (`:582`)

1. Needs a make and a code; otherwise it explains what is missing.
2. **Without `colourIndex.js`**, it searches the local catalogue only
   (`searchLocally()`, `:548`).
3. Otherwise it calls `/api/colours/search?make=…&code=…`. A token
   (`searchToken`) discards answers to searches that were superseded.
4. Results:
   - none → «No tenemos "X" entre los colores de …», suggesting the counter;
   - one → show it;
   - several → show the first and pin the finder open on all of them
     («El código "X" tiene N versiones. Elige la de tu modelo o año.»). If
     every result is `dualTone`, the message says it is a two-tone car and
     these are two different paints.
5. On a network failure or a `503`, it falls back to `searchLocally()` and
   says so on the card. Only if that also misses does it show an error.

`searchLocally()` shows the code the customer **typed** when it matched an
alternate code, because seeing «PBX» after typing «KBX» looks like the page
changed their code.

### The colour card: `showColour()` (`:443`) and `paintFinish()` (`:469`)

The card shows the swatch, name, Sherwin name if different, brand, codes and
finish. When the finish is unknown, a row of finish chips asks for it
(«Elígelo abajo»), and step 1 is not valid until one is chosen, because the
finish multiplies the price. When the finish was inferred, the chips are shown
so it can be corrected.

### Swatches

`setSwatch(el, hex)` (`:743`) paints the hex, or a hatch pattern
(`swatch--none`) when there is none. A guessed swatch is exactly what a
customer would trust, so none is invented. The note under the card says the
swatch is only indicative, and whether it was measured or computed. The colour
is approved with a sprayed test panel.

### The finder

For customers without a label to read. Opening «¿No sabes el código?» shows:

- a model select (from `INDEX.models[makeId]`, with «Todos los modelos»
  first), a year select (next year down to 1980), and colour-family chips;
- a text filter over what is already loaded;
- a grid of tiles, «Ver más colores», and «Ver todos los colores de …» when a
  model is selected.

`requestFinder()` (`:847`) calls `/api/colours/browse`. Only the two selects
and «Ver más» trigger a request; the text filter and family chips re-filter
loaded rows (`renderFinder()`, `:906`). A token plus an `AbortController`
make sure a slow answer never overwrites a newer one, and cancel requests that
no longer matter. «Ver más» stops before the server's offset limit of 600 and
tells the customer to narrow by model or year.

`pickFromFinder(colour)` (`:1037`) copies the code into the input, shows the
card as «Elegido de la lista», and sets `state.picked`, which turns the method
into `model`.

`clearColour()` (`:419`) runs when the code is edited, the make changes, or
the route changes. It drops the chosen colour and, if the finder was pinned to
a code's versions, goes back to browsing.

## Step 2: the tin

`renderSizeCards()` (`:1145`) builds six cards once from `PAINTS.SIZES`. Each
shows a drawn can scaled by the **cube root** of its volume (twice the paint
is not twice as tall), painted in the chosen colour; the fraction; the volume;
what it is for; and the price for the chosen finish. Prices are refreshed on
every visit, because going back and changing colour can change the finish.

The order bar has a quantity stepper (1–20), the total, and a note with the
total volume. At 20 it suggests arranging a larger order directly.

## Step 3: the buyer

Company name, first and last name, and phone are required. Email is optional:
if given, the code goes there too; the phone always gets it by WhatsApp.

## Step 4: the summary

`renderSummary()` (`:1359`) builds three blocks (colour, order, company), each
with a «Cambiar» button back to its step. For an `in_person` order, the order
block says the tin and price are decided at the shop. The legal line changes
with the route and whether an email was given.

## Sending

`orderPayload()` (`:1457`):

```js
{ method: orderMethod(),            // 'model' if picked from the finder
  brand, brandId, colorCode, colorName, swCode, finish,
  reading: null,                     // kept for the API; the page no longer asks
  size, units, price,                // empty/null for in_person
  company, firstName, lastName, phone: "+51" + digits, email, notes }
```

`price` is the total the customer saw. The server stores it so the counter
knows what was promised; the price is closed when the paint is mixed.

`submitOrder()` (`:1488`) follows the same pattern as the quote wizard: no
success screen until the server confirms, a WhatsApp message if the site has no
API behind it, the server's message on other errors, and a connection message
on a network failure. `showSuccess()` words the lead for a visit or an order,
and mentions the email if one was given.

## `src/paints.js`

Loads as `window.AUTOCOLOR_PAINTS` in the browser and via `require` in Node. In
Node it `require`s `./paintCatalog.js` itself; in the browser it reads
`window.AUTOCOLOR_PAINT_CATALOG`, which must load first. `pgs/taller.html`
loads `paints.js` **without** the catalogue: the panel needs sizes, finishes and
prices, not colours.

| Export | What it is |
| --- | --- |
| `FINISHES` | `solido` ×1, `metalico` ×1.15, `perlado` ×1.35, `tricapa` ×1.6, each with a label and a one-line note. |
| `SIZES` | Six tins: `id`, `fraction`, `label`, base `price` in soles, `use`, plus computed `gallons`, `ml` (from 3,785.41 ml per US gallon) and `volume` («946 ml», «3.79 L»). |
| `MAX_UNITS` | 20. |
| `COLOURS` | The local catalogue by brand: `{ code, name, finish, hex, years, family, alt }`. |
| `BRAND_NAMES` | Local brand id → display name. |
| `FAMILIES` | The twelve colour families for the finder's chips. |
| `normalizeCode(v)` | Upper-case, keep `A-Z0-9`. «1f7», «1F7» and «1-F-7» are one code. The SQL function uses the same rule. |
| `findColour(brandId, code)` | A brand is required: Toyota's 040 is white, Mercedes' 040 is black. Checks main codes first, then alternates. |
| `modelColours(brandId, modelId)` | The colours a model wore, from the catalogue's model table. |
| `coloursOf`, `brands`, `coverage` | Listing helpers. |
| `hexToLab(hex)`, `deltaE(a, b)`, `nearest(reading, limit)`, `matchQuality(delta)` | sRGB → CIELAB (D65), CIE76 colour difference, nearest catalogue colours to a reading, and the trade's thresholds (under 1 invisible, under 2 invisible on the car, under 5 approximate). Used by the server-accepted `reading` method; the page no longer offers it. |
| `price(sizeId, finish)` | `round(size.price × finish.factor)`, or `null` if either is unknown. |
| `size(id)`, `finishLabel(id)`, `brandName(id)` | Safe lookups (`hasOwnProperty`). |
| `formatSoles(n)` | «S/ 1,250». |

`src/paintCatalog.js` is **generated** by `tools/paint-catalog/build.py`. Do
not edit it by hand. See [operations.md](operations.md#tools).
