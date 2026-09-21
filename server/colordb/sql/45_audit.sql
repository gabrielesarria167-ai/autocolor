-- Did anything the thirteen brands say fall off the edge?
--
-- Runs after 35_hex.sql and before the export, against the build database, so
-- it can see both the extract and what was made of it. Nothing here changes a
-- row; it either passes or it stops the build.
--
-- The subset is built by a chain of joins, filters and two DELETEs, and every
-- one of them is a place where a colour can go missing without anybody
-- noticing -- which is exactly what happened before: 10_makes.sql built its
-- make list from paint systems 75, 79 and 41 only, so SUBARU JAPAO, which
-- appears in none of them, had no row there, and the join in 20_subset.sql
-- silently dropped every link it had. Nothing failed. The colour was just
-- gone. This file exists so that the next one of those is an error message.
--
-- The rule it enforces: if the extract says a brand sells a colour, and that
-- colour survived into the catalogue, then every code that brand prints for it
-- is in the catalogue too. Colours that did not survive are counted and
-- explained below, and the reasons are a closed list.

\set ON_ERROR_STOP on

-- What the extract says, for the thirteen and nobody else. Same normalisation
-- as 20_subset.sql, because the question is whether that file kept its word.
CREATE TEMP TABLE said AS
SELECT DISTINCT
       m.group_id,
       v.color_code,
       v.model,
       nullif(regexp_replace(upper(coalesce(v.owner_color_code, '')), '[^A-Z0-9]', '', 'g'), '')
           AS owner_key,
       (v.color_description IS NOT NULL
        OR EXISTS (SELECT 1 FROM colors c
                    WHERE c.color_id = v.color_code AND c.color_name IS NOT NULL)) AS has_name
FROM vehicle_color_lookup v
JOIN colour.make m ON m.db_name = v.make;

CREATE INDEX said_idx ON said (color_code, group_id);
ANALYZE said;

-- ---------------------------------------------------------------------------
-- The hard checks
-- ---------------------------------------------------------------------------

DO $$
DECLARE bad int; sample text;
BEGIN
    -- 1. Every code, for every colour that survived.
    --
    -- This is the check the customer feels. A Jeep owner reads VR847 off the
    -- door jamb; if the extract has that code against GRANITE CRYSTAL and the
    -- catalogue has the colour but not the code, the finder answers "no
    -- encontramos ese color" about a paint it is holding.
    SELECT count(*), min(s.group_id || ' ' || s.owner_key || ' -> ' || s.color_code)
      INTO bad, sample
    FROM said s
    JOIN colour.colour c ON c.color_code = s.color_code   -- survived
    WHERE s.has_name AND s.owner_key IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM colour.vehicle_colour v
                       WHERE v.group_id   = s.group_id
                         AND v.color_code = s.color_code
                         AND v.owner_key  = s.owner_key);
    IF bad > 0 THEN
        RAISE EXCEPTION 'the extract prints % codes that the catalogue cannot answer (e.g. %)',
            bad, sample;
    END IF;

    -- 2. Every brand that sells a surviving colour can still reach it. A
    --    colour kept for Ford and lost for Toyota is the same bug as above,
    --    one level up, and the join that causes it is a different one.
    SELECT count(*), min(s.group_id || ' -> ' || s.color_code) INTO bad, sample
    FROM (SELECT DISTINCT group_id, color_code FROM said WHERE has_name) s
    JOIN colour.colour c ON c.color_code = s.color_code
    WHERE NOT EXISTS (SELECT 1 FROM colour.vehicle_colour v
                       WHERE v.group_id = s.group_id AND v.color_code = s.color_code);
    IF bad > 0 THEN
        RAISE EXCEPTION '% brand-and-colour pairs the extract has are missing from the catalogue (e.g. %)',
            bad, sample;
    END IF;

    -- 3. Every model that still has a colour is still in the list. 35_hex
    --    sweeps up models whose colours all went; this catches it sweeping up
    --    one whose colours did not.
    SELECT count(*), min(s.group_id || ' ' || s.model) INTO bad, sample
    FROM (SELECT DISTINCT s.group_id, s.model FROM said s
          JOIN colour.colour c ON c.color_code = s.color_code
          WHERE s.model IS NOT NULL AND s.has_name) s
    WHERE NOT EXISTS (SELECT 1 FROM colour.model mo
                       WHERE mo.group_id = s.group_id AND mo.name = s.model);
    IF bad > 0 THEN
        RAISE EXCEPTION '% models that still have colours are missing from the list (e.g. %)',
            bad, sample;
    END IF;

    -- 4. Nothing from the other 370 makes came in through a side door.
    SELECT count(*) INTO bad FROM colour.colour c
    WHERE NOT EXISTS (SELECT 1 FROM said s WHERE s.color_code = c.color_code);
    IF bad > 0 THEN
        RAISE EXCEPTION '% colours in the catalogue belong to no brand in the allow-list', bad;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- What did not survive, and why
