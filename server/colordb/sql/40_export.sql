-- Export the subset. These four CSVs and this count are the only thing that
-- travels to Neon: the raw bundle would need ~1.2 GB transiently against a
-- 0.5 GB quota, and would put the recipes on the wire to get there.
--
-- Paths are relative, so run this with server/colordb as the working
-- directory. load.sh does.

\set ON_ERROR_STOP on
\timing on

CREATE TABLE colour.meta (
    built_at       timestamptz NOT NULL,
    source_version text        NOT NULL,
    makes          integer     NOT NULL,
    models         integer     NOT NULL,
    colours        integer     NOT NULL,
    links          integer     NOT NULL
);

-- Counted once, here, so api.stats() never has to run count(*) on Neon.
INSERT INTO colour.meta
SELECT now(),
       '202606081414',
       (SELECT count(*) FROM colour.make WHERE is_vehicle AND make_id = group_id),
       (SELECT count(*) FROM colour.model),
       (SELECT count(*) FROM colour.colour),
       (SELECT count(*) FROM colour.vehicle_colour);

\copy (SELECT make_id, db_name, group_id, label, is_vehicle, sort_key FROM colour.make ORDER BY make_id) TO 'export/make.csv' WITH (FORMAT csv, HEADER true)
\copy (SELECT model_id, group_id, name FROM colour.model ORDER BY model_id) TO 'export/model.csv' WITH (FORMAT csv, HEADER true)
\copy (SELECT color_code, oem_name, sw_name, finish, family, hex, systems FROM colour.colour ORDER BY color_code) TO 'export/colour.csv' WITH (FORMAT csv, HEADER true)
\copy (SELECT group_id, model_id, year_min, year_max, owner_code, owner_key, color_code, dual_tone FROM colour.vehicle_colour ORDER BY group_id, model_id NULLS LAST, color_code) TO 'export/vehicle_colour.csv' WITH (FORMAT csv, HEADER true)
\copy (SELECT built_at, source_version, makes, models, colours, links FROM colour.meta) TO 'export/meta.csv' WITH (FORMAT csv, HEADER true)

\echo ''
\echo '=== what was built ==='

SELECT 'makes (groups shown to the customer)' AS what, makes  AS n FROM colour.meta
UNION ALL SELECT 'make names in the source', (SELECT count(*) FROM colour.make)
UNION ALL SELECT 'not vehicles (RAL, PANTONE, FLEETOWNER...)', (SELECT count(*) FROM colour.make WHERE NOT is_vehicle)
UNION ALL SELECT 'models',  models  FROM colour.meta
UNION ALL SELECT 'colours', colours FROM colour.meta
UNION ALL SELECT 'links',   links   FROM colour.meta;

\echo ''
\echo '=== where the screen colour came from ==='
SELECT CASE WHEN hex IS NULL THEN 'none' ELSE 'mixed from the formula' END AS source,
       count(*) AS colours
FROM colour.colour GROUP BY 1 ORDER BY colours DESC;

\echo ''
\echo '=== finish, as derived ==='
SELECT CASE finish WHEN 's' THEN 'solido' WHEN 'm' THEN 'metalico'
                   WHEN 'p' THEN 'perlado' WHEN 't' THEN 'tricapa'
                   ELSE 'sin nombre que leer' END AS finish,
       count(*) AS colours,
       round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct
FROM colour.colour GROUP BY finish ORDER BY colours DESC;

\echo ''
\echo '=== family, as derived ==='
SELECT family, count(*) AS colours,
       round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct
FROM colour.colour GROUP BY family ORDER BY colours DESC;
