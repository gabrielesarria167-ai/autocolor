-- =============================================================================
-- Autocolor: schema of the `autocolor` database
--
-- Create the database (once) and then apply this file:
--
--     createdb autocolor
--     psql -v ON_ERROR_STOP=1 -d autocolor -f server/schema.sql
--
-- The file is idempotent: it can be applied again without losing data.
-- =============================================================================

-- Statuses a request goes through, in order of progress. They are stored as
-- text with a CHECK instead of an ENUM so adding a new status is an ALTER
-- TABLE and not a type migration.
CREATE TABLE IF NOT EXISTS requests (
    -- The 10-digit code handed to the customer when the form is sent. It is
    -- the primary key and also the only credential for looking up the
    -- request, which is why it is generated at random (see server/db.js) and
    -- not sequentially: a sequential code would let other customers' data be
    -- guessed by trying neighbouring numbers.
    id          char(10)    PRIMARY KEY CHECK (id ~ '^[0-9]{10}$'),

    -- The vehicle as the customer described it in step 1. Make and model are
    -- stored with the name shown on screen, not the catalogue id
    -- (src/carModels.js): the workshop reads this table and 'Yaris Sedán'
    -- tells it more than 'yaris-sedan'. They are NULL only on requests from
    -- before the wizard asked for them.
    brand       text,
    model       text,
    body_type   text        CHECK (body_type IN ('sedan', 'hatchback', 'coupe', 'wagon',
                                                 'suv', 'pickup', 'minivan', 'van')),
    model_year  integer     CHECK (model_year BETWEEN 1980 AND 2100),
    plate       text        CHECK (plate ~ '^[A-Z0-9]{3}-[A-Z0-9]{3}$'),
    mileage     integer     CHECK (mileage >= 0),
    color_code  text,

    -- The 3D silhouette the panels were picked on. It follows from body_type
    -- (see BODY_TYPES in src/carModels.js) because there are four 3D models
    -- and eight bodies: a sedan is painted on the 'wagon' silhouette, and a
    -- minivan on the 'van'.
    vehicle     text        NOT NULL CHECK (vehicle IN ('van', 'wagon', 'pickup', 'suv')),
    quality     text        NOT NULL CHECK (quality IN ('standard', 'premium', 'custom')),
    -- The panel ids the 3D viewer uses ('hood', 'rear_door_left', and so on).
    -- They differ per model, so they are stored as they arrive, as an array: a
    -- request stays a single row and the workshop sees the panels at a
    -- glance. Their Spanish labels live in src/parts.js.
    parts       text[]      NOT NULL DEFAULT '{}',

    -- Datos de contacto (paso 4). Only name, surname and phone are NOT NULL
    -- here, for rows older than the current rules; the wizard and the server
    -- (WIZARD_REQUIRED) also require email, department and province.
    first_name  text        NOT NULL CHECK (length(btrim(first_name)) > 0),
    last_name   text        NOT NULL CHECK (length(btrim(last_name)) > 0),
    department  text,
    province    text,
    phone       text        NOT NULL,   -- guardado como +51 y 9 dígitos
    email       text,
    notes       text,

    -- This list has the last word on statuses: the four the customer sees
    -- ('recibido', 'listo', 'entregado', 'cancelado') and the seven stages
    -- the workshop moves the job through in between. It is repeated in two
    -- other places that cannot read it: STATUSES in server/server.js
    -- (validates what comes in through PATCH) and src/statuses.js (what the
    -- customer sees). Touching the list means those two plus a migration on
    -- this CHECK, because CREATE TABLE IF NOT EXISTS does not touch it on a
    -- table that already exists.
    status      text        NOT NULL DEFAULT 'recibido'
                            CHECK (status IN ('recibido',
                                              'planchado', 'desmontaje_montaje',
                                              'pintura', 'preparacion', 'cuadrada',
                                              'cristales', 'finitura',
                                              'listo', 'entregado', 'cancelado')),

    -- Which workers have the vehicle in their hands, by code (AB12345), or
    -- empty when it is available. It is what the panel's «Ocupado» column
    -- paints; the readable name is derived from the code in server/names.js.
    -- Any of its holders can release it or change its status, and that is
    -- enforced by the queries in server/db.js, not by the browser.
    --
    -- An array and not a text column because a vehicle is painted by a pair:
    -- two people at a time at most, which is what the CHECK says and what
    -- occupyRequest checks again before adding anybody (MAX_HOLDERS in
    -- server/db.js). The ceiling lives here and not only in the server because
    -- it is a rule of the workshop, not of one screen.
    --
    -- The CHECK on the shape of the codes reads the array joined by commas: a
    -- subquery (an unnest() with bool_and) is not allowed inside a CHECK,
    -- and with two elements at most the regular expression says the same
    -- thing. `array_position(..., NULL)` keeps out a stray NULL, which
    -- array_to_string would skip without a word, and comparing the two
    -- elements stops one person from occupying the vehicle twice (two
    -- entries, but a single person). That last comparison is only asked of an
    -- array that HAS two: on an empty one both subscripts read NULL, and
    -- `IS DISTINCT FROM` would call an available vehicle invalid.
    occupied_by text[]      NOT NULL DEFAULT '{}'
                            CHECK (cardinality(occupied_by) <= 2
                                   AND array_position(occupied_by, NULL) IS NULL
                                   AND (cardinality(occupied_by) < 2 OR occupied_by[1] <> occupied_by[2])
                                   AND array_to_string(occupied_by, ',') ~
                                       '^([A-Z]{2}[0-9]{5}(,[A-Z]{2}[0-9]{5})?)?$'),

    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- The vehicle columns arrived after the first requests, so for an existing
-- database they are added here. On a new database the CREATE above already
-- has them and these ALTERs do nothing.
ALTER TABLE requests ADD COLUMN IF NOT EXISTS brand      text;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS model      text;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS body_type  text
    CHECK (body_type IN ('sedan', 'hatchback', 'coupe', 'wagon',
                         'suv', 'pickup', 'minivan', 'van'));
ALTER TABLE requests ADD COLUMN IF NOT EXISTS model_year integer
    CHECK (model_year BETWEEN 1980 AND 2100);
ALTER TABLE requests ADD COLUMN IF NOT EXISTS plate      text
    CHECK (plate ~ '^[A-Z0-9]{3}-[A-Z0-9]{3}$');
ALTER TABLE requests ADD COLUMN IF NOT EXISTS mileage    integer
    CHECK (mileage >= 0);
ALTER TABLE requests ADD COLUMN IF NOT EXISTS color_code text;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS occupied_by text[] NOT NULL DEFAULT '{}';


-- `occupied_by` used to be a single text column: a vehicle was held by one
-- person or by nobody. Two of them paint it now, so it becomes an array and
-- whatever it held turns into the array of one element.
--
-- It goes in a DO because ALTER COLUMN ... TYPE has no IF: applied twice, the
-- USING below would wrap a text[] inside another one. The column's type is
-- what says whether the conversion already happened.
--
-- The old CHECK is dropped before converting: it names `occupied_by ~ '…'`,
-- and the ~ operator does not exist for an array, so the revalidation the
-- ALTER itself runs would fail. The new one is added afterwards, outside the
-- block, so a database that was already converted gets it too.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'requests'
                  AND column_name = 'occupied_by'
                  AND data_type <> 'ARRAY') THEN
        ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_occupied_by_check;
        ALTER TABLE requests
            ALTER COLUMN occupied_by TYPE text[]
            USING CASE WHEN occupied_by IS NULL THEN '{}'::text[] ELSE ARRAY[occupied_by] END;
        ALTER TABLE requests ALTER COLUMN occupied_by SET DEFAULT '{}';
        ALTER TABLE requests ALTER COLUMN occupied_by SET NOT NULL;
    END IF;
