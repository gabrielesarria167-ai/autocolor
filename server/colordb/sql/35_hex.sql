-- A screen colour for every colour, mixed from its own tinting formula.
--
-- This database has no RGB, no hex and no L*a*b* -- not on colors, not on
-- vehicle_color_lookup, not anywhere. Without one the finder renders blank
-- tiles, which is what sent me looking. What it does have is the recipe:
-- 83,221 of 84,117 colours carry a formula, and those formulas are built from
-- 223 named pigments -- AZUL MEDIO, VERMELHO OXIDO, PRETO INTENSO, PEROLA
-- AZUL GALAXIA. Name the pigments once and the mix follows.
--
-- The recipe never leaves this machine. This step runs in the local build, and
-- only the six resulting characters are exported -- which keeps the "lookup
-- only, no formulas" decision intact while still answering "what colour is
-- it?" from the shop's own data rather than from a guess about the name.
--
-- It is an approximation and the page treats it as one: where the measured
-- catalogue in src/paints.js knows a colour, that hex wins over this one.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- sRGB <-> linear light
-- ---------------------------------------------------------------------------

-- Pigments have to be averaged in linear light. Averaging the sRGB bytes
-- directly darkens every mix, because sRGB is a curve and the midpoint of the
-- curve is not the curve of the midpoint.
CREATE OR REPLACE FUNCTION pg_temp.lin(c double precision) RETURNS double precision
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN c / 255.0 <= 0.04045 THEN (c / 255.0) / 12.92
                ELSE power((c / 255.0 + 0.055) / 1.055, 2.4) END
$$;

CREATE OR REPLACE FUNCTION pg_temp.unlin(l double precision) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
    SELECT greatest(0, least(255, round(255.0 * CASE
        WHEN l <= 0.0031308 THEN 12.92 * l
        ELSE 1.055 * power(l, 1.0 / 2.4) - 0.055 END)))::integer
$$;

-- ---------------------------------------------------------------------------
-- What each pigment looks like
-- ---------------------------------------------------------------------------

