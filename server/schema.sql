-- =============================================================================
-- Autocolor — esquema de la base de datos `autocolor`
--
-- Crear la base (una sola vez) y luego aplicar este archivo:
--
--     createdb autocolor
--     psql -v ON_ERROR_STOP=1 -d autocolor -f server/schema.sql
--
-- El archivo es idempotente: se puede volver a aplicar sin perder datos.
-- =============================================================================

-- Estados por los que pasa una solicitud, en orden de avance. Se guardan como
-- texto con CHECK en lugar de un ENUM para que agregar un estado nuevo sea un
-- ALTER TABLE y no una migración de tipo.
CREATE TABLE IF NOT EXISTS requests (
    -- El código de 10 dígitos que se le entrega al cliente al enviar el
    -- formulario. Es la clave primaria y además la única credencial para
    -- consultar la solicitud, por eso se genera al azar (ver server/db.js) y
    -- no de forma correlativa: un código correlativo dejaría adivinar los
    -- datos de otros clientes probando números vecinos.
    id          char(10)    PRIMARY KEY CHECK (id ~ '^[0-9]{10}$'),

    -- El vehículo tal como lo describió el cliente en el paso 1. Marca y
    -- modelo se guardan con el nombre que se le mostró en pantalla, no con
    -- el id del catálogo (src/carModels.js): el taller lee esta tabla y
    -- 'Yaris Sedán' le dice más que 'yaris-sedan'. Son NULL solo en las
    -- solicitudes anteriores a que el asistente los pidiera.
    brand       text,
    model       text,
    body_type   text        CHECK (body_type IN ('sedan', 'hatchback', 'coupe', 'wagon',
                                                 'suv', 'pickup', 'minivan', 'van')),
    model_year  integer     CHECK (model_year BETWEEN 1980 AND 2100),
    plate       text        CHECK (plate ~ '^[A-Z0-9]{3}-[A-Z0-9]{3}$'),
    mileage     integer     CHECK (mileage >= 0),
    color_code  text,

    -- La silueta 3D sobre la que se eligieron las piezas. Se deduce de
    -- body_type (ver BODY_TYPES en src/carModels.js) porque hay cuatro
    -- modelos 3D y ocho carrocerías: un sedán se pinta sobre la silueta
    -- 'wagon', y una minivan sobre la 'van'.
    vehicle     text        NOT NULL CHECK (vehicle IN ('van', 'wagon', 'pickup', 'suv')),
    quality     text        NOT NULL CHECK (quality IN ('standard', 'premium', 'custom')),
    -- Los ids de panel que usa el visor 3D ('hood', 'rear_door_left', …). Son
    -- distintos por modelo, así que se guardan tal cual llegan, como arreglo:
    -- una solicitud sigue siendo una sola fila y el taller ve las piezas de un
    -- vistazo. Sus etiquetas en español viven en src/parts.js.
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

    -- Esta lista es la última palabra sobre los estados: los cuatro que ve el
    -- cliente ('recibido', 'listo', 'entregado', 'cancelado') y las siete
    -- etapas por las que el taller mueve el trabajo entre medias. Se repite en
    -- otros dos sitios que no pueden leerla: STATUSES en server/server.js
    -- (valida lo que entra por PATCH) y src/statuses.js (lo que ve el
    -- cliente). Tocar la lista son esos dos más una migración sobre este
    -- CHECK, porque CREATE TABLE IF NOT EXISTS no lo toca sobre una tabla que
    -- ya existe.
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
    -- subquery — an unnest() with bool_and — is not allowed inside a CHECK,
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

-- Las columnas del vehículo llegaron después de las primeras solicitudes, así
-- que para una base ya creada se agregan aquí. En una base nueva el CREATE de
-- arriba ya las trae y estos ALTER no hacen nada.
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


-- Hubo una silueta 'suv' que pasó a llamarse 'pickup' cuando se separaron
-- las dos carrocerías: el modelo 3D de entonces siempre fue el de una pickup
-- (una Hilux doble cabina), así que aquellas solicitudes se refieren al mismo
-- archivo y se renombran.
--
-- OJO con el corte por fecha, que no es decorativo. Hoy 'suv' vuelve a existir
-- y esta vez es de verdad: su propio modelo 3D, con sus propias piezas. Sin el
-- corte, cada `npm run db:schema` reescribiría a 'pickup' todas las
-- solicitudes nuevas de una SUV, y sus piezas —'tailgate', 'rear_bumper'— no
-- existen en la pickup, así que el taller vería una lista que no se puede
-- dibujar. La fecha es la del commit que agregó el modelo: antes de ella no
-- había ninguna SUV real que proteger.
--
-- Lleva el huso escrito. Sin él, Postgres resuelve la fecha en el TimeZone de
-- la sesión, y el corte cae cinco horas más tarde aplicando esto desde la
-- máquina de trabajo (America/Lima) que contra Neon (UTC): una SUV de verdad
-- creada en esa franja se reescribiría a 'pickup', que es exactamente lo que
-- el corte existe para impedir.
--
-- El CHECK se retira antes del UPDATE: el de la base vieja no nombra 'suv' y
-- rechazaría las filas nuevas.
ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_vehicle_check;
UPDATE requests SET vehicle = 'pickup'
 WHERE vehicle = 'suv' AND created_at < timestamptz '2026-09-04 00:00+00';
ALTER TABLE requests ADD CONSTRAINT requests_vehicle_check
    CHECK (vehicle IN ('van', 'wagon', 'pickup', 'suv'));


-- 'presupuestado' y 'en_taller' se retiraron cuando el taller pidió nombrar
-- sus siete etapas reales. Las solicitudes que quedaron paradas en uno de los
-- dos se mueven al estado nuevo más cercano: lo presupuestado todavía no había
-- entrado al local, así que vuelve a 'recibido'; lo que estaba «en el taller»
-- pasa a 'desmontaje_montaje', que es por donde empieza el trabajo dentro.
--
-- Aquí no hace falta el corte por fecha que sí lleva el renombrado de vehículo
-- de arriba: aquellos dos nombres no van a volver a existir, así que un
-- `npm run db:schema` repetido no tiene nada que pisar.
--
-- El CHECK se retira antes del UPDATE porque el de la base vieja no nombra
-- ninguna de las siete etapas y rechazaría las filas nuevas.
ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_status_check;
UPDATE requests SET status = 'recibido'           WHERE status = 'presupuestado';
UPDATE requests SET status = 'desmontaje_montaje' WHERE status = 'en_taller';
ALTER TABLE requests ADD CONSTRAINT requests_status_check
    CHECK (status IN ('recibido',
                      'planchado', 'desmontaje_montaje',
                      'pintura', 'preparacion', 'cuadrada',
                      'cristales', 'finitura',
                      'listo', 'entregado', 'cancelado'));


-- La cola de trabajo del taller: lo pendiente, lo más antiguo primero.
CREATE INDEX IF NOT EXISTS requests_status_created_at_idx
    ON requests (status, created_at DESC);

-- updated_at se mantiene solo, para que cambiar el estado a mano desde psql
-- no deje la fecha desactualizada.
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
-- worker_notes — what the boss has told each worker
-- =============================================================================
--
-- One row per worker, so writing a note replaces the one before it: the panel
-- offers a single note per person and the primary key is what makes that true
-- rather than a rule somebody has to remember.
--
-- The worker sees it on their profile, above their own notepad, and cannot edit
-- it; only the boss writes here (see PUT /api/staff/workers/:code/note in
-- server/server.js). The notepad below it on the same screen is the worker's
-- own and never leaves their browser — these are two different things that look
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
-- Consultas útiles para el taller
-- =============================================================================
--
-- Solicitudes pendientes, las más recientes primero:
--
--   SELECT id, created_at::date AS fecha, first_name || ' ' || last_name AS cliente,
--          brand || ' ' || model AS vehiculo, model_year, plate,
--          quality, cardinality(parts) AS piezas, phone, status
--     FROM requests
--    WHERE status NOT IN ('entregado', 'cancelado')
--    ORDER BY created_at DESC;
--
-- Ver una solicitud completa:
--
--   SELECT * FROM requests WHERE id = '1234567890';
--
-- Cambiar el estado (es lo que verá el cliente al consultar su código):
--
--   UPDATE requests SET status = 'pintura' WHERE id = '1234567890';
--
-- Cuántas solicitudes hay por estado:
--
--   SELECT status, count(*) FROM requests GROUP BY status ORDER BY count DESC;
