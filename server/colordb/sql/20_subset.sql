-- Models, colours and the links between vehicles and colours.
-- Runs after 10_makes.sql: the grouping has to exist before models and links
-- can be folded onto it.

\set ON_ERROR_STOP on

-- Every paint system, as a bitmask on the colour. The system is a property of
-- the product, not of the colour: the same colour appears once per system it
-- is sold in, which is what makes the raw table 1,446,130 rows for 84,117
-- colours. Dropping that dimension is most of the subset.
--
-- An earlier version of this file kept only 75, 79 and 41 and lost 16,495
-- colours doing it. The lines it dropped -- Lazzudur (04), Ultrabase (44),
-- Legacy (94), Poliuretano (15) -- are the Brazilian automotive range, which
-- for a shop in Peru is nearer the work than the two it kept. Jeep's VR847
-- (GRANITE CRYSTAL MET.) exists in 04, 44 and 94 and nowhere else, and so did
-- not exist at all; the Grand Cherokee's PSE was the same. So: keep them all,
-- and record which line a colour came from rather than deciding for the shop.
--
-- The join to colour.make is what makes this the thirteen brands' subset and
-- not the whole extract's: a make that is not in the allow-list has no row
-- there, so its rows never reach a colour, a model or a link. Every table
-- below is built from this view alone, so no colour can survive without a
-- brand that sells it.
CREATE TEMP VIEW src AS
SELECT v.*,
       m.group_id,
       CASE v.paint_system_number
           WHEN '75' THEN 1    -- ULTRA 9K
           WHEN '79' THEN 2    -- ULTRA BC8
           WHEN '41' THEN 4    -- ULTRA 9K America do Sul
           ELSE 8              -- Lazzudur, Ultrabase, Legacy, Shertruck, ...
       END AS system_bit
FROM vehicle_color_lookup v
JOIN colour.make m ON m.db_name = v.make
-- Codes with neither a description here nor a name in colors are nameless, and
-- a nameless colour is a blank tile in the grid and a blank line in the order
-- email. They are the only rows this view drops that a kept brand owns.
WHERE v.color_description IS NOT NULL
   OR EXISTS (SELECT 1 FROM colors c
               WHERE c.color_id = v.color_code AND c.color_name IS NOT NULL);

-- ---------------------------------------------------------------------------
-- Models
-- ---------------------------------------------------------------------------

CREATE TABLE colour.model (
    model_id integer  PRIMARY KEY,
    group_id smallint NOT NULL REFERENCES colour.make (make_id),
    name     text     NOT NULL,
    UNIQUE (group_id, name)
);

-- Distinct within the group, not within the make: FORD and FORD USA both list
-- a Mustang, and the page shows one Ford.
INSERT INTO colour.model (model_id, group_id, name)
SELECT row_number() OVER (ORDER BY s.group_id, s.model), s.group_id, s.model
FROM (SELECT DISTINCT group_id, model FROM src WHERE model IS NOT NULL) s;

-- ---------------------------------------------------------------------------
-- Colours
-- ---------------------------------------------------------------------------

CREATE TABLE colour.colour (
    color_code text     PRIMARY KEY,  -- Sherwin's own colour id
    oem_name   text     NOT NULL,     -- the manufacturer's name for it
    sw_name    text,                  -- Sherwin's, where colors.csv has one
    finish     "char"   NOT NULL,     -- set by 30_derive.sql
    family     text     NOT NULL,     -- set by 30_derive.sql
    hex        text,                  -- set by 35_hex.sql; NULL when unmixable
    systems    smallint NOT NULL      -- 1 U9K | 2 BC8 | 4 AdS | 8 the rest
);

-- Some codes carry more than one description, because the name belongs to the
-- make-and-code pair rather than to the code: 20246 is SCHWARZGRAU for one
-- market and GRIS OCASO MET./ECU for another. Storing the name per link row
-- instead would be exact and would copy a string across 780,000 rows to fix a
-- twentieth of one percent of them. The commonest name wins; the OEM code
-- still identifies the colour, and it is the OEM code the customer reads off
-- the label.
INSERT INTO colour.colour (color_code, oem_name, sw_name, finish, family, systems)
SELECT s.color_code,
       -- A code can have a Sherwin name and no manufacturer description; the
       -- src view already dropped the ones with neither, so one of the two is
       -- always there.
       coalesce(mode() WITHIN GROUP (ORDER BY s.color_description), max(c.color_name)),
       max(c.color_name),
       'u', 'otro',
       bit_or(s.system_bit)::smallint
