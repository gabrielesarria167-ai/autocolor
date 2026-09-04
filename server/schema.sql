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
    -- vistazo. Sus etiquetas en español viven en src/repair.js (PART_LABELS).
    parts       text[]      NOT NULL DEFAULT '{}',

    -- Datos de contacto (paso 4). Solo nombre, apellido y teléfono son
    -- obligatorios, igual que en el formulario.
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
-- El CHECK se retira antes del UPDATE: el de la base vieja no nombra 'suv' y
-- rechazaría las filas nuevas.
ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_vehicle_check;
UPDATE requests SET vehicle = 'pickup'
 WHERE vehicle = 'suv' AND created_at < timestamptz '2026-09-04';
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