-- First match wins, so ord is the specificity order: AZUL ESCURO is dark blue
-- before it is blue. Strength is tinting strength, not opacity: a lamp black
-- at 2% of a formula moves the result further than a white at 40%, and a
-- straight average by weight would wash every dark colour out to grey.
-- NULL rgb means the product carries no colour of its own -- clears, binders,
-- hardeners, matting pastes, effect additives -- and drops out of the mix.
CREATE TEMP TABLE pigment (ord int, pattern text, r int, g int, b int, strength real);
INSERT INTO pigment VALUES
    -- Carries no colour: binders, clears, additives, hardeners.
    ( 10, '^(CLEAR|VERNIZ|SECANTE|FOSQUEANTE|PASTA FOSQUEANTE|ADITIVO|ENDURECEDOR)', NULL, NULL, NULL, 0),
    ( 11, '^(COLOR PRIMER|SHERTRUCK|SW CLEAR|LEGACY ADITIVO|BASE P/ TRICOAT)', NULL, NULL, NULL, 0),
    ( 12, 'ULTRA 9K FX|^FX ',                                    NULL, NULL, NULL, 0),

    -- Pearls: translucent, so they tint far less than their colour suggests.
    ( 20, 'PEROLA (BRANCA|MICRO WHITE|CRISTAL)',                  235, 235, 238, 0.6),
    ( 21, 'PEROLA PRATA',                                         200, 200, 206, 0.6),
    ( 22, 'PEROLA AZUL',                                           60,  95, 170, 0.9),
    ( 23, 'PEROLA VERDE|PEROLA HS VERDE',                          45, 130,  95, 0.9),
    ( 24, 'PEROLA (VERMELH|ROSA)',                                165,  45,  55, 0.9),
    ( 25, 'PEROLA VIOLETA',                                        95,  60, 140, 0.9),
    ( 26, 'PEROLA (OURO|DOURADA)',                                190, 150,  60, 0.9),
    ( 27, 'PEROLA (BRONZE|COBRE|MARROM)',                         150, 100,  60, 0.9),

    -- Aluminium flake: the grey of a metallic, unless it is a tinted flake.
    ( 30, 'ALUMINIO AZUL',                                        130, 150, 185, 1.5),
    ( 31, 'ALUMINIO ORANGE',                                      200, 140,  90, 1.5),
    ( 32, 'ALUMINIO VERMELHO',                                    190, 120, 115, 1.5),
    ( 33, '^ALUMINIO|PRATA METALICO',                             185, 188, 192, 1.5),

    -- Blacks. PRETO LAMP is lamp black, the strongest tinter in the range.
    ( 40, 'PRETO (LAMP|INTENSO|PROFUNDO|ESPECIAL)',                18,  18,  20, 6),
    ( 41, 'PRETO AZULADO',                                         20,  22,  32, 6),
    ( 42, 'PRETO GRAFITE|^GRAFITE',                                55,  58,  62, 4),
    ( 43, 'PRETO CLARO',                                           60,  60,  62, 3),
    ( 44, 'PRETO BAIXA CONCENTRA',                                 22,  22,  24, 2),
    ( 45, '^PRETO|^PU PRETO',                                      22,  22,  24, 6),

    -- Whites and white bases. Weak tinters, which is why they are 40% of a
    -- pale formula by weight and still lose to 2% of black.
    ( 50, 'BRANCO TRANSPARENTE',                                  240, 240, 238, 0.4),
    ( 51, 'BRANCO|BRANCA',                                        246, 246, 244, 1),

    -- Chromatics, most specific first.
    ( 60, 'MAGENTA',                                              205,  20, 110, 6),
    ( 61, 'VIOLETA (AZUL|AZULADO)',                                80,  55, 150, 5),
    ( 62, 'VIOLETA AVERMELHADO',                                  135,  45, 130, 5),
    ( 63, '^VIOLETA',                                             110,  50, 140, 5),
    ( 64, '^ROSA',                                                225, 120, 155, 3),

    ( 70, 'VERMELHO OXIDO|OXIDO FERRO VERMELHO',                  130,  55,  45, 2.5),
    ( 71, 'VERMELHO (CARMI|RUBI)',                                165,  20,  50, 6),
    ( 72, 'VERMELHO ESCARLATE ESCURO|VERMELHO ESCURO',            140,  25,  30, 5),
    ( 73, 'ERMELHO ESCARLATE',                                    200,  40,  35, 5),
    ( 74, 'VERMELHO (CLARO|VIVO|BRILHANTE|METALICO)',             215,  45,  40, 5),
    ( 75, 'VERMELHO BAIXA CONCENTRA',                             190,  35,  40, 2),
    ( 76, 'VERMELHO|VERM\.',                                      190,  35,  40, 5),

    ( 80, 'LARANJA (AVERM|CLARO)',                                225, 130,  60, 4),
    ( 81, 'LARANJA',                                              230, 115,  35, 4),

    ( 85, 'AMARELO OXIDO|OXIDO FERRO AMARELO|^OCRE|^PU OCRE',     190, 140,  60, 2.5),
    ( 86, 'AMARELO OURO|MARROM OURO|^OURO|^GOLD',                 200, 160,  50, 3),
    ( 87, 'AMARELO (LIMAO|ESVERDEADO)',                           225, 215,  60, 4),
    ( 88, 'AMARELO (CLARO|PALIDO|LIMPO)',                         240, 220, 110, 3),
    ( 89, 'AMARELO BAIXA CONCENTRA',                              235, 190,  35, 2),
    ( 90, 'AMARELO',                                              235, 190,  35, 4),

    ( 95, 'VERDE AMARELADO',                                      120, 160,  55, 4),
    ( 96, 'VERDE AZULADO',                                         25, 120, 120, 5),
    ( 97, 'VERDE CLARO',                                           80, 165, 110, 4),
    ( 98, 'VERDE ESCURO',                                          25,  85,  55, 5),
    ( 99, 'VERDE BAIXA CONCENTRA',                                 35, 125,  75, 2),
    (100, 'VERDE',                                                 35, 125,  75, 5),

    (105, 'AZUL ESVERDEADO',                                       20, 110, 145, 5),
    (106, 'AZUL AVERMELHADO',                                      60,  60, 160, 5),
    (107, 'AZUL CLARO',                                            95, 150, 205, 4),
    (108, 'AZUL (ESCURO|MEDIO ESCURO|OCEANO)',                     25,  50, 120, 6),
    (109, 'AZUL BAIXA CONCENTRA',                                  35,  75, 165, 2),
    (110, 'AZUL',                                                  35,  75, 165, 5),

    (115, 'MARROM CLARO|MARRON CLARO',                            150, 110,  75, 3),
    (116, 'MARROM AMARELADO|MARRON AMARELADO',                    145, 105,  50, 3),
    (117, 'MARROM|MARRON',                                        120,  80,  50, 3);

