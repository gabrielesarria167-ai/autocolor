# Paint catalogue

Builds `src/paintCatalog.js` from the colour files Sherwin-Williams Automotive
publishes for body shops: the colour compatibility guides (model, code and
name per model year) and the colour manuals (printed chips, sampled for the
on-screen swatch).

> **This is no longer the matizado page's colour list.** Colours are identified
> from the manufacturer's own database now — 68,717 of them against these 777,
> 383 makes against these 10, and no year ceiling. See
> `server/colordb/README.md`.
>
> What this file still provides is the one thing that database does not have:
> **a colour you can put on a screen.** There is no hex, RGB or L\*a\*b\* column
> anywhere in its schema, so these 528 measured chips are the only swatch the
> page can draw, and the only input the «lectura digital» ΔE search has to
> compare against. The measured finish is used too, in preference to the one
> the database derives from a colour's name.
>
> The page looks colours up here with `findColour(brandId, code)`, keyed on the
> factory code, which is unchanged. The `models` map is no longer read by
> anything: the database supplies models now. It is still built, because
> removing it from `build.py` would mean editing ten places in a script that
> cannot run without 200 MB of source PDFs, to save 2.5 KB once compressed.
> `server/mail.js` still uses this file to draw the swatch in the order email,
> so its shape and `BRAND_NAMES` must not drift.

```sh
python3 -m venv .venv && .venv/bin/pip install pdfplumber
./fetch.sh                                  # ~130 PDFs, 200 MB, outside the repo
.venv/bin/python parse_compat.py            # -> $PAINT_ASSETS/out/compat_rows.csv
.venv/bin/python parse_chips.py             # -> $PAINT_ASSETS/out/chips.csv
.venv/bin/python build.py                   # -> src/paintCatalog.js
```

`PAINT_ASSETS` defaults to `~/Downloads/claude-autocolor-assets`. The two
parsers take several minutes: the older manuals are scans.

`merge.py` holds the model-name aliases `build.py` uses (Tracker is the US
Trax, X-Trail the US Rogue…) and, run on its own, writes a coverage report of
which models have a colour list.

## What the data can and cannot say

- **US market, model years 2008–2018.** Colours launched later and models sold
  only in South America (Hilux, Onix, Sail, Groove, N300, the Brazilian Fiats)
  have no list of their own; the page falls back to the brand's colours of that
  year and says so.
- **Model lists are partial.** The compatibility guides only list colours that
  carry a compatibility note.
- **The swatch is a scanned printed chip**, darker than the real paint on
  metallics, and empty when there was no chip. It is never a formula: the shop
  mixes from its own formula software.
- The build drops codes that do not match the maker's code shape and folds
  scanning twins together, but expect the odd misread name; fix them in
  `OCR_FIXES` in `build.py` and rebuild.