FROM src s
LEFT JOIN colors c ON c.color_id = s.color_code
GROUP BY s.color_code;

-- ---------------------------------------------------------------------------
-- Vehicle to colour
-- ---------------------------------------------------------------------------

CREATE TABLE colour.vehicle_colour (
    group_id   smallint NOT NULL REFERENCES colour.make (make_id),
    model_id   integer  REFERENCES colour.model (model_id),  -- NULL: brand-level
    year_min   smallint,
    year_max   smallint,
    owner_code text,                -- the OEM code as printed on the label
    owner_key  text,                -- the same, upper case, alphanumerics only
    color_code text     NOT NULL REFERENCES colour.colour (color_code),
    dual_tone  boolean  NOT NULL
);

-- owner_key applies the same rule as normalizeCode() in src/paints.js: upper
-- case, alphanumerics only. So "1f7", "1F7" and "1-F-7" are one key. It does
-- not pull a code out of a longer label -- "C/TR: 1F7-0" normalises to
-- CTR1F70, and matches nothing, exactly as findColour() does today.
--
-- Rows that carry no OEM code at all are kept with a NULL owner code rather
-- than dropped, which is what used to make a colour unreachable by any route
-- -- Ford's 30236 (AZUL METALICO) among them. api.colour_by_code also matches
-- Sherwin's own code, so the colour is still findable, and the tile shows that
-- code when there is no factory one to show.
INSERT INTO colour.vehicle_colour
SELECT DISTINCT
       s.group_id,
       mo.model_id,
       s.year_min,
       s.year_max,
       nullif(s.owner_color_code, ''),
       nullif(regexp_replace(upper(coalesce(s.owner_color_code, '')), '[^A-Z0-9]', '', 'g'), ''),
       s.color_code,
       s.color_position = 'Dual Tone'
FROM src s
LEFT JOIN colour.model mo ON mo.group_id = s.group_id AND mo.name = s.model;

-- ---------------------------------------------------------------------------
-- What must hold before 30_derive touches any of it
-- ---------------------------------------------------------------------------

DO $$
DECLARE bad int;
BEGIN
    -- A model row must belong to the same group as its link, or the finder
    -- would offer a model under the wrong brand.
    SELECT count(*) INTO bad FROM colour.vehicle_colour v
    JOIN colour.model mo ON mo.model_id = v.model_id
    WHERE mo.group_id <> v.group_id;
    IF bad > 0 THEN RAISE EXCEPTION '% links point at a model of another make', bad; END IF;

    -- Every colour is sold by at least one of the thirteen. Building both
    -- tables from `src` alone is what guarantees it; this says so out loud, so
    -- that a later edit which widens one and not the other fails here rather
    -- than shipping tiles no brand can reach.
    SELECT count(*) INTO bad FROM colour.colour c
    WHERE NOT EXISTS (SELECT 1 FROM colour.vehicle_colour v
                       WHERE v.color_code = c.color_code);
    IF bad > 0 THEN RAISE EXCEPTION '% colours have no brand that sells them', bad; END IF;

    -- And every link lands on a colour that exists. The foreign key says this
    -- too; it is here because the count is the useful half of the message.
    SELECT count(*) INTO bad FROM colour.vehicle_colour v
    WHERE NOT EXISTS (SELECT 1 FROM colour.colour c WHERE c.color_code = v.color_code);
    IF bad > 0 THEN RAISE EXCEPTION '% links point at a colour that does not exist', bad; END IF;

    -- Nothing from outside the thirteen leaked in through a join.
    SELECT count(*) INTO bad FROM colour.vehicle_colour v
    WHERE NOT EXISTS (SELECT 1 FROM colour.make m
                       WHERE m.make_id = v.group_id AND m.make_id = m.group_id);
    IF bad > 0 THEN RAISE EXCEPTION '% links hang off something that is not a brand', bad; END IF;
END $$;

CREATE INDEX vc_code_idx  ON colour.vehicle_colour (group_id, owner_key);
CREATE INDEX vc_model_idx ON colour.vehicle_colour (group_id, model_id, year_max DESC);
-- Looking a colour up by Sherwin's own code, for the colours that carry no
-- factory code and for anyone who reads one off a mixing ticket.
CREATE INDEX vc_sw_idx    ON colour.vehicle_colour (group_id, color_code);
