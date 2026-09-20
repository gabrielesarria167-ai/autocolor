-- Makes: one row per make name the source uses, grouped and labelled.
--
-- Run against the local build database, after the bundle's 01-04. Nothing
-- here reaches Neon directly; 40_export.sql ships the result.
--
-- Three paint systems of 26: 75 (Ultra 9K) and 79 (Ultra BC8) are 93% of the
-- table, and 41 (Ultra 9K America do Sul) adds 214 colours found nowhere else,
-- which matters for a shop selling in Peru. The rest are industrial, truck and
-- legacy lines a body shop matching car paint never reaches for.

\set ON_ERROR_STOP on

DROP SCHEMA IF EXISTS colour CASCADE;
CREATE SCHEMA colour;

CREATE TABLE colour.make (
    make_id    smallint PRIMARY KEY,
    db_name    text     NOT NULL UNIQUE,  -- exactly as the source spells it
    group_id   smallint NOT NULL,         -- makes that are one brand to a customer
    label      text     NOT NULL,         -- what the page shows
    is_vehicle boolean  NOT NULL,         -- false for RAL, PANTONE, FLEETOWNER...
    sort_key   smallint NOT NULL          -- the ten the shop sells come first
);

-- Defaults first: every make is its own group, labelled by initcap, a vehicle.
-- make_id is assigned by name so a rebuild of the same extract is reproducible.
INSERT INTO colour.make (make_id, db_name, group_id, label, is_vehicle, sort_key)
SELECT row_number() OVER (ORDER BY make)::smallint,
       make,
       row_number() OVER (ORDER BY make)::smallint,
       initcap(make),
       true,
       100
FROM (SELECT DISTINCT make FROM vehicle_color_lookup
       WHERE paint_system_number IN ('75', '79', '41')) s;