-- ---------------------------------------------------------------------------
-- Pigment name -> colour, resolved once
-- ---------------------------------------------------------------------------

-- 223 distinct names against 60 patterns, rather than half a million
-- ingredient rows against 60 patterns.
CREATE TEMP TABLE pigment_of AS
SELECT d.product_description, p.r, p.g, p.b,
       -- A transparent or translucent grind tints less than the opaque one it
       -- is named after, and the suffix is the only thing that says so. The
       -- rules above match by colour family, so the modifier belongs here,
       -- against the product's own name.
       (p.strength * CASE WHEN d.product_description ~* 'TRANSP|TRANSLUCID'
                          THEN 0.45 ELSE 1 END)::real AS strength
FROM (SELECT DISTINCT product_description FROM formula_ingredients
       WHERE product_description IS NOT NULL) d
LEFT JOIN LATERAL (
    SELECT * FROM pigment
    WHERE d.product_description ~* pigment.pattern
    ORDER BY ord LIMIT 1
) p ON true;

CREATE INDEX ON pigment_of (product_description);

\echo ''
\echo '=== pigments with no rule (these drop out of every mix) ==='
SELECT product_description FROM pigment_of
WHERE r IS NULL AND strength IS NULL ORDER BY 1;

-- ---------------------------------------------------------------------------
-- One formula per colour
-- ---------------------------------------------------------------------------

-- The current formula, not a superseded one, from the line this colour is
-- actually sold in, and its ground coat. A tricoat's mid-coat is the effect,
-- not the colour underneath, and the body colour is what the tile shows.
--
-- The line matters more than it looks. The same Sherwin code can carry an
-- unrelated recipe in a line that barely used it: Jeep's GRANITE CRYSTAL MET.
-- is a dark grey sold in 04, 44 and 94, ten rows each, and the BC8 entry under
-- the same code is four rows and a six-ingredient recipe that is 79% aluminium.
-- Picking BC8 because BC8 is usually the better line mixed it to #b4b6ba, a
-- bright silver, and put that on the tile. So: rank the lines by how much of
-- this colour each one actually carries, and only then fall back to the
-- general preference. Ingredient count breaks the remaining ties, because a
-- stub recipe is not the body colour.
CREATE TEMP TABLE sold_in AS
SELECT v.color_code, v.paint_system_number, count(*) AS rows
FROM vehicle_color_lookup v
WHERE v.color_description IS NOT NULL
   OR EXISTS (SELECT 1 FROM colors c
               WHERE c.color_id = v.color_code AND c.color_name IS NOT NULL)
GROUP BY 1, 2;

CREATE INDEX ON sold_in (color_code, paint_system_number);

CREATE TEMP TABLE formula_rank AS
SELECT f.color_code, f.formulas_id, f.paint_system_number,
       min(f.layer_number) AS layer,
       max(f.version)      AS version,
       count(*)            AS ingredients
FROM formula_ingredients f
WHERE NOT f.is_history
GROUP BY 1, 2, 3;

CREATE TEMP TABLE chosen AS
SELECT DISTINCT ON (fr.color_code) fr.color_code, fr.formulas_id
FROM formula_rank fr
LEFT JOIN sold_in si ON si.color_code = fr.color_code
                    AND si.paint_system_number = fr.paint_system_number
ORDER BY fr.color_code,
         coalesce(si.rows, 0) DESC,
         CASE fr.paint_system_number WHEN '75' THEN 1 WHEN '79' THEN 2
                                     WHEN '41' THEN 3 ELSE 4 END,
         fr.ingredients DESC,
         fr.layer,
         fr.version DESC;

CREATE INDEX ON chosen (formulas_id);

-- ---------------------------------------------------------------------------
-- The mix
-- ---------------------------------------------------------------------------