END $$;

ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_occupied_by_check;
ALTER TABLE requests ADD CONSTRAINT requests_occupied_by_check
    CHECK (cardinality(occupied_by) <= 2
           AND array_position(occupied_by, NULL) IS NULL
           AND (cardinality(occupied_by) < 2 OR occupied_by[1] <> occupied_by[2])
           AND array_to_string(occupied_by, ',') ~
               '^([A-Z]{2}[0-9]{5}(,[A-Z]{2}[0-9]{5})?)?$');


-- There was a 'suv' silhouette that was renamed 'pickup' when the two bodies
-- were split: the 3D model back then was always a pickup's (a double-cab
-- Hilux), so those requests refer to the same file and are renamed.
--
-- CAREFUL with the date cutoff, which is not decorative. Today 'suv' exists
-- again and this time it is real: its own 3D model, with its own panels.
-- Without the cutoff, every `npm run db:schema` would rewrite every new SUV
-- request to 'pickup', and its panels ('tailgate', 'rear_bumper') do not
-- exist on the pickup, so the workshop would see a list that cannot be
-- drawn. The date is that of the commit that added the model: before it
-- there was no real SUV to protect.
--
-- It carries the time zone written in. Without it, Postgres resolves the date
-- in the session's TimeZone, and the cutoff lands five hours later when this
-- is applied from the work machine (America/Lima) than against Neon (UTC): a
-- real SUV created in that window would be rewritten to 'pickup', which is
-- exactly what the cutoff exists to prevent.
--
-- The CHECK is dropped before the UPDATE: the old database's does not name
-- 'suv' and would reject the new rows.
ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_vehicle_check;
UPDATE requests SET vehicle = 'pickup'
 WHERE vehicle = 'suv' AND created_at < timestamptz '2026-09-04 00:00+00';
