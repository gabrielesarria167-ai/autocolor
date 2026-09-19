# Paint catalogue

Builds `src/paintCatalog.js`, the factory paint codes behind the matizado page
(`pgs/paintings.html`), from the colour files Sherwin-Williams Automotive
publishes for body shops: the colour compatibility guides (model, code and
name per model year) and the colour manuals (printed chips, sampled for the
on-screen swatch).

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