-- A weighted geometric mean, not an arithmetic one. Paint is subtractive:
-- each pigment takes light away, so reflectances multiply. Averaging them
-- instead makes every mix too pale, and badly so where a strong tint sits in
-- a white base -- Ford's GRABBER BLUE MET. is 42% white and 28% blue, and the
-- arithmetic mean rendered it #838fb5, a pastel, where the paint is a solid
-- mid blue.
--
-- The strengths above are tinting strengths, the ratios a mixer works in, and
-- multiplying already gives a dark pigment more of the result than adding
-- does. Used raw they compound: DARK SILVER MET. came out #1e1e21, a black.
-- The square root is that compression -- measured against the six colours in
-- the catalogue whose real values are known, it is the exponent that keeps
-- whites white, silvers silver and blues blue at the same time.
--
-- The floor on lin() keeps ln() finite for the blacks, which are otherwise 0
-- in the blue channel and would take every mix they appear in to black.
CREATE TEMP TABLE mixed AS
SELECT f.color_code,
       pg_temp.unlin(exp(sum(ln(greatest(pg_temp.lin(p.r), 0.0008)) * f.weight_percentage * sqrt(p.strength))
                       / sum(f.weight_percentage * sqrt(p.strength)))) AS r,
       pg_temp.unlin(exp(sum(ln(greatest(pg_temp.lin(p.g), 0.0008)) * f.weight_percentage * sqrt(p.strength))
                       / sum(f.weight_percentage * sqrt(p.strength)))) AS g,
       pg_temp.unlin(exp(sum(ln(greatest(pg_temp.lin(p.b), 0.0008)) * f.weight_percentage * sqrt(p.strength))
                       / sum(f.weight_percentage * sqrt(p.strength)))) AS b
FROM formula_ingredients f
JOIN chosen ch ON ch.formulas_id = f.formulas_id AND ch.color_code = f.color_code
JOIN pigment_of p ON p.product_description = f.product_description
WHERE p.r IS NOT NULL AND p.strength > 0 AND f.weight_percentage > 0
GROUP BY f.color_code
HAVING sum(f.weight_percentage * sqrt(p.strength)) > 0;

UPDATE colour.colour c
SET hex = '#' || lpad(to_hex(m.r), 2, '0')
               || lpad(to_hex(m.g), 2, '0')
               || lpad(to_hex(m.b), 2, '0')
FROM mixed m WHERE m.color_code = c.color_code;

-- ---------------------------------------------------------------------------
-- The ones with no formula to mix
-- ---------------------------------------------------------------------------

-- A colour with no current formula still has a name, and 30_derive.sql has
-- already read a family out of it. A representative tone for the family is a
-- poor answer and an honest one -- it says "this is a red" and no more -- and
-- it beats the blank tile, which says nothing and looks like a bug. The page
-- can tell the two apart: these are the colours where hex is set and the
-- family tone is exactly this.
UPDATE colour.colour SET hex = CASE family
    WHEN 'blanco'   THEN '#eeeeea'
    WHEN 'negro'    THEN '#1d1d1f'
    WHEN 'plata'    THEN '#b4b7bb'
    WHEN 'gris'     THEN '#75777b'
    WHEN 'rojo'     THEN '#a32a2c'
    WHEN 'azul'     THEN '#2a4c8f'
    WHEN 'verde'    THEN '#2f6d4c'
    WHEN 'amarillo' THEN '#d8ad2a'
    WHEN 'naranja'  THEN '#c86a25'
    WHEN 'marron'   THEN '#6f513a'
    WHEN 'morado'   THEN '#6b4190'
    ELSE NULL
END
WHERE hex IS NULL;

\echo ''
\echo '=== how many colours got a screen colour ==='
SELECT count(*) FILTER (WHERE color_code IN (SELECT color_code FROM mixed)) AS from_formula,
       count(*) FILTER (WHERE hex IS NOT NULL
                          AND color_code NOT IN (SELECT color_code FROM mixed)) AS from_family,
       count(*) FILTER (WHERE hex IS NULL) AS still_blank,
       round(100.0 * count(*) FILTER (WHERE hex IS NOT NULL) / count(*), 1) AS pct_with_a_colour
FROM colour.colour;

DO $$
DECLARE bad int;
BEGIN
    SELECT count(*) INTO bad FROM colour.colour
    WHERE hex IS NOT NULL AND hex !~ '^#[0-9a-f]{6}$';
    IF bad > 0 THEN RAISE EXCEPTION '% colours have a hex the page cannot render', bad; END IF;
END $$;