-- ---------------------------------------------------------------------------

-- Three reasons, and they have to add up: every colour the extract offers the
-- thirteen brands is either in the catalogue or in exactly one of these.
CREATE TEMP TABLE fate AS
WITH offered AS (
    SELECT s.color_code, bool_or(s.has_name) AS has_name
    FROM said s GROUP BY s.color_code
), named AS (
    -- The name 20_subset.sql would have chosen, for the ones it did not keep.
    SELECT v.color_code,
           coalesce(mode() WITHIN GROUP (ORDER BY v.color_description),
                    max(c.color_name)) AS oem_name,
           max(c.color_name)            AS sw_name
    FROM vehicle_color_lookup v
    JOIN colour.make m ON m.db_name = v.make
    LEFT JOIN colors c ON c.color_id = v.color_code
    WHERE NOT EXISTS (SELECT 1 FROM colour.colour k WHERE k.color_code = v.color_code)
    GROUP BY v.color_code
)
SELECT o.color_code,
       CASE
           WHEN EXISTS (SELECT 1 FROM colour.colour k WHERE k.color_code = o.color_code)
               THEN 'in the catalogue'
           WHEN NOT o.has_name
               THEN 'dropped: no name in either catalogue, so the tile would be blank'
           WHEN n.oem_name ~ '^CC[: ]' AND (n.sw_name IS NULL OR n.sw_name ~ '^CC[: ]')
               THEN 'dropped: a cross-reference to two other colours, not a paint'
           ELSE 'dropped: no formula to mix and no family in the name to guess from'
       END AS fate
FROM offered o LEFT JOIN named n ON n.color_code = o.color_code;

\echo ''
\echo '=== every colour the thirteen brands offer, and what became of it ==='
SELECT fate, count(*) AS colours,
       round(100.0 * count(*) / sum(count(*)) OVER (), 2) AS pct
FROM fate GROUP BY fate ORDER BY colours DESC;

\echo ''
\echo '=== a few of each kind that was dropped, to read by eye ==='
SELECT DISTINCT ON (f.fate) f.fate, f.color_code,
       (SELECT max(v.color_description) FROM vehicle_color_lookup v
         WHERE v.color_code = f.color_code) AS name
FROM fate f WHERE f.fate <> 'in the catalogue' ORDER BY f.fate, f.color_code;

\echo ''
\echo '=== per brand ==='
SELECT m.label,
       count(DISTINCT mo.model_id)                                       AS models,
       count(DISTINCT v.color_code)                                      AS colours,
       count(*)                                                          AS links,
       count(DISTINCT v.color_code) FILTER (WHERE v.owner_key IS NOT NULL) AS with_a_factory_code
FROM colour.make m
JOIN colour.vehicle_colour v ON v.group_id = m.make_id
LEFT JOIN colour.model mo    ON mo.model_id = v.model_id
WHERE m.make_id = m.group_id
GROUP BY m.sort_key, m.label ORDER BY m.sort_key;
