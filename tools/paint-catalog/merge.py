"""Join the compatibility rows and the chip samples into a colour catalogue
for the models Autocolor lists (out/our_models.json), and report coverage.

Outputs, in out/:
  catalogue.json   brand -> code -> {name, codes, finish, hex, years, models}
  model_colours.json  brand -> model id -> [{code, name, from, to}]
  coverage.csv     one line per model we list: colours found, years, notes
"""
import csv, json, os, re
from collections import defaultdict, Counter
from pathlib import Path

OUT = Path(os.environ.get("PAINT_ASSETS", Path.home() / "Downloads" / "claude-autocolor-assets")) / "out"

GROUPS_FOR = {  # our brand -> Sherwin-Williams maker groups that can hold it
    "toyota": ["toyota"], "chevrolet": ["gm"], "ford": ["ford"], "subaru": ["subaru"],
    "nissan": ["nissan"], "bmw": ["bmw"], "audi": ["audi"], "mercedes": ["mercedes"],
    "fiat": ["fiat", "chrysler"], "jeep": ["chrysler"],
}
# Names the same car carries in the US market the guides cover.
ALIASES = {
    ("chevrolet", "tracker"): ["trax"],
    ("nissan", "x-trail"): ["rogue", "x trail"],
    ("nissan", "qashqai"): ["rogue sport"],
    ("nissan", "march"): ["micra"],
    ("nissan", "frontier"): ["frontier", "np300", "navara"],
    ("subaru", "crosstrek"): ["crosstrek", "xv crosstrek", "xv"],
    ("subaru", "wrx"): ["wrx", "wrx sti", "impreza wrx"],
    ("audi", "a4-avant"): ["a4 avant", "allroad", "a4 allroad"],
    ("fiat", "500"): ["500", "500c", "500 abarth"],
    ("mercedes", "cla"): ["cla", "cla class"],
    ("ford", "f-150"): ["f150", "f 150"],
    # Mercedes renamed its SUVs in 2015-16; the paint codes carried over.
    ("mercedes", "glc"): ["glc", "glc class", "glk", "glk class", "glkclass"],
    ("mercedes", "gle"): ["gle", "gle class", "ml", "ml class", "m class"],
    ("mercedes", "gls"): ["gls", "gls class", "gl class"],
    ("mercedes", "clase-e"): ["e class", "eclass"],
}
# Rows that share a guide but belong to another make's car.
EXCLUDE_FOR = {("jeep", "avenger"): {"avenger"}}  # the 2008-14 Dodge Avenger
# Different cars that merely start with one of our model names.
EXCLUDE = {"corolla im", "yaris ia", "yaris ia sedan", "rav4 ev", "corolla cross",
           "land cruiser", "500l", "500x", "grand cherokee srt", "cherokee srt"}


def norm(s):
    s = s.lower().replace("-", " ").replace("_", " ")
    s = re.sub(r"\bclass\b", "class", s)
    return re.sub(r"\s+", " ", s).strip()


def aliases_for(brand, model):
    fam = model["family"]
    al = ALIASES.get((brand, model["id"]))
    base = al if al else [fam]
    out = set()
    for a in base:
        a = norm(a)
        out.add(a)
        m = re.match(r"^(\d) series$", a)  # "3 series" == "3-series"
        if m:
            out.add(f"{m.group(1)} series")
        m = re.match(r"^([a-z]) class$", a)  # mercedes "c-class" == "c class"
        if m:
            out.add(f"{m.group(1)} class")
        if brand == "mercedes" and re.match(r"^gl[a-z]$", a):
            out.add(a + " class")
    return out


def finish_of(name, marker):
    n = name.lower()
    if marker == "tricoat" or "tri coat" in n or "tricoat" in n:
        return "tricapa"
    if re.search(r"pearl|mica|crystal|pearlcoat|nacre", n):
        return "perlado"
    if re.search(r"metallic|metal|met\b|effect|sparkle|flake", n):
        return "metalico"
    return "solido"


def code_tokens(code):
    return [t for t in re.split(r"[\s/,]+", code.strip()) if t]


