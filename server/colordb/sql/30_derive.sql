-- Finish and family, derived from the colour's name.
--
-- Neither is in this database. solid_type and color_family exist as columns on
-- vehicle_color_lookup and are empty on every row of systems 75, 79 and 41;
-- formulas.solid_type is empty for them too. What does carry a signal is
-- colors.color_name, which suffixes MET / PEARL / MICA / NACRE / 3C.
--
-- Of 68,791 codes, 41,299 carry a marker, 19,022 have a name and no marker and
-- so read as solid, and 8,470 have no name at all. Measured against
-- src/paintCatalog.js where both know a colour, that agrees exactly 70% of the
-- time and on the solid-versus-effect axis 89% of the time.
--
-- The finish multiplies the price in src/paints.js, so a wrong guess is a
-- wrong quote. That is why the page lets the customer correct it rather than
-- treating this as fact.

\set ON_ERROR_STOP on

-- Sherwin's name where there is one, the manufacturer's otherwise.
CREATE TEMP VIEW named AS
SELECT color_code, coalesce(sw_name, oem_name) AS txt, sw_name IS NOT NULL AS has_sw
FROM colour.colour;

-- Tricoat first: a three-coat colour usually also says PEARL, and it is the
-- more specific and the more expensive of the two.
UPDATE colour.colour c SET finish = CASE
    WHEN n.txt ~* '(^|[ .])3C([ .]|$)|TRICOAT|3 COAT|TRIPLO STRATO|TRICAPA' THEN 't'
    WHEN n.txt ~* 'PEARL|PEROLA|MICA|NACRE|XIRALL|PERLAD'                   THEN 'p'
    WHEN n.txt ~* '(^|[ .])MET([ .]|$)|METALLIC|METALIC|METALIZ'            THEN 'm'
    WHEN n.has_sw                                                           THEN 's'
    ELSE 'u'
END
FROM named n WHERE n.color_code = c.color_code;

-- Family, for the finder's tone chips. The ids are the ones in FAMILIES in
-- src/paints.js, so the page can keep the chips it already renders. The names
-- arrive in half a dozen languages, which is why each family lists its
-- English, Spanish, Portuguese, Italian, German and French forms.
--
-- First match wins, so the order is the specificity order: a GRIS PERLE is
-- grey before it is anything else.
--
-- German writes a colour name as one word -- TORNADOROT, ACAPULCOBLAU,
-- ACHATGRAU, IMOLAGELB -- and the word-boundary guards below used to miss
-- every one of them, which left 1,627 German colours in 'otro' with no chip to
-- filter by and, for thirteen of them, no family tone to fall back on when the
-- formula would not mix, so they were dropped from the catalogue outright.
-- Hence the [A-Z] prefix forms: they match the suffix of a compound and not a
-- bare word, so they add ACHATGRAU without letting GRAU loose inside unrelated
-- text. WEISS, SCHWARZ, BRAUN, GRUEN and SILBER never had the guard and were
-- always matching as suffixes; this makes the other four behave the same.
UPDATE colour.colour c SET family = CASE
    WHEN n.txt ~* 'WHITE|BLANC|BIANCO|BRANCO|WEISS|\yWEIS\y|\yIVORY|MARFIL|\yAVORIO' THEN 'blanco'
    WHEN n.txt ~* 'BLACK|NEGRO|\yNERO\y|PRETO|SCHWARZ|\yNOIR\y'                  THEN 'negro'
    WHEN n.txt ~* 'SILVER|PLATA|PLATEAD|ARGENT|PRATA|SILBER'                     THEN 'plata'
    WHEN n.txt ~* 'GREY|GRAY|\yGRIS\y|GRIGIO|CINZA|\yGRAU\y|[A-Z]GRAU\y'         THEN 'gris'
    WHEN n.txt ~* 'RED|ROJO|ROSSO|VERMELH|\yROT\y|[A-Z]ROT\y|ROUGE|BURGUND|BORDO|GRANATE|CARMIN|\yRUBI|\yVINHO|\yVINO\y' THEN 'rojo'
    WHEN n.txt ~* 'BLUE|AZUL|\yBLU\y|\yBLAU\y|[A-Z]BLAU\y|\yBLEU\y|TURQ|CYAN|CELESTE|\yAQUA' THEN 'azul'
    WHEN n.txt ~* 'GREEN|VERDE|GRUEN|GR.N|\yVERT\y|\yOLIV'                        THEN 'verde'
    WHEN n.txt ~* 'YELLOW|AMARILL|GIALLO|AMARELO|\yGELB\y|[A-Z]GELB\y|JAUNE|GOLD|DORAD|\yORO\y|\yOURO\y' THEN 'amarillo'
    WHEN n.txt ~* 'ORANGE|NARANJ|ARANCIO|LARANJA|\yDAMASCO|\yAPRIKOSEN?\y'        THEN 'naranja'
    WHEN n.txt ~* 'BROWN|MARRON|MARRONE|\yBRUN|BEIGE|BRAUN|BRONZ|BRONCE|\yTAN\y|\yCAFE|CHOCOLAT|CASTANH|\yARENA\y|\ySAND\y|CHAMPAGNE|\yOCRE|\yOCHRE|\yCASHEW' THEN 'marron'
    WHEN n.txt ~* 'PURPLE|VIOLET|VIOLA|MORADO|\yLILA|\yROXO|MAGENTA|\yPINK\y|\yROSA\y|\yROSE\y|FUCSIA|FUCHSIA' THEN 'morado'
    ELSE 'otro'
END
FROM named n WHERE n.color_code = c.color_code;

-- The page renders chips from FAMILIES in src/paints.js. A family id invented
-- here would render as no chip at all, silently.
DO $$
DECLARE stray text;
BEGIN
    SELECT string_agg(DISTINCT family, ', ') INTO stray FROM colour.colour
    WHERE family NOT IN ('blanco','negro','plata','gris','rojo','azul','verde',
                         'marron','amarillo','naranja','morado','otro');
    IF stray IS NOT NULL THEN
        RAISE EXCEPTION 'family ids the page cannot render: %', stray;
    END IF;
END $$;

DO $$
DECLARE stray text;
BEGIN
    SELECT string_agg(DISTINCT finish::text, ', ') INTO stray FROM colour.colour
    WHERE finish NOT IN ('s','m','p','t','u');
    IF stray IS NOT NULL THEN RAISE EXCEPTION 'unknown finish codes: %', stray; END IF;
END $$;
