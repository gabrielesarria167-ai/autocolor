"""Build src/paintCatalog.js from the rows parse_compat.py and parse_chips.py
extracted out of the Sherwin-Williams automotive colour files.

    python3 build.py            # reads $PAINT_ASSETS/out, writes ../../src/paintCatalog.js

What goes in, per brand the shop sells:

  colours   every paint code with evidence that the brand used it: a row in
            a compatibility guide on one of that make's models, or, for the
            makers that share no guide with another make (Subaru, Mercedes,
            Fiat), a chip in a colour manual. A code that only appears under
            a sister make (Lexus, Infiniti, Mini, Volkswagen, Buick, Cadillac,
            GMC, Lincoln, Dodge, Ram, Chrysler) stays out.
  models    for the models src/carModels.js lists, which of those codes each
            one wore and in which years. The guides only list the colours that
            carry a compatibility note, so a model's list is partial; the page
            says so and falls back to the brand's colours of that year.

The hex is a sample of a scanned printed chip: a swatch, never a formula.
"""
import csv, json, os, re, sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).parent
ASSETS = Path(os.environ.get("PAINT_ASSETS", Path.home() / "Downloads" / "claude-autocolor-assets"))
OUT = ASSETS / "out"
REPO = HERE.parent.parent
TARGET = REPO / "src" / "paintCatalog.js"

# Our brand -> the Sherwin-Williams groups its rows can be in, and how to tell
# its cars from a sister make's inside a shared guide.
MAKES = {
    "toyota":    {"groups": ["toyota"], "exclude": r"^(ES|IS|GS|LS|RX|NX|GX|LX|RC|LC|CT|HS|SC|UX)\s?\d*"},
    "chevrolet": {"groups": ["gm"], "exclude": r"^(Encore|Envision|Enclave|La ?Crosse|Regal|Verano|Cascada|Lucerne|"
                                               r"ATS|CTS|XTS|CT6|XT5|XT4|SRX|Escalade|ELR|DTS|STS|"
                                               r"Acadia|Terrain|Yukon|Sierra|Canyon|Savana|Envoy)"},
    "ford":      {"groups": ["ford"], "exclude": r"^(MK[A-Z]|Navigator|Continental|Town Car|Mariner|Milan|Grand Marquis)"},
    "nissan":    {"groups": ["nissan"], "exclude": r"^(Q\d|QX|G\d|M\d|EX|FX|JX|[0O]X)"},
    "bmw":       {"groups": ["bmw"], "exclude": r"(Cooper|Countryman|Clubman|Paceman|Mini|John Cooper)"},
    "audi":      {"groups": ["audi"], "exclude": r"^(Jetta|Golf|Passat|Tiguan|Touareg|Beetle|CC|Eos|Routan|GTI|Atlas|e-Golf|Arteon)"},
    "mercedes":  {"groups": ["mercedes"], "exclude": r"^(Smart|Fortwo)"},
    "subaru":    {"groups": ["subaru"], "exclude": None},
    "jeep":      {"groups": ["chrysler"], "include": r"^(Wrangler|Cherokee|Grand Cherokee|Compass|Patriot|Renegade|"
                                                     r"Liberty|Commander|Gladiator|Wagoneer)"},
    "fiat":      {"groups": ["fiat", "chrysler"], "include_in": {"chrysler": r"^(500|124)"}},
}
CHIP_ONLY_OK = {"subaru", "mercedes", "fiat"}  # groups with no sister make

sys.path.insert(0, str(HERE))


def code_tokens(code):
    return [t for t in re.split(r"[\s/,]+", code.strip()) if t]


def belongs(brand, group, model):
    """Whether a guide row for `model` is evidence for our `brand`."""
    rule = MAKES[brand]
    if group not in rule["groups"]:
        return False
    inc = rule.get("include_in", {}).get(group) or rule.get("include")
    if inc and not re.search(inc, model, re.I):
        return False
    exc = rule.get("exclude")
    return not (exc and re.search(exc, model, re.I))


def undouble(text):
    """Bold type drawn twice comes out of the PDF as "HHoott" for "Hot"."""
    def one(w):
        # four characters at least: "RR" and "II" are real, "LL66" is "L6" drawn twice
        return w[0::2] if len(w) >= 4 and len(w) % 2 == 0 and w[0::2] == w[1::2] else w
    return " ".join(one(w) for w in text.split())


def clean_code(code, brand):
    c = undouble(code).strip(" .,;:|")
    if brand == "chevrolet" and re.fullmatch(r"WA[0-9A-Z]{4}", c):
        c = c[2:]  # "WA8624" and "8624" are one GM code; WA is added back as an alias
    return c


