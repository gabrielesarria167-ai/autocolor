-- The rows that are not paints: two-tone cross-references, and whatever is
-- left that the page could not draw. Runs after 35_hex.sql, because it needs
-- to know which colours ended up with a swatch.

\set ON_ERROR_STOP on
\timing on

-- ---------------------------------------------------------------------------
-- Two-tone cars
-- ---------------------------------------------------------------------------

-- A "CC:" row is not a paint. It is a cross-reference naming two others --
-- "CC: TOY 8W7 / MAZ 41W" -- for a car painted two colours, and there are
-- 5,163 of them across the thirteen brands.
--
-- They used to be deleted outright, because they have no formula of their own
-- and so no colour to show, and because one of them answering a search looked
-- like a bug: a Ford customer typing AE was shown "CC: TOY 6M1 / TOY 192"
-- above GRABBER BLUE MET., which is a Toyota reference, is not a name, and is
-- not what is on the car.
--
-- But the code on the door jamb of a two-tone car IS the code on the "CC:"
-- row -- Toyota's D15, Nissan's 2H8 -- and it appears nowhere else in the
-- extract. Deleting the row took the code with it, and 4,170 codes a customer
-- could read off a car answered "no encontramos ese color". They are two-tone
-- cars, which is to say cars a body shop is more likely to be asked about,
-- not less.
--
-- So the reference is read instead of thrown away: both halves are looked up,
-- and the customer's code is attached to the real paints it stands for. Type
-- D15 against Toyota now and both components come back, flagged as a two-tone
-- so the page can say which car this is.

-- The brand tokens the references use. Only the makes actually named inside a
-- reference are here; a token that names a brand the shop does not sell is
-- still worth mapping, because the colour it points at is very often one of
-- the thirteen's as well -- the same Sherwin code, sold under two badges.
CREATE TEMP TABLE token (tok text, db_name text);
INSERT INTO token VALUES
    ('TOY',  'TOYOTA'),        ('TOY',  'TOYOTA SOUTH AFRICA'),
    ('NIS',  'NISSAN'),
    ('MIT',  'MITSUBISHI'),
    ('SUB',  'SUBARU'),        ('SUB',  'SUBARU JAPAO'),
    ('KIA',  'KIA'),           ('KIA',  'KIA MOTORS'),
    ('FIAT', 'FIAT'),
    ('BMW',  'BMW'),
    ('VW',   'VOLKSWAGEN'),    ('VW',   'VOLKSWAGEN BRAZIL'),
    ('MER',  'MERCEDES'),      ('MER',  'MERCEDES BENZ'),
    ('FORD', 'FORD'),          ('FUSA', 'FORD USA'),     ('FAUS', 'FORD AUSTRALIA'),
    -- Badges the shop does not sell, named here only to find the paint.
    ('CHRY', 'CHRYSLER USA'),  ('CHRY', 'CHRYSLER'),
    ('ALFA', 'ALFA ROMEO'),    ('MAZ',  'MAZDA'),        ('DAI',  'DAIHATSU'),
    ('HYU',  'HYUNDAI'),       ('DAEW', 'DAEWOO'),       ('REN',  'RENAULT'),
    ('GMH',  'GEN. MOTORS  HOLDEN (AUS)'),               ('GM',   'GEN. MOTORS USA'),
    ('SUZ',  'SUZUKI'),        ('POR',  'PORSCHE');

-- Every part of every reference. Two colours is the usual shape, but a few
-- name three, joined by a plus rather than a slash, so both separate.
CREATE TEMP TABLE part AS
SELECT cc.color_code AS cc_code, upper(btrim(t.part)) AS part
FROM colour.colour cc,
LATERAL unnest(regexp_split_to_array(regexp_replace(cc.oem_name, '^CC[: ]+', ''), '[/+]'))
        AS t(part)
WHERE cc.oem_name ~ '^CC[: ]';