def main():
    ours = json.load(open(OUT / "our_models.json"))
    compat = list(csv.DictReader(open(OUT / "compat_rows.csv")))
    chips = list(csv.DictReader(open(OUT / "chips.csv"))) if (OUT / "chips.csv").exists() else []

    # chip lookup: (group, code token) -> latest sample
    chip = {}
    for c in sorted(chips, key=lambda c: int(c["year"] or 0)):
        for t in code_tokens(c["codes"]):
            chip[(c["group"], t)] = c

    # dedupe compat rows (the site publishes some guides twice)
    seen, rows = set(), []
    for r in compat:
        key = (r["year"], r["group"], norm(r["model"]), r["code"])
        if key in seen or not r["year"]:
            continue
        seen.add(key)
        rows.append(r)

    catalogue = defaultdict(dict)
    model_colours = defaultdict(lambda: defaultdict(dict))
    coverage = []
    for b in ours:
        brand = b["id"]
        groups = GROUPS_FOR[brand]
        pool = [r for r in rows if r["group"] in groups]
        for m in b["models"]:
            als = aliases_for(brand, m)
            hits = []
            for r in pool:
                nm = norm(r["model"])
                if nm in EXCLUDE or nm in EXCLUDE_FOR.get((brand, m["id"]), ()):
                    continue
                if nm in als or any(nm.startswith(a + " ") for a in als):
                    hits.append(r)
            per = model_colours[brand][m["id"]]
            for r in hits:
                toks = code_tokens(r["code"])
                primary = toks[0]
                y = int(r["year"])
                e = per.setdefault(primary, {"code": primary, "name": r["name"], "from": y, "to": y})
                e["from"], e["to"] = min(e["from"], y), max(e["to"], y)
                if y >= e["to"]:
                    e["name"] = r["name"]
                c = catalogue[brand].setdefault(primary, {
                    "code": primary, "codes": set(), "names": Counter(), "years": set(),
                    "models": set(), "hex": None, "marker": "", "group": r["group"]})
                c["codes"].update(toks)
                c["names"][r["name"]] += 1
                c["years"].add(y)
                c["models"].add(m["id"])
            years = sorted({int(r["year"]) for r in hits})
            coverage.append({
                "brand": brand, "model": m["name"], "id": m["id"],
                "colours": len(per), "from": years[0] if years else "", "to": years[-1] if years else "",
                "matched_as": "; ".join(sorted({r["model"] for r in hits}))[:120],
            })

    # finish + hex per catalogue colour
    out_cat = {}
    for brand, cols in catalogue.items():
        out_cat[brand] = {}
        for code, c in sorted(cols.items()):
            ch = next((chip[(c["group"], t)] for t in [code, *sorted(c["codes"])] if (c["group"], t) in chip), None)
            name = c["names"].most_common(1)[0][0]
            out_cat[brand][code] = {
                "code": code, "codes": sorted(c["codes"]), "name": name,
                "finish": finish_of(name, ch["finish"] if ch else ""),
                "hex": ch["hex"] if ch else None,
                "years": [min(c["years"]), max(c["years"])],
                "models": sorted(c["models"]),
            }

    json.dump(out_cat, open(OUT / "catalogue.json", "w"), indent=1, ensure_ascii=False)
    mc = {b: {m: sorted(v.values(), key=lambda e: (-e["to"], e["code"])) for m, v in ms.items()}
          for b, ms in model_colours.items()}
    json.dump(mc, open(OUT / "model_colours.json", "w"), indent=1, ensure_ascii=False)
    with open(OUT / "coverage.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(coverage[0].keys()))
        w.writeheader()
        w.writerows(coverage)

    found = sum(1 for c in coverage if c["colours"])
    n_col = sum(len(v) for v in out_cat.values())
    n_hex = sum(1 for v in out_cat.values() for c in v.values() if c["hex"])
    print(f"models with colours: {found}/{len(coverage)}")
    print(f"catalogue colours: {n_col}, with a chip swatch: {n_hex}")
    print("no data:", ", ".join(f'{c["brand"]} {c["model"]}' for c in coverage if not c["colours"]))


if __name__ == "__main__":
    main()
