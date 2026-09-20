-- Load the export. Paths are relative: run with server/colordb as the working
-- directory, which push.sh does.
--
-- Indexes are created after the copy, not before: on 693,636 rows that is the
-- difference between a minute and several.

\set ON_ERROR_STOP on
\timing on

\copy colour.make           FROM 'export/make.csv'           WITH (FORMAT csv, HEADER true)
\copy colour.model          FROM 'export/model.csv'          WITH (FORMAT csv, HEADER true)
\copy colour.colour         FROM 'export/colour.csv'         WITH (FORMAT csv, HEADER true)
\copy colour.vehicle_colour FROM 'export/vehicle_colour.csv' WITH (FORMAT csv, HEADER true)
\copy colour.meta           FROM 'export/meta.csv'           WITH (FORMAT csv, HEADER true)

CREATE INDEX make_group_idx ON colour.make (group_id);
CREATE INDEX vc_code_idx    ON colour.vehicle_colour (group_id, owner_key);
CREATE INDEX vc_model_idx   ON colour.vehicle_colour (group_id, model_id, year_max DESC);
-- For the grouping in api.colours_for: browsing a make aggregates every row it
-- has, and this keeps that an index scan rather than a heap scan plus sort.
CREATE INDEX vc_colour_idx  ON colour.vehicle_colour (group_id, color_code, owner_key);

ANALYZE;

-- What arrived must match what was built, or a \copy was interrupted.
DO $$
DECLARE m record;
BEGIN
    SELECT * INTO m FROM colour.meta;
    IF (SELECT count(*) FROM colour.model)          <> m.models
    OR (SELECT count(*) FROM colour.colour)         <> m.colours
    OR (SELECT count(*) FROM colour.vehicle_colour) <> m.links THEN
        RAISE EXCEPTION 'loaded row counts do not match export/meta.csv';
    END IF;
END $$;