# The shape each maker's label code takes. Anything else in a code column is
# a Sherwin-Williams formula number, a trim code or a scanning slip.
CODE_SHAPES = {
    "toyota": r"[0-9A-Z]{3}", "nissan": r"[0-9A-Z]{3}", "subaru": r"[0-9A-Z]{3}",
    "bmw": r"[0-9A-Z]{3}", "jeep": r"[0-9A-Z]{3}", "fiat": r"[0-9A-Z]{3}[A-Z]?",
    "mercedes": r"\d{3}[A-Z]?", "audi": r"[0-9A-Z]{4}|[0-9A-Z]{2}", "ford": r"[0-9A-Z]{2}|[0-9A-Z]{4}",
    "chevrolet": r"[0-9A-Z]{3,4}",
}


def usable_code(c, brand=None):
    if not re.fullmatch(r"[A-Z0-9]{1,6}", c) or re.fullmatch(r"\d{5,}", c):
        return False
    return brand is None or bool(re.fullmatch(CODE_SHAPES[brand], c))


def usable_name(n):
    return (len(n) >= 3 and re.search(r"[A-Za-z]{3}", n) and not re.search(r"[~<>|{}\[\]]", n)
            and not re.search(r"\b\d{3}[A-Z]\b|\b\d{4,}\b", n) and len(n.split()) <= 7)


OCR_FIXES = [(r"\bPean\b", "Pearl"), (r"\bPea~\b", "Pearl"), (r"\bMet\b\.?$", "Metallic"),
             (r"\bMet\b", "Metallic"), (r"\bPrl\b", "Pearl"), (r"\bPeart\b", "Pearl"), (r"\bElectnc\b", "Electric"),
             (r"\bGrazy\b", "Crazy"), (r"\bWhtte\b", "White"), (r"\bHott\b", "Hot"),
             (r"\bMetalliC\b", "Metallic"), (r"SolarbeamY ellow", "Solarbeam Yellow"), (r"\bTri-?Coat\b", "Tri-Coat"),
             (r"\s+", " ")]


def clean_name(name):
    n = undouble(name).strip().strip(",;")
    for a, b in OCR_FIXES:
        n = re.sub(a, b, n)
    # guides print some names in capitals; show them the way the rest are set
    if n.isupper() and len(n) > 3:
        n = " ".join(w.capitalize() if not re.search(r"\d", w) else w for w in n.split())
    return n.strip()


def finish_of(name, marker):
    n = name.lower()
    if marker == "tricoat" or re.search(r"tri.?coat|3.?coat|tricapa", n):
        return "tricapa"
    if re.search(r"pearl|mica|pearlcoat|nacre|perla", n):
        return "perlado"
    if re.search(r"metallic|metal|effect|sparkle|flake|crystal", n):
        return "metalico"
    return "solido"


FAMILIES = [  # a colour word decides first: "Mystic Moonlight Blue" is blue
    ("blanco", r"white|blanc|bianco|weiss|ivory|alabaster"),
    ("negro", r"black|nero|noir|schwarz"),
    ("azul", r"blue|blu|bleu|blau|azure|navy|turquoise|teal|cyan|aqua"),
    ("rojo", r"\bred\b|rosso|rouge|\brot\b|crimson|scarlet|burgundy|maroon"),
    ("verde", r"green|verde|\bvert\b|grün|olive|lime"),
    ("amarillo", r"yellow|giallo|jaune|gelb|gold"),
    ("naranja", r"orange|arancio|tangerine"),
    ("morado", r"purple|violet|plum|lilac|lavender|magenta|fuchsia"),
    ("marron", r"brown|bronze|beige|\btan\b|champagne|copper|khaki|taupe"),
    ("plata", r"silver|argent|platinum|titanium|billet|sterling|chrome|alumin"),
    ("gris", r"gr[ae]y|grau|grigio|graphite|gunmetal|charcoal"),
]
FAMILIES_WEAK = [  # evocative names with no colour word in them
    ("blanco", r"snow|frost|glacier|polar|ibis|blizzard|pearl white|winter"),
    ("negro", r"obsidian|onyx|ebony|\bjet\b|midnight|phantom|carbon|tuxedo|night"),
    ("plata", r"\bice\b|moon|quicksilver|mercury"),
    ("gris", r"granite|slate|steel|magnetic|smoke|\bash\b|shadow|tungsten|cement|stone|pewter|"
             r"iridium|sonic|storm|meteor|anvil|cerussit"),
    ("rojo", r"ruby|garnet|cherry|wine|cayenne|flame|fire|siren|velvet|merlot|salsa|chili|inferno|"
             r"blaze|lava|sangria|lobster|redline|inferno"),
    ("azul", r"ocean|marine|cobalt|sapphire|indigo|\bsky\b|denim|lagoon|pacific|atlantic|nautical|"
             r"kinetic|lightning|atoll"),
    ("verde", r"jade|emerald|mint|moss|sage|forest|cypress|jungle|army|sarge|recon|gecko|commando"),
    ("marron", r"sand|mocha|coffee|espresso|caramel|cashmere|desert|mojave|sienna|cocoa|chocolate|"
               r"umber|hazel|almond|latte|havana|adobe|ginger|cinnamon|canyon|jatoba|dune|cuprit"),
    ("amarillo", r"\bsun\b|lemon|citrus|mustard|saffron|amber"),
    ("naranja", r"mango|pumpkin|crush|vitamin"),
    ("morado", r"amethyst|grape|berr"),
]


