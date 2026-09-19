"""Extract (year, maker group, model, paint code, colour name) rows from the
Sherwin-Williams colour compatibility guides, standalone or inside the
colour manuals.

Every guide page has a header whose English line reads roughly
"Model | Exterior (code) | Exterior (name) | Accent/... | Wheel | Interior".
The column x positions are taken from that header, and each body line that
has a word in the model column is read as one row. Accent, wheel and
interior columns are ignored: they are trim colours, not body colours.
"""
import csv, os, re, sys
from pathlib import Path
import pdfplumber

ASSETS = Path(os.environ.get("PAINT_ASSETS", Path.home() / "Downloads" / "claude-autocolor-assets"))
SRC = ASSETS / "sherwin-williams"
OUT = ASSETS / "out"

GROUPS = [  # substring of file name or page title -> maker group
    ("toyota", "toyota"), ("lexus", "toyota"), ("scion", "toyota"),
    ("gm", "gm"), ("general motors", "gm"), ("chevrolet", "gm"),
    ("ford", "ford"),
    ("nissan", "nissan"), ("infiniti", "nissan"),
    ("subaru", "subaru"),
    ("bmw", "bmw"),
    ("audi", "audi"), ("volkswagen", "audi"),
    ("mercedes", "mercedes"),
    ("fiat", "fiat"),
    ("chrysler", "chrysler"), ("jeep", "chrysler"),
]
END_HEADERS = ("Accent", "Wheel", "Underhood", "Interior", "Accent/", "Accent/Accessory")


def group_of(text):
    t = text.lower()
    for key, g in GROUPS:
        if re.search(r"(^|[^a-z])" + re.escape(key) + r"([^a-z]|$)", t):
            return g
    return None


def lines_of(page):
    rows = {}
    for w in page.extract_words(keep_blank_chars=False):
        key = round(w["top"] / 2)  # words on one line share a top within ~2pt
        rows.setdefault(key, []).append(w)
    return [sorted(ws, key=lambda w: w["x0"]) for _, ws in sorted(rows.items())]


def find_columns(lines):
    """Return (model_x, code_x, name_x, end_x, header_index) or None."""
    for i, ws in enumerate(lines):
        texts = [w["text"] for w in ws]
        if "Model" not in texts or texts.count("Exterior") < 1:
            continue
        model_x = ws[texts.index("Model")]["x0"]
        ext = [w["x0"] for w in ws if w["text"] == "Exterior"]
        # Some headers print "Exterior Color Code" and "Exterior Color Name" on
        # one line (two "Exterior"); others stack them (then read the next line).
        if len(ext) >= 2:
            code_x, name_x = ext[0], ext[1]
        else:
            code_x = ext[0]
            name_x = None
            for ws2 in lines[i:i + 3]:
                for w in ws2:
                    if w["text"] == "Name" and w["x0"] > code_x + 15:
                        name_x = w["x0"] if name_x is None else min(name_x, w["x0"])
            if name_x is None:
                continue
            # "Name" can sit after "Color"; step back to the column start
            cands = [w["x0"] for w in ws if code_x + 15 < w["x0"] <= name_x]
            name_x = min(cands) if cands else name_x
        ends = [w["x0"] for w in ws if w["text"].startswith(END_HEADERS) and w["x0"] > name_x]
        end_x = min(ends) if ends else 10_000
        return model_x, code_x, name_x, end_x, i
    return None


CODE_RE = re.compile(r"^[A-Z0-9][A-Z0-9/\-\.,]*$")


def parse_tables(page, year, group, source):
    """Guides drawn as ruled tables: read the cells, splitting stacked rows."""
    out = []
    for table in page.extract_tables():
        if not table or not table[0]:
            continue
        head = [(c or "").replace("\n", " ") for c in table[0]]
        try:
            mi = next(i for i, h in enumerate(head) if h.strip().startswith("Model"))
            ci = next(i for i, h in enumerate(head) if "Code" in h and "Accent" not in h)
            ni = next(i for i, h in enumerate(head) if "Name" in h and "Accent" not in h and i != mi)
        except StopIteration:
            continue
        for row in table[1:]:
            cells = [(row[i] or "") if i < len(row) else "" for i in (mi, ci, ni)]
            parts = [c.split("\n") for c in cells]
            n = max(len(p) for p in parts)
            if len(parts[1]) != len(parts[2]):
                continue  # a wrapped name would misalign the stack; skip it
            for k in range(n):
                model = parts[0][k] if k < len(parts[0]) else parts[0][-1]
                code = parts[1][k].strip() if k < len(parts[1]) else ""
                name = parts[2][k].strip() if k < len(parts[2]) else ""
                if model.strip() and code and name and CODE_RE.match(code.split()[0]):
                    out.append({"year": year, "group": group, "model": model.strip(),
                                "code": code, "name": name, "source": source,
                                "page": page.page_number})
    return out


def parse_page(page, year, group, source):
    rows = parse_tables(page, year, group, source)
    if rows:
        return rows
    lines = lines_of(page)
    cols = find_columns(lines)
    if not cols:
        return []
    model_x, code_x, name_x, end_x, hi = cols
    out = []
    for ws in lines[hi + 1:]:
        model = [w["text"] for w in ws if w["x0"] < code_x - 2 and abs(w["x0"] - model_x) < 60]
        code = [w["text"] for w in ws if code_x - 2 <= w["x0"] < name_x - 2]
        name = [w["text"] for w in ws if name_x - 2 <= w["x0"] < end_x - 2]
        if not model or not code or not name:
            continue
        if model[0] in ("Nom", "Nombre", "Name", "modèle", "del", "Model"):
            continue
        code_s = " ".join(code)
        if not CODE_RE.match(code[0]):
            continue
        out.append({
            "year": year, "group": group, "model": " ".join(model),
            "code": code_s, "name": " ".join(name), "source": source,
            "page": page.page_number,
        })
    return out


def year_of(text):
    m = re.search(r"(20[012]\d|199\d)", text)
    return int(m.group(1)) if m else None


def parse_file(path):
    rows = []
    fname_group = group_of(path.name.replace("_", " ").replace("-", " "))
    fname_year = year_of(path.name)
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            head = (page.extract_text() or "")[:300]
            if "Model" not in head and "Compatib" not in head:
                continue
            group = fname_group or group_of(head.split("\n")[0] + " " + head)
            # manuals mix makers: trust the page title over the file name
            if "manual" in path.name.lower() or "colorboo" in path.name.lower():
                group = group_of(head)
            year = year_of(head.split("\n")[0]) or year_of(head) or fname_year
            if not group:
                continue
            rows += parse_page(page, year, group, path.name)
    return rows


def main():
    OUT.mkdir(exist_ok=True)
    files = sorted(SRC.glob("*.pdf"))
    if len(sys.argv) > 1:
        files = [f for f in files if any(a.lower() in f.name.lower() for a in sys.argv[1:])]
    allrows = []
    for f in files:
        try:
            rows = parse_file(f)
        except Exception as e:  # a damaged scan should not stop the rest
            print(f"!! {f.name}: {e}")
            continue
        print(f"{len(rows):5d}  {f.name}")
        allrows += rows
    with open(OUT / "compat_rows.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["year", "group", "model", "code", "name", "source", "page"])
        w.writeheader()
        w.writerows(allrows)
    print("total rows", len(allrows))


if __name__ == "__main__":
    main()