ALTER TABLE requests ADD CONSTRAINT requests_vehicle_check
    CHECK (vehicle IN ('van', 'wagon', 'pickup', 'suv'));


-- 'presupuestado' and 'en_taller' were retired when the workshop asked to
-- name its seven real stages. Requests left sitting in either are moved to
-- the closest new status: what had been quoted had not yet entered the shop,
-- so it goes back to 'recibido'; what was «in the workshop» moves to
-- 'desmontaje_montaje', which is where the work inside begins.
--
-- The date cutoff the vehicle rename above carries is not needed here: those
-- two names will never exist again, so a repeated `npm run db:schema` has
-- nothing to overwrite.
--
-- The CHECK is dropped before the UPDATE because the old database's names
-- none of the seven stages and would reject the new rows.
ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_status_check;
UPDATE requests SET status = 'recibido'           WHERE status = 'presupuestado';
UPDATE requests SET status = 'desmontaje_montaje' WHERE status = 'en_taller';
ALTER TABLE requests ADD CONSTRAINT requests_status_check
    CHECK (status IN ('recibido',
                      'planchado', 'desmontaje_montaje',
                      'pintura', 'preparacion', 'cuadrada',
                      'cristales', 'finitura',
                      'listo', 'entregado', 'cancelado'));


-- The workshop's work queue: what is pending, oldest first.
CREATE INDEX IF NOT EXISTS requests_status_created_at_idx
    ON requests (status, created_at DESC);

-- updated_at maintains itself, so changing the status by hand from psql does
-- not leave the date stale.
CREATE OR REPLACE FUNCTION requests_touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS requests_touch_updated_at ON requests;
CREATE TRIGGER requests_touch_updated_at
    BEFORE UPDATE ON requests
    FOR EACH ROW EXECUTE FUNCTION requests_touch_updated_at();