def family_of(name, hexv):
    n = name.lower()
    for table in (FAMILIES, FAMILIES_WEAK):
        for fam, pat in table:
            if re.search(pat, n):
                return fam
    if not hexv:
        return "otro"
    r, g, b = (int(hexv[i:i + 2], 16) for i in (1, 3, 5))
    mx, mn = max(r, g, b), min(r, g, b)
    if mx < 50:
        return "negro"
    if mx - mn < 18:
        return "blanco" if mx > 215 else "gris"
    if r == mx and g < 0.6 * r:
        return "rojo"
    if b == mx:
        return "azul"
    if g == mx:
        return "verde"
    return "otro"


def our_models():
    """The brands and models the site lists, read from src/carModels.js."""
    import subprocess
    js = ("global.window=global; require(process.argv[1]);"
          "process.stdout.write(JSON.stringify(window.CAR_CATALOG.brands.map(b=>({id:b.id,name:b.name,"
          "models:b.models.map(m=>({id:m.id,name:m.name,family:m.family}))}))))")
    out = subprocess.run(["node", "-e", js, str(REPO / "src" / "carModels.js")],
                         capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def main():
    compat = list(csv.DictReader(open(OUT / "compat_rows.csv")))
    chips = list(csv.DictReader(open(OUT / "chips.csv")))
    ours = our_models()
    from merge import aliases_for, EXCLUDE, EXCLUDE_FOR, norm  # same matching as the report

    chip = {}
    for c in sorted(chips, key=lambda c: int(c["year"] or 0)):
        for t in code_tokens(c["codes"]):
            chip[(c["group"], t)] = c

    catalogue = {b: {} for b in MAKES}
    models = {b: defaultdict(dict) for b in MAKES}

    def entry(brand, group, toks, name, year):
        toks = [t for t in (clean_code(t, brand) for t in toks) if usable_code(t, brand)]
        if not toks:
            return None
        primary = toks[0]
        e = catalogue[brand].setdefault(primary, {"group": group, "codes": set(), "names": Counter(),
                                                  "from": year, "to": year})
        e["codes"].update(toks)
        if name and usable_name(clean_name(name)):
            e["names"][clean_name(name)] += 1
        e["from"], e["to"] = min(e["from"], year), max(e["to"], year)
        return primary

    # 1. codes with a model of the make behind them
    for r in compat:
        if not r["year"]:
            continue
        y = int(r["year"])
        for brand in MAKES:
            if belongs(brand, r["group"], r["model"]):
                entry(brand, r["group"], code_tokens(r["code"]), r["name"], y)

    # 2. chip-only codes, where the chip page cannot belong to a sister make
    for c in chips:
        if not c["year"]:
            continue
        for brand in CHIP_ONLY_OK:
            if c["group"] in MAKES[brand]["groups"] and c["group"] != "chrysler":
                entry(brand, c["group"], code_tokens(c["codes"]), c["name"], int(c["year"]))

    # 3. the models we list
    for b in ours:
        brand = b["id"]
        pool = [r for r in compat if r["year"] and belongs(brand, r["group"], r["model"])]
        for m in b["models"]:
            als = aliases_for(brand, m)
            for r in pool:
                nm = norm(r["model"])
                if nm in EXCLUDE or nm in EXCLUDE_FOR.get((brand, m["id"]), ()):
                    continue
                if not (nm in als or any(nm.startswith(a + " ") for a in als)):
                    continue
                code = clean_code(code_tokens(r["code"])[0], brand)
                if not usable_code(code, brand):
                    continue
                y = int(r["year"])
                e = models[brand][m["id"]].setdefault(code, [code, y, y])
                e[1], e[2] = min(e[1], y), max(e[2], y)

    # 4. scanning twins: a border read as a trailing "I", O read for Q or 0, or
    #    a primary code another, better-attested entry already lists as its own
    for brand, cols in catalogue.items():
        for code in list(cols):
            twin = None
            owners = [o for o, e in cols.items() if o != code and code in e["codes"]
                      and sum(e["names"].values()) > sum(cols[code]["names"].values())]
            if owners:
                twin = owners[0]
            elif code.endswith("I") and code[:-1] in cols:
                twin = code[:-1]
            else:
                key = re.sub(r"[OQ0]", "0", code)
                others = [c for c in cols if c != code and re.sub(r"[OQ0]", "0", c) == key]
                if others and sum(cols[code]["names"].values()) <= sum(cols[others[0]]["names"].values()):
                    twin = others[0]
            if twin and twin in cols and code in cols:
                t, e = cols[twin], cols.pop(code)
                if not owners:  # a misread twin: its code goes, its names count
                    t["names"].update(e["names"])
                    t["codes"].discard(code)
                t["from"], t["to"] = min(t["from"], e["from"]), max(t["to"], e["to"])
                for ms in models[brand].values():
                    if code in ms:
                        c, f, to = ms.pop(code)
                        prev = ms.setdefault(twin, [twin, f, to])
                        prev[1], prev[2] = min(prev[1], f), max(prev[2], to)

    # 5. finish, swatch, family; drop codes with no readable name
    out = {}
    stats = []
    for brand, cols in catalogue.items():
        rows = []
        for code, e in cols.items():
            if not e["names"]:
                continue
            name = e["names"].most_common(1)[0][0]
            if len(name) < 3 or not re.search(r"[A-Za-z]{3}", name):
                continue
            ch = next((chip[(e["group"], t)] for t in [code, *sorted(e["codes"])] if (e["group"], t) in chip), None)
            hexv = ch["hex"] if ch and ch["hex"] not in ("#ffffff", "#000000") else None
            if ch:
                e["from"] = min(e["from"], int(ch["year"]))
            # alternates are whole codes: the stubs a split cell leaves ("1G",
            # "AZ") and a table border read as a leading "I" ("IGW7") are not
            alt = set()
            for t in e["codes"]:
                if re.fullmatch(r"I[A-Z0-9]{3}", t) and t[1:] in e["codes"] | {code}:
                    continue
                if t != code and usable_code(t, brand) and len(t) >= 3:
                    alt.add(t)
            alt = sorted(alt)
            if brand == "chevrolet" and re.fullmatch(r"[0-9A-Z]{4}", code):
                alt.append("WA" + code)  # GM labels print "WA8624" for code 8624
            rows.append([code, name, finish_of(name, ch["finish"] if ch else ""), hexv or "",
                         e["from"], e["to"], family_of(name, hexv), alt])
        rows.sort(key=lambda r: (r[0]))
        out[brand] = rows
        stats.append((brand, len(rows), sum(1 for r in rows if r[3])))

    model_out = {b: {m: sorted(v.values(), key=lambda e: (-e[2], e[0])) for m, v in ms.items()}
                 for b, ms in models.items()}
    model_out = {b: ms for b, ms in model_out.items() if ms}

    data = {"colours": out, "models": model_out}
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    TARGET.write_text(HEADER + "(function (root, data) {\n"
                      '    "use strict";\n'
                      '    if (typeof module === "object" && module && module.exports) module.exports = data;\n'
                      "    else root.AUTOCOLOR_PAINT_CATALOG = data;\n"
                      '})(typeof self !== "undefined" ? self : this, ' + body + ");\n")
    for brand, n, h in stats:
        print(f"{brand:10s} {n:4d} colours, {h:4d} with swatch, {len(model_out.get(brand, {})):3d} models")
    print(f"wrote {TARGET.relative_to(REPO)} ({TARGET.stat().st_size // 1024} KB)")


HEADER = """/* =========================================================================
   paintCatalog.js — GENERATED by tools/paint-catalog/build.py. Do not edit
   by hand: fix the parser or the build rules and run it again.

   The factory paint codes of the ten brands the shop sells, taken from the
   colour compatibility guides and colour manuals Sherwin-Williams Automotive
   publishes for body shops (US market, model years 2008-2018).

     colours[brand]  [code, name, finish, hex, from, to, family, altCodes]
     models[brand][modelId]  [code, from, to] — the colours a model we list
                     wore, newest first. Partial: the guides only list the
                     colours that carry a compatibility note.

   `hex` is sampled from a scanned printed chip ("" when there is no chip). It
   is a swatch for the screen, darker than the real paint on metallics, and
   never a formula: the shop mixes from its own formula software.
   ========================================================================= */

"""

if __name__ == "__main__":
    main()
