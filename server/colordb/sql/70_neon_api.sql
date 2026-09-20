-- The API. These six functions are the only way in.
--
-- Every one is SECURITY DEFINER, owned by the role that owns the tables, with
-- its search_path pinned. The application role has EXECUTE on these and USAGE
-- on nothing else, so this file is the complete surface.
--
-- The limits live in the bodies rather than in the queries the application
-- writes. That is the point: a bug, a compromised application, or somebody
-- with the connection string still cannot ask for more rows than these say.

\set ON_ERROR_STOP on

-- Recreated whole rather than replaced piecemeal. CREATE OR REPLACE FUNCTION
-- keyed on the argument types, so changing a parameter's type adds an overload
-- instead of replacing the function, and later calls resolve ambiguously or to
-- the stale one. Dropping the schema makes that impossible.
DROP SCHEMA IF EXISTS api CASCADE;
CREATE SCHEMA api;

-- ---------------------------------------------------------------------------
-- The two lists the page needs to fill its selects
-- ---------------------------------------------------------------------------

-- One row per brand as a customer thinks of it, so the seven Fords are one
-- Ford. The ten the shop sells sort first. Colour standards and fleet books
-- (RAL, PANTONE, the FLEETOWNER countries) never appear.
CREATE OR REPLACE FUNCTION api.makes()
RETURNS TABLE (make_id smallint, label text, sort_key smallint)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = colour, pg_catalog
SET statement_timeout = '4s'
AS $$
BEGIN
    RETURN QUERY
    SELECT m.make_id, m.label, m.sort_key
    FROM make m
    WHERE m.is_vehicle AND m.make_id = m.group_id
    ORDER BY m.sort_key, m.label
    LIMIT 1000;
END $$;