-- The overrides, as an explicit list rather than a pattern. A pattern works
-- until the day the source adds FORD FLEET and quietly folds it into Ford; a
-- list is auditable and somebody had to mean it. Columns: the source's name,
-- the group it belongs to (NULL: its own), the label (NULL: keep initcap),
-- whether it is a vehicle at all, and the sort key.
--
-- Cars are kept apart from their truck and motorcycle arms on purpose: they
-- are different code spaces, and a customer looking for a Volvo car should not
-- have to read past the lorries.
CREATE TEMP TABLE override (
    db_name text, group_of text, label text, is_vehicle boolean, sort_key smallint
);
INSERT INTO override VALUES
    ('TOYOTA', NULL, 'Toyota', true, 1),
    ('CHEVROLET', NULL, 'Chevrolet', true, 2),
    ('FORD', NULL, 'Ford', true, 3),
    ('SUBARU', NULL, 'Subaru', true, 4),
    ('NISSAN', NULL, 'Nissan', true, 5),
    ('BMW', NULL, 'BMW', true, 6),
    ('AUDI', NULL, 'Audi', true, 7),
    ('MERCEDES', NULL, 'Mercedes-Benz', true, 8),
    ('FIAT', NULL, 'Fiat', true, 9),
    ('JEEP', NULL, 'Jeep', true, 10),
    ('FORD USA', 'FORD', NULL, true, 100),
    ('FORD ARGENTINA', 'FORD', NULL, true, 100),
    ('FORD BRAZIL - ARGENTINA', 'FORD', NULL, true, 100),
    ('FORD SOUTH AFRICA', 'FORD', NULL, true, 100),
    ('FORD AUSTRALIA', 'FORD', NULL, true, 100),
    ('FORD NEW ZEALAND', 'FORD', NULL, true, 100),
    ('CHEVROLET EUROPE', 'CHEVROLET', NULL, true, 100),
    ('TOYOTA SOUTH AFRICA', 'TOYOTA', NULL, true, 100),
    ('MERCEDES BENZ', 'MERCEDES', NULL, true, 100),
    ('VOLKSWAGEN', NULL, 'Volkswagen', true, 100),
    ('VOLKSWAGEN BRAZIL', 'VOLKSWAGEN', NULL, true, 100),
    ('VOLKSWAGEN / AUDI', NULL, 'Volkswagen / Audi', true, 100),
    ('GEN. MOTORS USA', NULL, 'General Motors', true, 100),
    ('GEN. MOTORS  HOLDEN (AUS)', 'GEN. MOTORS USA', NULL, true, 100),
    ('GEN. MOTORS NEW ZEALAND', 'GEN. MOTORS USA', NULL, true, 100),
    ('CHRYSLER USA', NULL, 'Chrysler', true, 100),
    ('CHRYSLER FRANCE', 'CHRYSLER USA', NULL, true, 100),
    ('CHRYSLER UK', 'CHRYSLER USA', NULL, true, 100),
    ('CHRYSLER', 'CHRYSLER USA', NULL, true, 100),
    ('KIA', NULL, 'Kia', true, 100),
    ('KIA MOTORS', 'KIA', NULL, true, 100),
    ('MG', NULL, 'MG', true, 100),
    ('MG > 2008', 'MG', NULL, true, 100),
    ('RENAULT', NULL, 'Renault', true, 100),
    ('RENAULT RVI', NULL, 'Renault Trucks', true, 100),
    ('RENAULT TRUCKS', 'RENAULT RVI', NULL, true, 100),
    ('MERCEDES TRUCKS', NULL, 'Mercedes-Benz Trucks', true, 100),
    ('VOLVO', NULL, 'Volvo', true, 100),
    ('VOLVO TRUCKS', NULL, 'Volvo Trucks', true, 100),
    ('HONDA', NULL, 'Honda', true, 100),
    ('HONDA MOTOR', NULL, 'Honda Motos', true, 100),
    ('BMW MOTOR', NULL, 'BMW Motos', true, 100),
    ('SUZUKI', NULL, 'Suzuki', true, 100),
    ('SUZUKI MOTOR', NULL, 'Suzuki Motos', true, 100),
    ('TRIUMPH', NULL, 'Triumph', true, 100),
    ('TRIUMPH MOTOR', NULL, 'Triumph Motos', true, 100),
    ('PIAGGIO CARS', NULL, 'Piaggio', true, 100),
    ('PIAGGIO MOTOR', NULL, 'Piaggio Motos', true, 100),
    ('DS', NULL, 'DS', true, 100),
    ('HSV', NULL, 'HSV', true, 100),
    ('DAF', NULL, 'DAF', true, 100),
    ('BYD', NULL, 'BYD', true, 100),
    ('KGM', NULL, 'KGM', true, 100),
    ('LEVC', NULL, 'LEVC', true, 100),
    ('NIO', NULL, 'NIO', true, 100),
    ('JAC', NULL, 'JAC', true, 100),
    ('JDM', NULL, 'JDM', true, 100),
    ('BAIC', NULL, 'BAIC', true, 100),
    ('ONVO', NULL, 'ONVO', true, 100),
    ('LDV', NULL, 'LDV', true, 100),
    ('BAW', NULL, 'BAW', true, 100),
    ('FSO', NULL, 'FSO', true, 100),
    ('OYAK', NULL, 'OYAK', true, 100),
    ('DFSK', NULL, 'DFSK', true, 100),
    ('GAZ', NULL, 'GAZ', true, 100),
    ('TVR', NULL, 'TVR', true, 100),
    ('XEV', NULL, 'XEV', true, 100),
    ('AION', NULL, 'AION', true, 100),
    ('CMC', NULL, 'CMC', true, 100),
    ('TOGG', NULL, 'TOGG', true, 100),
    ('ROX', NULL, 'ROX', true, 100),
    ('ICAR', NULL, 'ICAR', true, 100),
    ('NETA', NULL, 'NETA', true, 100),
    ('FUDI', NULL, 'FUDI', true, 100),
    ('ZAP', NULL, 'ZAP', true, 100),
    ('IKCO', NULL, 'IKCO', true, 100),
    ('GWM', NULL, 'GWM', true, 100),
    ('WEY', NULL, 'WEY', true, 100),
    ('UMM', NULL, 'UMM', true, 100),
    ('UNIC', NULL, 'UNIC', true, 100),
    ('ORA', NULL, 'ORA', true, 100),
    ('EVO', NULL, 'EVO', true, 100),
    ('DR', NULL, 'DR', true, 100),
    ('COS', NULL, 'COS', true, 100),
    ('KYC', NULL, 'KYC', true, 100),
    ('AITO', NULL, 'AITO', true, 100),
    ('UAZ', NULL, 'UAZ', true, 100),
    ('COLOR MAP', NULL, NULL, false, 900),
    ('COLOR MAP 18', NULL, NULL, false, 900),
    ('COLOR TOOLS FAN DECK', NULL, NULL, false, 900),
    ('FLEET AUSTRALIA ARB', NULL, NULL, false, 900),
    ('FLEET AUSTRALIA KITCHEN', NULL, NULL, false, 900),
    ('FLEET COLORS  GENERAL', NULL, NULL, false, 900),
    ('FLEETOWNER AUSTRALIA', NULL, NULL, false, 900),
    ('FLEETOWNER BELGIE', NULL, NULL, false, 900),
    ('FLEETOWNER BRAZIL', NULL, NULL, false, 900),
    ('FLEETOWNER BRUNEI', NULL, NULL, false, 900),
    ('FLEETOWNER CHINA', NULL, NULL, false, 900),
    ('FLEETOWNER CZECH REP', NULL, NULL, false, 900),
    ('FLEETOWNER DENMARK', NULL, NULL, false, 900),
    ('FLEETOWNER DIV.', NULL, NULL, false, 900),
    ('FLEETOWNER FINLAND', NULL, NULL, false, 900),
    ('FLEETOWNER FRANCE', NULL, NULL, false, 900),
    ('FLEETOWNER GERMANY', NULL, NULL, false, 900),
    ('FLEETOWNER GLOBAL', NULL, NULL, false, 900),
    ('FLEETOWNER INDIA', NULL, NULL, false, 900),
    ('FLEETOWNER INDONESIA', NULL, NULL, false, 900),
    ('FLEETOWNER ITALY', NULL, NULL, false, 900),
    ('FLEETOWNER KOREA', NULL, NULL, false, 900),
    ('FLEETOWNER MALAYSIA', NULL, NULL, false, 900),
    ('FLEETOWNER NEDERLAND', NULL, NULL, false, 900),
    ('FLEETOWNER NEW ZEALAND', NULL, NULL, false, 900),
    ('FLEETOWNER PHILIPPINES', NULL, NULL, false, 900),
    ('FLEETOWNER POLAND', NULL, NULL, false, 900),
    ('FLEETOWNER SINGAPORE', NULL, NULL, false, 900),
    ('FLEETOWNER SLOVAKIA', NULL, NULL, false, 900),
    ('FLEETOWNER SLOVENIA', NULL, NULL, false, 900),
    ('FLEETOWNER SPAIN', NULL, NULL, false, 900),
    ('FLEETOWNER SWEDEN', NULL, NULL, false, 900),
    ('FLEETOWNER SWITZERLAND', NULL, NULL, false, 900),
    ('FLEETOWNER TURKEY', NULL, NULL, false, 900),
    ('FLEETOWNER U.K.', NULL, NULL, false, 900),
    ('FLEETOWNER USA', NULL, NULL, false, 900),
    ('GENERAL COM. VEHICLES', NULL, NULL, false, 900),
    ('GENERAL INDUSTRY COLORS', NULL, NULL, false, 900),
    ('GENERAL INDUSTRY USA', NULL, NULL, false, 900),
    ('NCS', NULL, NULL, false, 900),
    ('PANTONE (PMS)', NULL, NULL, false, 900),
    ('PANTONE PMS FLEETOWNER', NULL, NULL, false, 900),
    ('RAL', NULL, NULL, false, 900),
    ('RAL DESIGN', NULL, NULL, false, 900),
    ('RAL EFFECT', NULL, NULL, false, 900),
    ('SIKKENS ACC', NULL, NULL, false, 900),
    ('SIKKENS STANDARD', NULL, NULL, false, 900),
    ('VALSPAR AUTOM. STANDARDS', NULL, NULL, false, 900),
    ('VALSPAR COMPETITOR D', NULL, NULL, false, 900),
    ('VALSPAR COMPETITOR S', NULL, NULL, false, 900),
    ('VALSPAR MOTOR COLOURS', NULL, NULL, false, 900),
    ('VALSPAR PANTONE (PMS)', NULL, NULL, false, 900);

