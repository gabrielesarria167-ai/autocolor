-- Makes: the thirteen brands the shop sells, and nothing else.
--
-- Run against the local build database, after the bundle's 01-04. Nothing
-- here reaches Neon directly; 40_export.sql ships the result.
--
-- This used to be the other way round: every make in the extract was kept,
-- 383 of them, and a short override list renamed and grouped the ones that
-- mattered. That meant the catalogue carried Lada, Wartburg, Zastava, sixty
-- FLEETOWNER country books and a Pantone fan deck, none of which a body shop
-- in Peru will ever mix -- and it meant a wrong brand could swallow a search.
-- So the list is now an allow-list: a make is here because somebody wrote it
-- down, or it is not in the catalogue at all.
--
-- Note what is NOT here, because each is a real decision and not an oversight:
--
--   * The luxury and sibling marques -- Lexus and Scion (Toyota), Infiniti and
--     Datsun (Nissan), Dodge, Ram and Chrysler (Jeep's group), Alfa Romeo,
--     Lancia and Abarth (Fiat's), Seat and Skoda (Volkswagen's), Smart
--     (Mercedes). They are separate brands with separate code spaces, and the
--     shop named thirteen.
--   * Trucks and motorcycles: BMW MOTOR, MERCEDES TRUCKS, VOLKSWAGEN TRUCK,
--     CHEV. TRUCK. A Mercedes lorry's codes are not a Mercedes car's, and a
--     customer looking for a saloon should not read past them.
--
-- Adding any of them back is one line in `brand` below and a rebuild.

\set ON_ERROR_STOP on

DROP SCHEMA IF EXISTS colour CASCADE;
CREATE SCHEMA colour;

CREATE TABLE colour.make (
    make_id    smallint PRIMARY KEY,
    db_name    text     NOT NULL UNIQUE,  -- exactly as the source spells it
    group_id   smallint NOT NULL,         -- the brand this make is shown as
    label      text     NOT NULL,         -- what the page shows
    is_vehicle boolean  NOT NULL,         -- always true now; kept for the API
    sort_key   smallint NOT NULL          -- the order the shop named them in
);

-- One row per name the source uses. `lead` marks the one whose make_id the
-- whole brand groups onto -- explicit, because the alphabet would elect
-- BEIJING JEEP to speak for Jeep.
--
-- The source spells one brand several ways because the data came from several
-- markets: seven Fords, three Volkswagens. They are one brand to a customer.
CREATE TEMP TABLE brand (
    sort_key smallint, label text, db_name text, lead boolean
);
INSERT INTO brand (sort_key, label, db_name, lead) VALUES
    ( 1, 'Toyota',        'TOYOTA',                  true),
    ( 1, 'Toyota',        'TOYOTA SOUTH AFRICA',     false),
    ( 2, 'Chevrolet',     'CHEVROLET',               true),
    ( 2, 'Chevrolet',     'CHEVROLET EUROPE',        false),
    ( 3, 'Ford',          'FORD',                    true),
    ( 3, 'Ford',          'FORD USA',                false),
    ( 3, 'Ford',          'FORD ARGENTINA',          false),
    ( 3, 'Ford',          'FORD BRAZIL - ARGENTINA', false),
    ( 3, 'Ford',          'FORD SOUTH AFRICA',       false),
    ( 3, 'Ford',          'FORD AUSTRALIA',          false),
    ( 3, 'Ford',          'FORD NEW ZEALAND',        false),
    ( 4, 'Nissan',        'NISSAN',                  true),
    ( 5, 'BMW',           'BMW',                     true),
    ( 6, 'Audi',          'AUDI',                    true),
    ( 7, 'Mercedes-Benz', 'MERCEDES',                true),
    ( 7, 'Mercedes-Benz', 'MERCEDES BENZ',           false),
    ( 8, 'Subaru',        'SUBARU',                  true),
    -- Three rows and one colour, and only in the Brazilian paint lines. It was
    -- invisible until this file stopped building the make list from systems
    -- 75, 79 and 41 alone: a make that appears in no other line had no row
    -- here, so 20_subset's join dropped every link it had.
    ( 8, 'Subaru',        'SUBARU JAPAO',            false),
    ( 9, 'Jeep',          'JEEP',                    true),
    ( 9, 'Jeep',          'BEIJING JEEP',            false),
    (10, 'Fiat',          'FIAT',                    true),
    (11, 'Volkswagen',    'VOLKSWAGEN',              true),
    (11, 'Volkswagen',    'VOLKSWAGEN BRAZIL',       false),
    -- Row for row identical to VOLKSWAGEN BRAZIL, and every colour in it is
    -- already under AUDI. Listed anyway so that a future extract that makes
    -- them differ does not quietly lose the difference; SELECT DISTINCT in
    -- 20_subset means carrying it costs nothing today.
    (11, 'Volkswagen',    'VOLKSWAGEN / AUDI',       false),
    (12, 'Kia',           'KIA',                     true),
    (12, 'Kia',           'KIA MOTORS',              false),
    (13, 'Mitsubishi',    'MITSUBISHI',              true);

-- Deliberate omissions, written down so the guard below can tell them from an
-- oversight. A name here is a name somebody decided not to sell.
CREATE TEMP TABLE excluded (db_name text, why text);
INSERT INTO excluded VALUES
    ('BMW MOTOR',        'motorcycles: a different code space'),
    ('MERCEDES TRUCKS',  'lorries, not cars'),
    ('VOLKSWAGEN TRUCK', 'lorries, not cars');

-- ---------------------------------------------------------------------------
-- Guards. All three run before anything is built.
-- ---------------------------------------------------------------------------

-- Every name in the allow-list must exist in this extract, or the extract
-- changed under us and a brand is now silently half its size.
DO $$
DECLARE missing text;
BEGIN
    SELECT string_agg(b.db_name, ', ' ORDER BY b.db_name) INTO missing
    FROM brand b
    WHERE NOT EXISTS (SELECT 1 FROM vehicle_color_lookup v WHERE v.make = b.db_name);
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'allow-list names makes that are not in this extract: %', missing;
    END IF;
END $$;

-- Exactly one leader per brand, or the grouping has no fixed point.
DO $$
DECLARE bad text;
BEGIN
    SELECT string_agg(label || ' (' || n || ')', ', ') INTO bad
    FROM (SELECT label, count(*) FILTER (WHERE lead) AS n FROM brand GROUP BY label) s
    WHERE n <> 1;
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION 'brands without exactly one lead row: %', bad;
    END IF;
END $$;

-- The one that earns its keep. If the extract ever grows a FORD EUROPE or a
-- MITSUBISHI FUSO, this fails the build rather than letting the new spelling
-- fall off the edge of the catalogue unannounced. Word boundaries, so
-- FLEETOWNER SLOVAKIA does not answer to KIA.
DO $$
DECLARE strays text;
BEGIN
    SELECT string_agg(s.make, ', ' ORDER BY s.make) INTO strays
    FROM (SELECT DISTINCT make FROM vehicle_color_lookup) s
    WHERE s.make ~ ('\m(' || 'TOYOTA|CHEVROLET|FORD|NISSAN|BMW|AUDI|MERCEDES'
                           || '|SUBARU|JEEP|FIAT|VOLKSWAGEN|KIA|MITSUBISHI' || ')\M')
      AND NOT EXISTS (SELECT 1 FROM brand    b WHERE b.db_name = s.make)
      AND NOT EXISTS (SELECT 1 FROM excluded e WHERE e.db_name = s.make);
    IF strays IS NOT NULL THEN
        RAISE EXCEPTION E'this extract spells one of the thirteen brands a way nobody has ruled on: %\n'
            'Add it to brand (to sell it) or to excluded (not to), in sql/10_makes.sql.', strays;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Build
-- ---------------------------------------------------------------------------

-- make_id is assigned by name, so rebuilding the same extract gives the same
-- ids and an export can be diffed against the one before it.
INSERT INTO colour.make (make_id, db_name, group_id, label, is_vehicle, sort_key)
SELECT row_number() OVER (ORDER BY b.db_name)::smallint,
       b.db_name,
       0,                -- set below, once every row has an id
       b.label, true, b.sort_key
FROM brand b;

UPDATE colour.make m SET group_id = leader.make_id
FROM brand b
JOIN brand lb      ON lb.label = b.label AND lb.lead
JOIN colour.make leader ON leader.db_name = lb.db_name
WHERE b.db_name = m.db_name;

-- A group leader must be its own group, or api.makes() would drop the brand.
DO $$
DECLARE orphans int;
BEGIN
    SELECT count(*) INTO orphans FROM colour.make m
    WHERE NOT EXISTS (SELECT 1 FROM colour.make l
                       WHERE l.make_id = m.group_id AND l.make_id = l.group_id);
    IF orphans > 0 THEN
        RAISE EXCEPTION '% makes point at a group whose leader is itself grouped', orphans;
    END IF;
END $$;

-- Thirteen groups, no more and no fewer.
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM colour.make WHERE make_id = group_id;
    IF n <> 13 THEN RAISE EXCEPTION 'expected 13 brands, built %', n; END IF;
END $$;

CREATE INDEX make_group_idx ON colour.make (group_id);