-- A part is a brand token and a code. Splitting on whitespace is the obvious
-- reading and it is wrong often enough to matter: the extract also writes
-- "VWP3G", "FAUSCLR080" and "MITH84" with nothing between the two, and those
-- were 49 of the codes that still answered nothing. So the token is matched as
-- a prefix from the list above, longest first -- FAUS before FA, GMH before
-- GM -- and whatever follows is the code.
--
-- Longest-first is also what stops "MITH84" being read as the token MITH: no
-- such brand exists, the string is MIT and the Mitsubishi code H84, and MIT is
-- the only token that matches at all.
CREATE TEMP TABLE reference AS
SELECT DISTINCT ON (p.cc_code, p.part)
       p.cc_code, tk.tok,
       regexp_replace(substr(p.part, length(tk.tok) + 1), '[^A-Z0-9]', '', 'g') AS k
FROM part p
JOIN (SELECT DISTINCT tok FROM token) tk ON p.part LIKE tk.tok || '%'
ORDER BY p.cc_code, p.part, length(tk.tok) DESC;

-- What each half actually points at. A brand and a factory code can name more
-- than one Sherwin colour across the years; the commonest wins, the same rule
-- 20_subset.sql uses to pick a name. Only colours that survived 35_hex count:
-- pointing at one with no swatch would put the blank tile back.
CREATE TEMP TABLE resolved AS
SELECT r.cc_code, mode() WITHIN GROUP (ORDER BY v.color_code) AS target
FROM reference r
JOIN token t ON t.tok = r.tok
JOIN vehicle_color_lookup v
  ON v.make = t.db_name
 AND regexp_replace(upper(coalesce(v.owner_color_code, '')), '[^A-Z0-9]', '', 'g') = r.k
WHERE r.k <> ''
  AND EXISTS (SELECT 1 FROM colour.colour c WHERE c.color_code = v.color_code)
GROUP BY r.cc_code, r.tok, r.k;

-- The customer's code, on the paints it stands for. Every year, model and
-- brand the cross-reference was registered under carries over: the two-tone
-- was sold on a particular car in particular years, and that is what the
-- finder filters on.
INSERT INTO colour.vehicle_colour
    (group_id, model_id, year_min, year_max, owner_code, owner_key, color_code, dual_tone)
SELECT DISTINCT v.group_id, v.model_id, v.year_min, v.year_max,
       v.owner_code, v.owner_key, rs.target, true
FROM colour.vehicle_colour v
JOIN resolved rs ON rs.cc_code = v.color_code;

\echo ''
\echo '=== two-tone cross-references ==='
SELECT (SELECT count(*) FROM colour.colour WHERE oem_name ~ '^CC[: ]')       AS cross_references,
       (SELECT count(DISTINCT cc_code) FROM resolved)                        AS resolved_to_a_real_paint,
       (SELECT count(*) FROM part p
         WHERE NOT EXISTS (SELECT 1 FROM token t WHERE p.part LIKE t.tok || '%')) AS parts_naming_no_brand;

-- ---------------------------------------------------------------------------
-- Colours that are not colours
-- ---------------------------------------------------------------------------

-- A few hundred cross-references do carry a formula, and a Sherwin name with
-- it. Those are real colours wearing a reference as a label, so they keep the
-- colour and lose the label: "CC: SUB 433 / SUB 943" becomes HOT PEPPER RED
-- MET. This runs after the resolution above on purpose -- the reference is
-- worth reading whether or not the row also turns out to be a paint.
UPDATE colour.colour
SET oem_name = sw_name
WHERE oem_name ~ '^CC[: ]' AND sw_name IS NOT NULL AND sw_name !~ '^CC[: ]';

-- The rest have nothing left to show: no colour, or no name a customer could
-- read. Their links go first, or the foreign key holds them. The links the
-- resolution just made point at other colours and are not touched.
DELETE FROM colour.vehicle_colour v
USING colour.colour c
WHERE c.color_code = v.color_code
  AND (c.hex IS NULL OR c.oem_name ~ '^CC[: ]');

DELETE FROM colour.colour WHERE hex IS NULL OR oem_name ~ '^CC[: ]';