-- Every override must name a make that exists, or the extract changed under us.
DO $$
DECLARE missing text;
BEGIN
    SELECT string_agg(o.db_name, ', ') INTO missing
    FROM override o LEFT JOIN colour.make m USING (db_name)
    WHERE m.make_id IS NULL;
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'overrides name makes that are not in this extract: %', missing;
    END IF;
END $$;

UPDATE colour.make m SET
    label      = coalesce(o.label, m.label),
    is_vehicle = o.is_vehicle,
    sort_key   = o.sort_key
FROM override o WHERE o.db_name = m.db_name;

UPDATE colour.make m SET group_id = leader.make_id
FROM override o JOIN colour.make leader ON leader.db_name = o.group_of
WHERE o.db_name = m.db_name AND o.group_of IS NOT NULL;

-- A group's label is its leader's. Members keep their own row (the join needs
-- it) but never show it, so make them agree rather than leaving a stale value.
UPDATE colour.make m SET label = leader.label, sort_key = leader.sort_key
FROM colour.make leader
WHERE m.group_id = leader.make_id AND m.make_id <> leader.make_id;

-- A group leader must be its own group, or api.makes() would drop the group.
DO $$
DECLARE orphans int;
BEGIN
    SELECT count(*) INTO orphans FROM colour.make m
    WHERE NOT EXISTS (SELECT 1 FROM colour.make l
                       WHERE l.make_id = m.group_id AND l.make_id = l.group_id);
    IF orphans > 0 THEN
        RAISE EXCEPTION '% makes point at a group whose leader is itself grouped', orphans;
    END IF;
END $$;

CREATE INDEX make_group_idx ON colour.make (group_id);