-- =============================================================================
-- paint_orders: matizado sold over the counter to other companies
-- =============================================================================
--
-- The orders that come from pgs/paintings.html: a workshop, a dealership or a
-- body shop buying paint mixed to one colour. It is a different trade from
-- `requests` (nobody leaves a vehicle here, there are no panels and no
-- status ladder through the shop) so it is a different table rather than more
-- nullable columns on that one.
--
-- The tracking code is the same kind of credential and is generated the same
-- way (see generateId in server/db.js): ten random digits, primary key, never
-- correlative.
CREATE TABLE IF NOT EXISTS paint_orders (
    id          char(10)    PRIMARY KEY CHECK (id ~ '^[0-9]{10}$'),

    -- How the colour was identified. 'model' is a colour picked from the
    -- page's list by model and year, without reading the label: the shop
    -- should confirm it. 'in_person' is the one that arrives with
    -- no colour and no container: the customer is bringing the vehicle so the
    -- shop can read it with the spectrophotometer, and the formula (and with
    -- it the size and the price) does not exist yet. That is why every column
    -- describing the colour and the order below is nullable.
    method      text        NOT NULL CHECK (method IN ('code', 'model', 'reading', 'in_person')),

    brand       text,
    color_code  text,
    color_name  text,

    -- Sherwin's own colour id, when the colour came from the colour database
    -- rather than from the page's local catalogue. color_code stays the OEM
    -- code the customer reads off the label -- that is the one the shop and
    -- the customer talk about -- and this is the one that finds the formula.
    sw_code     text,
    finish      text        CHECK (finish IN ('solido', 'metalico', 'perlado', 'tricapa')),

    -- The CIELAB reading the customer typed in, when they measured the colour
    -- with their own spectrophotometer. Three numbers, kept together as one
    -- row of the order: the shop starts the formula from them.
    reading_l   numeric(5, 2) CHECK (reading_l BETWEEN 0 AND 100),
    reading_a   numeric(6, 2) CHECK (reading_a BETWEEN -128 AND 128),
    reading_b   numeric(6, 2) CHECK (reading_b BETWEEN -128 AND 128),

    -- The container, as a fraction of a US gallon. The volumes it stands for
    -- (118 ml, 946 ml, 3.79 L…) are derived in src/paints.js and not stored:
    -- they are a property of the fraction, not of the order.
    size        text        CHECK (size IN ('1_32', '1_16', '1_8', '1_4', '1_2', '1_1')),
    units       integer     CHECK (units BETWEEN 1 AND 20),

    -- What the page showed as the total when the customer confirmed, in whole
    -- soles. IT IS NOT THE BILL: prices on the site are referential and the
    -- shop closes them when it mixes the colour. It is stored so that the
    -- counter knows what was promised on screen.
    price       integer     CHECK (price >= 0),

    -- The buyer. The workshop's name is enough: the matizado is prepared and
    -- handed over at the counter, and the workshop closes the invoice
    -- separately. The RUC is no longer asked for, but the column stays
    -- (nullable) for old orders.
    company     text        NOT NULL CHECK (length(btrim(company)) > 0),
    ruc         text,

    first_name  text        NOT NULL CHECK (length(btrim(first_name)) > 0),
    last_name   text        NOT NULL CHECK (length(btrim(last_name)) > 0),
    department  text,
    province    text,
    phone       text        NOT NULL,   -- +51 y 9 dígitos, como en `requests`
    email       text,
    notes       text,

    -- Five statuses and not the eleven of `requests`: a matizado is received,
    -- prepared, ready and handed over. It goes through neither panel beating
    -- nor the oven. The list is repeated in PAINT_STATUSES (server/server.js);
    -- this CHECK has the last word, and widening it on an existing database
    -- is a migration, because CREATE TABLE IF NOT EXISTS does not touch it.
    status      text        NOT NULL DEFAULT 'recibido'
                            CHECK (status IN ('recibido', 'preparacion', 'listo',
                                              'entregado', 'cancelado')),

    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- The counter's queue: what is pending, newest first.
CREATE INDEX IF NOT EXISTS paint_orders_status_created_at_idx
    ON paint_orders (status, created_at DESC);

-- Every migration of `paint_orders` lives here, below the CREATE TABLE above,
-- and not up with the ones for `requests`. On a new database the table does
-- not exist yet when those run, and an ALTER against a table that is not
-- there aborts the whole file -- ON_ERROR_STOP in pgserver.sh, one implicit
-- transaction in migrate.js. That left a fresh database holding `requests`
-- and nothing else: no `paint_orders`, no `worker_notes` and no trigger, so
-- every matizado order answered 500 because the table to store it in had
-- never been created.

-- The colour database arrived after the first orders did.
ALTER TABLE paint_orders ADD COLUMN IF NOT EXISTS sw_code text;

-- 'model' came after the table did: a base created before it still has the
-- three-value CHECK, which Postgres named paint_orders_method_check.
ALTER TABLE paint_orders DROP CONSTRAINT IF EXISTS paint_orders_method_check;
ALTER TABLE paint_orders ADD CONSTRAINT paint_orders_method_check
    CHECK (method IN ('code', 'model', 'reading', 'in_person'));

-- The form stopped asking for the RUC and made email optional: the
-- workshop's name and the phone are enough. On a database created earlier,
-- `ruc` and `email` were still NOT NULL and `ruc` carried its format CHECK,
-- so an order without them failed on save. They are relaxed here; the
-- columns stay for the old orders that did carry them.
ALTER TABLE paint_orders DROP CONSTRAINT IF EXISTS paint_orders_ruc_check;
ALTER TABLE paint_orders ALTER COLUMN ruc DROP NOT NULL;
ALTER TABLE paint_orders ALTER COLUMN email DROP NOT NULL;

-- The swatch the workshop table paints in the «Color» column. It is stored
-- because the colour database is the only place that knows the hex of most of
-- its 68k colours, and asking it again for every row of every listing would
-- tie the panel to a second database. Older orders have none; the server falls
-- back to the page's local catalogue for those (see paintHex in server.js).
-- The boss fills it in, too, when he defines an order read at the counter.
ALTER TABLE paint_orders ADD COLUMN IF NOT EXISTS hex text
    CHECK (hex ~ '^#[0-9a-f]{6}$');

-- Same trigger as `requests`, for the same reason: changing the status by
-- hand from psql must not leave the date stale.
DROP TRIGGER IF EXISTS paint_orders_touch_updated_at ON paint_orders;
CREATE TRIGGER paint_orders_touch_updated_at
    BEFORE UPDATE ON paint_orders
    FOR EACH ROW EXECUTE FUNCTION requests_touch_updated_at();


-- =============================================================================
-- worker_notes: what the boss has told each worker
-- =============================================================================
--
-- One row per worker, so writing a note replaces the one before it: the panel
-- offers a single note per person and the primary key is what makes that true
-- rather than a rule somebody has to remember.
--
-- The worker sees it on their profile, above their own notepad, and cannot edit
-- it; only the boss writes here (see PUT /api/staff/workers/:code/note in
-- server/server.js). The notepad below it on the same screen is the worker's
-- own and never leaves their browser. These are two different things that look
-- alike, which is why one lives in the database and the other does not.
--
-- No foreign key to anybody: the roster lives in the environment
-- (AUTOCOLOR_WORKER_IDS, see server/auth.js), not in a table. The CHECK on the
-- code shape is what keeps a typo out.
--
-- No trigger on updated_at, unlike `requests`. Nothing edits this table by hand
-- from psql, so the upsert sets the timestamp and that is one less moving part.
CREATE TABLE IF NOT EXISTS worker_notes (
    worker_id  text        PRIMARY KEY CHECK (worker_id ~ '^[A-Z]{2}[0-9]{5}$'),
    note       text        NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 500),
    written_by text        NOT NULL CHECK (written_by ~ '^[A-Z]{2}[0-9]{5}$'),
    updated_at timestamptz NOT NULL DEFAULT now()
);


-- =============================================================================
-- Useful queries for the workshop
-- =============================================================================
--
-- Pending requests, newest first:
--
--   SELECT id, created_at::date AS fecha, first_name || ' ' || last_name AS cliente,
--          brand || ' ' || model AS vehiculo, model_year, plate,
--          quality, cardinality(parts) AS piezas, phone, status
--     FROM requests
--    WHERE status NOT IN ('entregado', 'cancelado')
--    ORDER BY created_at DESC;
--
-- See a full request:
--
--   SELECT * FROM requests WHERE id = '1234567890';
--
-- Change the status (it is what the customer will see when looking up their code):
--
--   UPDATE requests SET status = 'pintura' WHERE id = '1234567890';
--
-- How many requests there are per status:
--
--   SELECT status, count(*) FROM requests GROUP BY status ORDER BY count DESC;
