"""Sample the printed paint chips in the Sherwin-Williams colour manuals.

A chip page shows a grid of chip photographs; under each one, a line with
the paint code(s) and a finish marker ("BC" basecoat/clear, "3 Stage",
"SS" single stage...), and under that the colour name. Each chip has a
white hole punched in the middle, so the colour is sampled from its four
corners and the median is kept.

These are scans of printed chips: the hex is a display approximation, good
for a swatch on screen, never for mixing.
"""
import csv, os, re, statistics, sys
from pathlib import Path
import pdfplumber

sys.path.insert(0, str(Path(__file__).parent))
from parse_compat import group_of, year_of, lines_of  # noqa: E402

ASSETS = Path(os.environ.get("PAINT_ASSETS", Path.home() / "Downloads" / "claude-autocolor-assets"))
SRC = ASSETS / "sherwin-williams"
OUT = ASSETS / "out"
DPI = 72
FINISH = {"BC": "bc", "SS": "single", "3": "tricoat", "TC": "tricoat", "MC": "bc"}


def sample(img, box):
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    px = []
    for fx, fy in ((0.12, 0.15), (0.88, 0.15), (0.12, 0.85), (0.88, 0.85), (0.5, 0.12), (0.5, 0.88)):
        cx, cy = int(x0 + fx * w), int(y0 + fy * h)
        for dx in (-2, 0, 2):
            for dy in (-2, 0, 2):
                px.append(img.getpixel((cx + dx, cy + dy))[:3])
    r = statistics.median(p[0] for p in px)
    g = statistics.median(p[1] for p in px)
    b = statistics.median(p[2] for p in px)
    return "#%02x%02x%02x" % (int(r), int(g), int(b))


def parse_page(page, year, group, source):
    imgs = [im for im in page.images if 30 < im["width"] < 200 and 25 < im["height"] < 150]
    if len(imgs) < 3:
        return []
    lines = lines_of(page)
    rendered = page.to_image(resolution=DPI).original.convert("RGB")
    scale = DPI / 72
    out = []
    for im in imgs:
        below = [[w for w in ws if im["x0"] - 4 <= w["x0"] <= im["x1"] + 2]
                 for ws in lines if im["bottom"] - 2 <= ws[0]["top"] <= im["bottom"] + 30]
        below = [ws for ws in below if ws]
        if not below:
            continue
        code_line = [w for w in below[0] if im["x0"] - 4 <= w["x0"] <= im["x1"] + 2]
        if not code_line:
            continue
        toks = [t for w in code_line for t in w["text"].split(",") if t]
        finish = None
        if toks and toks[-1] in FINISH:
            finish = FINISH[toks[-1]]
            toks = toks[:-1]
        if "Stage" in toks:
            finish = "tricoat"
            toks = [t for t in toks if t not in ("3", "Stage")]
        codes = [t.strip(",") for t in toks if re.match(r"^[A-Z0-9][A-Z0-9\-/\.]*,?$", t)]
        # a bare five-digit number beside a code is Sherwin-Williams' own
        # formula number, not the maker's paint code
        if len(codes) > 1:
            codes = [c for c in codes if not re.fullmatch(r"\d{5}", c)] or codes
        if not codes:
            continue
        name = ""
        for ws in below[1:3]:
            words = [w["text"] for w in ws]
            if words and all(t in FINISH or t in ("Stage",) for t in words):
                finish = finish or ("tricoat" if "Stage" in words else FINISH[words[0]])
                continue
            name = " ".join(words)
            break
        box = (im["x0"] * scale, im["top"] * scale, im["x1"] * scale, im["bottom"] * scale)
        out.append({"year": year, "group": group, "codes": " ".join(codes), "name": name,
                    "finish": finish or "", "hex": sample(rendered, box),
                    "source": source, "page": page.page_number})
    return out


def main():
    OUT.mkdir(exist_ok=True)
    files = sorted(f for f in SRC.glob("*.pdf")
                   if re.search(r"global|colorboo|colorbook", f.name, re.I))
    if len(sys.argv) > 1:
        files = [f for f in files if any(a.lower() in f.name.lower() for a in sys.argv[1:])]
    rows = []
    for f in files:
        n = 0
        with pdfplumber.open(f) as pdf:
            for page in pdf.pages:
                text = page.extract_text() or ""
                head = text[:200]
                # the older books print the maker on a side tab, which comes
                # out at the end of the page text instead of the top
                group = group_of(head) or group_of(text[-300:])
                if not group:
                    continue
                try:
                    got = parse_page(page, year_of(head) or year_of(f.name), group, f.name)
                except Exception as e:
                    print(f"!! {f.name} p{page.page_number}: {e}")
                    continue
                rows += got
                n += len(got)
        print(f"{n:5d}  {f.name}")
    with open(OUT / "chips.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["year", "group", "codes", "name", "finish", "hex", "source", "page"])
        w.writeheader()
        w.writerows(rows)
    print("total chips", len(rows))


if __name__ == "__main__":
    main()