CREATE OR REPLACE FUNCTION api.models(p_make integer)
RETURNS TABLE (model_id integer, name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = colour, pg_catalog
SET statement_timeout = '4s'
AS $$
BEGIN
    IF p_make IS NULL THEN
        RAISE EXCEPTION 'make required' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY
    SELECT mo.model_id, mo.name
    FROM model mo
    WHERE mo.group_id = p_make
    ORDER BY mo.name
    LIMIT 500;
END $$;

-- ---------------------------------------------------------------------------
-- The finder's grid
-- ---------------------------------------------------------------------------

-- A make is always required: there is no query here that returns "all the
-- colours", which is the one a scraper wants.
--
-- LIMIT 61 and not 60 on purpose. Node returns 60 and reads the 61st only as
-- "there are more", so no caller ever learns how many rows exist. The offset
-- is clamped to 600 here, in the body, where the application cannot raise it:
-- no make, model and year between them yields more than 660 rows, ever.
CREATE OR REPLACE FUNCTION api.colours_for(
    -- integer and not smallint for every one of these: Postgres will not
    -- implicitly narrow an integer literal to smallint when it resolves a
    -- function, so a smallint parameter makes api.models(12) fail with
    -- undefined_function while api.models($1) works. The columns stay
    -- smallint; only the door is wider.
    p_make  integer,
    p_model integer DEFAULT NULL,
    p_year  integer DEFAULT NULL,
    p_from  integer DEFAULT 0)
RETURNS TABLE (
    sw_code    text,
    oem_code   text,
    oem_name   text,
    sw_name    text,
    finish     "char",
    family     text,
    year_min   smallint,
    year_max   smallint,
    brand_wide boolean,
    dual_tone  boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = colour, pg_catalog
SET statement_timeout = '4s'
AS $$
DECLARE v_from integer := least(greatest(coalesce(p_from, 0), 0), 600);
BEGIN
    IF p_make IS NULL THEN
        RAISE EXCEPTION 'make required' USING ERRCODE = '22023';
    END IF;
    -- Grouped, because vehicle_colour holds one row per model. Browsing a
    -- whole make without this returns the same colour once for every model
    -- that ever wore it -- Hyundai is 8,816 rows for 2,652 colours -- and the
    -- grid fills with the same tile over and over. Grouping also means the
    -- page of 61 is 61 real colours, which matters because that page is the
    -- limit everything else is measured against.
    --
    -- The year span becomes the widest any model had it, which is the honest
    -- answer to "when did this make sell this colour".
    RETURN QUERY
    SELECT c.color_code, v.owner_code, c.oem_name, c.sw_name, c.finish, c.family,
           min(v.year_min), max(v.year_max),
           bool_and(v.model_id IS NULL), bool_or(v.dual_tone)
    FROM vehicle_colour v
    JOIN colour c ON c.color_code = v.color_code
    WHERE v.group_id = p_make
      -- The brand-level fallback. 56% of this catalogue hangs off the make
      -- rather than a model, so filtering on the model alone loses more than
      -- half of what the shop can actually mix.
      AND (p_model IS NULL OR v.model_id = p_model OR v.model_id IS NULL)
      -- A year either side counts, the same tolerance ranIn() uses in
      -- src/paintings.js: a colour is dated by model year, and a car sold in
      -- December is next year's.
      AND (p_year IS NULL
           OR (v.year_min IS NULL AND v.year_max IS NULL)
           OR (p_year BETWEEN coalesce(v.year_min, -32768)::integer - 1
                          AND coalesce(v.year_max,  32767)::integer + 1))
    GROUP BY c.color_code, v.owner_code, c.oem_name, c.sw_name, c.finish, c.family
    ORDER BY bool_and(v.model_id IS NULL), max(v.year_max) DESC NULLS LAST, c.oem_name
    OFFSET v_from LIMIT 61;
END $$;

-- ---------------------------------------------------------------------------
-- Looking a code up
-- ---------------------------------------------------------------------------

-- Equality, never a pattern. No LIKE, no prefix, no trigram: a label is read
-- exactly, and prefix search is the primitive that makes enumeration cheap.
-- The normalisation is the rule normalizeCode() uses in src/paints.js, so
-- "1f7", "1F7" and "1-F-7" are one code. It does not dig a code out of a
-- longer label: that would be a substring search, which is the enumeration
-- primitive again.
CREATE OR REPLACE FUNCTION api.colour_by_code(p_make integer, p_code text)
RETURNS TABLE (
    sw_code    text,
    oem_code   text,
    oem_name   text,
    sw_name    text,
    finish     "char",
    family     text,
    year_min   smallint,
    year_max   smallint,
    model_name text,
    brand_wide boolean,
    dual_tone  boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = colour, pg_catalog
SET statement_timeout = '4s'
AS $$
DECLARE k text := regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9]', '', 'g');
BEGIN
    IF p_make IS NULL THEN
        RAISE EXCEPTION 'make required' USING ERRCODE = '22023';
    END IF;
    IF length(k) < 2 THEN
        RAISE EXCEPTION 'code too short' USING ERRCODE = '22023';
    END IF;
    IF length(k) > 10 THEN
        RAISE EXCEPTION 'code too long' USING ERRCODE = '22023';
    END IF;
    -- Grouped for the same reason as colours_for. One factory code can still
    -- answer with several rows -- a code reused across years, or two colours
    -- that share it -- and those are worth showing, so the customer picks.
    -- The same colour repeated per model is not.
    RETURN QUERY
    SELECT c.color_code, v.owner_code, c.oem_name, c.sw_name, c.finish, c.family,
           min(v.year_min), max(v.year_max),
           -- The model of one of the rows, so the customer can recognise it.
           -- NULL when the colour is registered for the whole make.
           (array_agg(mo.name ORDER BY mo.name) FILTER (WHERE mo.name IS NOT NULL))[1],
           bool_and(v.model_id IS NULL), bool_or(v.dual_tone)
    FROM vehicle_colour v
    JOIN colour c ON c.color_code = v.color_code
    LEFT JOIN model mo ON mo.model_id = v.model_id
    WHERE v.group_id = p_make AND v.owner_key = k
    GROUP BY c.color_code, v.owner_code, c.oem_name, c.sw_name, c.finish, c.family
    ORDER BY max(v.year_max) DESC NULLS LAST, bool_and(v.model_id IS NULL)
    LIMIT 12;
END $$;

-- One colour by Sherwin's own id. The server calls this at order time to
-- re-resolve what the page claims, so the email prints what the database says
-- rather than what a form field was set to.
CREATE OR REPLACE FUNCTION api.colour(p_code text)
RETURNS TABLE (
    sw_code  text,
    oem_name text,
    sw_name  text,
    finish   "char",
    family   text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = colour, pg_catalog
SET statement_timeout = '4s'
AS $$
BEGIN
    IF p_code IS NULL OR length(p_code) > 12 THEN
        RAISE EXCEPTION 'colour code required' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY
    SELECT c.color_code, c.oem_name, c.sw_name, c.finish, c.family
    FROM colour c WHERE c.color_code = p_code
    LIMIT 1;
END $$;

-- Read from colour.meta, written once at build time. Never count(*): the size
-- of the tables is not something this API computes, and not something it says.
CREATE OR REPLACE FUNCTION api.stats()
RETURNS TABLE (
    built_at timestamptz,
    makes    integer,
    models   integer,
    colours  integer,
    links    integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = colour, pg_catalog
SET statement_timeout = '4s'
AS $$
BEGIN
    RETURN QUERY
    SELECT m.built_at, m.makes, m.models, m.colours, m.links FROM meta m LIMIT 1;
END $$;
