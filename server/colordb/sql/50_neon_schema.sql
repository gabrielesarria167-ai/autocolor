-- The published schema. Tables only; 60_neon_load.sql fills them.
--
-- Two schemas, and the split is what makes "reachable only through functions"
-- real rather than a convention. The tables live in `colour`, the functions in
-- `api`, and the application role is never granted USAGE on `colour`. It
-- cannot name a table, so there is no query for it to write, no LIMIT for it
-- to leave off, and nothing for it to read out of information_schema.

\set ON_ERROR_STOP on

DROP SCHEMA IF EXISTS api CASCADE;
DROP SCHEMA IF EXISTS colour CASCADE;
CREATE SCHEMA colour;
-- Schema api is created by 70_neon_api.sql, which owns it.

CREATE TABLE colour.make (
    make_id    smallint PRIMARY KEY,
    db_name    text     NOT NULL UNIQUE,
    group_id   smallint NOT NULL,
    label      text     NOT NULL,
    is_vehicle boolean  NOT NULL,
    sort_key   smallint NOT NULL
);

CREATE TABLE colour.model (
    model_id integer  PRIMARY KEY,
    group_id smallint NOT NULL REFERENCES colour.make (make_id),
    name     text     NOT NULL,
    UNIQUE (group_id, name)
);

CREATE TABLE colour.colour (
    color_code text     PRIMARY KEY,
    oem_name   text     NOT NULL,
    sw_name    text,
    finish     "char"   NOT NULL,   -- s solid | m metallic | p pearl | t tricoat | u unknown
    family     text     NOT NULL,   -- a FAMILIES id from src/paints.js
    systems    smallint NOT NULL    -- 1 U9K | 2 BC8 | 4 America do Sul
);

CREATE TABLE colour.vehicle_colour (
    group_id   smallint NOT NULL REFERENCES colour.make (make_id),
    model_id   integer  REFERENCES colour.model (model_id),
    year_min   smallint,
    year_max   smallint,
    owner_code text     NOT NULL,
    owner_key  text     NOT NULL,
    color_code text     NOT NULL REFERENCES colour.colour (color_code),
    dual_tone  boolean  NOT NULL
);

-- Counted at build time so api.stats() never runs count(*) on a table this
-- size, and so the row count is never something the API computes on demand.
CREATE TABLE colour.meta (
    built_at       timestamptz NOT NULL,
    source_version text        NOT NULL,
    makes          integer     NOT NULL,
    models         integer     NOT NULL,
    colours        integer     NOT NULL,
    links          integer     NOT NULL
);
