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

    -- Lo elegido en los pasos 1 a 3 del asistente.
    vehicle     text        NOT NULL CHECK (vehicle IN ('van', 'wagon', 'suv')),
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

    status      text        NOT NULL DEFAULT 'recibido'
                            CHECK (status IN ('recibido', 'presupuestado', 'en_taller',
                                              'listo', 'entregado', 'cancelado')),

    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

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
--          vehicle, quality, cardinality(parts) AS piezas, phone, status
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
--   UPDATE requests SET status = 'presupuestado' WHERE id = '1234567890';
--
-- Cuántas solicitudes hay por estado:
--
--   SELECT status, count(*) FROM requests GROUP BY status ORDER BY count DESC;