-- vehicle_colour has no key of its own, and the resolution can rebuild a link
-- that was already there -- a two-tone whose code is also printed for one of
-- its own halves. One sweep is surer than a correlated NOT EXISTS across six
-- nullable columns.
CREATE TEMP TABLE vc_once AS SELECT DISTINCT * FROM colour.vehicle_colour;
TRUNCATE colour.vehicle_colour;
INSERT INTO colour.vehicle_colour SELECT * FROM vc_once;

-- A model whose every colour has just been deleted is a dead line in the
-- finder's second select: the customer picks it and the grid comes back empty.
-- It cannot happen before this point -- a model exists because a link named it
-- -- so this is the only place that has to sweep up.
DELETE FROM colour.model mo
WHERE NOT EXISTS (SELECT 1 FROM colour.vehicle_colour v WHERE v.model_id = mo.model_id);

\echo ''
\echo '=== what is left ==='
SELECT (SELECT count(*) FROM colour.colour)         AS colours,
       (SELECT count(*) FROM colour.vehicle_colour) AS links,
       (SELECT count(*) FROM colour.model)          AS models;

-- ---------------------------------------------------------------------------
-- What the export is allowed to contain
-- ---------------------------------------------------------------------------

-- Everything above deletes. These say what has to be true once it has stopped,
-- and they are the whole of the promise the page makes: every colour it can
-- show has a name, a swatch, a brand that sells it, and a code that finds it.
DO $$
DECLARE bad int; sample text;
BEGIN
    SELECT count(*) INTO bad FROM colour.colour WHERE hex IS NULL;
    IF bad > 0 THEN RAISE EXCEPTION '% colours would ship without a swatch', bad; END IF;

    SELECT count(*) INTO bad FROM colour.colour
    WHERE oem_name IS NULL OR btrim(oem_name) = '';
    IF bad > 0 THEN RAISE EXCEPTION '% colours would ship without a name', bad; END IF;

    SELECT count(*) INTO bad FROM colour.colour WHERE oem_name ~ '^CC[: ]';
    IF bad > 0 THEN RAISE EXCEPTION '% cross-references are still being sold as paint', bad; END IF;

    SELECT count(*) INTO bad FROM colour.colour c
    WHERE NOT EXISTS (SELECT 1 FROM colour.vehicle_colour v WHERE v.color_code = c.color_code);
    IF bad > 0 THEN RAISE EXCEPTION '% colours are left with no brand that sells them', bad; END IF;

    SELECT count(*) INTO bad FROM colour.vehicle_colour v
    WHERE NOT EXISTS (SELECT 1 FROM colour.colour c WHERE c.color_code = v.color_code);
    IF bad > 0 THEN RAISE EXCEPTION '% links point at a colour that is gone', bad; END IF;

    SELECT count(*) INTO bad FROM colour.vehicle_colour v
    WHERE v.model_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM colour.model mo WHERE mo.model_id = v.model_id);
    IF bad > 0 THEN RAISE EXCEPTION '% links name a model that was swept up', bad; END IF;

    -- Reachability, stated as api.colour_by_code will apply it: the code is
    -- normalised to letters and digits and has to survive the length limits in
    -- that function, or nothing a customer can type will ever return the row.
    -- Sherwin's own code answers for every colour, so this is really a check
    -- that no Sherwin code is too short or too long to be asked for.
    SELECT count(*), min(c.color_code) INTO bad, sample
    FROM colour.colour c
    WHERE length(regexp_replace(upper(c.color_code), '[^A-Z0-9]', '', 'g')) NOT BETWEEN 2 AND 10
      AND NOT EXISTS (
          SELECT 1 FROM colour.vehicle_colour v
          WHERE v.color_code = c.color_code
            AND length(coalesce(v.owner_key, '')) BETWEEN 2 AND 10);
    IF bad > 0 THEN
        RAISE EXCEPTION '% colours cannot be reached by any code a customer could type (e.g. %)',
            bad, sample;
    END IF;
END $$;
