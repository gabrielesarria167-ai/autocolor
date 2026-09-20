-- Schema del database colori Sherwin-Williams Collision Core.
-- Generato automaticamente: non modificare a mano, rigenerare.
-- Tutte le colonne testuali sono 'text': in Postgres ha prestazioni
-- identiche a varchar(n) ed evita errori di troncamento.

DROP TABLE IF EXISTS paint_systems CASCADE;
CREATE TABLE paint_systems (
    paint_system_number      text,
    paint_system_short_description text,
    paint_system_description text,
    is_selectable            boolean,
    paint_systems_id         bigint
);

DROP TABLE IF EXISTS colors CASCADE;
CREATE TABLE colors (
    color_id                 text,
    color_code               text,
    color_name               text,
    colors_sw_id             bigint
);

DROP TABLE IF EXISTS products CASCADE;
CREATE TABLE products (
    product_number           text,
    product_description      text,
    product_short_description text,
    density                  numeric,
    voc_dry                  numeric,
    voc_dry_me               numeric,
    voc_total                numeric,
    voc_total_me             numeric,
    weight_percent_water     numeric,
    weight_percent_solid_material numeric,
    weight_percent_solvent   numeric,
    contains_aluminum        boolean,
    weight_percent_acetone   numeric,
    weight_percent_pctbf     numeric,
    weight_percent_tba       numeric,
    weight_percent_ma        numeric,
    products_id              bigint,
    product_category_number  text,
    status                   text
);

DROP TABLE IF EXISTS makes_models CASCADE;
CREATE TABLE makes_models (
    make                     text,
    model                    text
);

DROP TABLE IF EXISTS color_usage_notes CASCADE;
CREATE TABLE color_usage_notes (
    color_code               text,
    make                     text,
    notes                    text,
    paint_system_number      text,
    color_usage_notes_id     bigint
);

DROP TABLE IF EXISTS variants CASCADE;
CREATE TABLE variants (
    standard_color_code      text,
    variant_description      text,
    variant_color_code       text,
    paint_system_number      text,
    paint_system_description text,
    color_flop               text,
    variant_alternate_color_name text,
    variant_code             text,
    mvl                      boolean,
    ref_recipe_id            bigint
);

DROP TABLE IF EXISTS related_colors CASCADE;
CREATE TABLE related_colors (
    make                     text,
    model                    text,
    color_description        text,
    owner_color_code         text,
    owner_color_code_1       text,
    owner_color_code_2       text,
    owner_color_code_3       text,
    owner_color_code_4       text,
    owner_color_code_5       text,
    year_minimum             smallint,
    year_maximum             smallint,
    main_mix_logic_code      text,
    related_mix_logic_code   text,
    position                 text,
    color_code               text,
    paint_system_number      text,
    paint_system_short_description text,
    paint_system_description text,
    notes                    text,
    variant_count            integer,
    navigator_number         text
);

DROP TABLE IF EXISTS formulas CASCADE;
CREATE TABLE formulas (
    paint_system_number      text,
    color_code               text,
    layer_number             integer,
    version                  numeric,
    revision_date            text,
    alternate_code           text,
    product_number_01        text,
    weight_percentage_01     numeric,
    product_number_02        text,
    weight_percentage_02     numeric,
    product_number_03        text,
    weight_percentage_03     numeric,
    product_number_04        text,
    weight_percentage_04     numeric,
    product_number_05        text,
    weight_percentage_05     numeric,
    product_number_06        text,
    weight_percentage_06     numeric,
    product_number_07        text,
    weight_percentage_07     numeric,
    product_number_08        text,
    weight_percentage_08     numeric,
    product_number_09        text,
    weight_percentage_09     numeric,
    product_number_10        text,
    weight_percentage_10     numeric,
    product_number_11        text,
    weight_percentage_11     numeric,
    product_number_12        text,
    weight_percentage_12     numeric,
    product_number_13        text,
    weight_percentage_13     numeric,
    product_number_14        text,
    weight_percentage_14     numeric,
    product_number_15        text,
    weight_percentage_15     numeric,
    navigator_number         text,
    formulas_id              bigint,
    chip_number              text,
    color_flop               text,
    formulas_description     text,
    ref_color_id             text,
    paint_systems_id         bigint,
    solid_type               text,
    undercoat                text,
    label_ghs_por            text,
    label_ghs_spa            text,
    is_history               boolean,
    ref_recipe_id            bigint
);

DROP TABLE IF EXISTS vehicle_color_lookup CASCADE;
CREATE TABLE vehicle_color_lookup (
    id                       bigserial PRIMARY KEY,
    make                     text NOT NULL,
    model                    text,
    is_brand_level           boolean NOT NULL,
    year_min                 smallint,
    year_max                 smallint,
    owner_color_code         text,
    owner_color_code_1       text,
    owner_color_code_2       text,
    owner_color_code_3       text,
    owner_color_code_4       text,
    owner_color_code_5       text,
    color_description        text,
    color_family             text,
    color_code               text NOT NULL,
    main_mixlogic_code       text,
    related_mixlogic_code    text,
    color_position           text,
    paint_system_number      text,
    paint_system_short       text,
    paint_system_desc        text,
    variant_count            integer,
    accent_color_count       integer,
    variant_type             text,
    navigator_number         text,
    chip_number              text,
    color_flop               text,
    solid_type               text,
    formulas_description     text,
    mutation_date            text,
    region_name              text,
    sherwin_code             text,
    gen2_box_chip_location   text,
    gen2_box_chip_number     text,
    motor_box_chip_location  text,
    motor_box_chip_number    text,
    notes                    text
);

DROP TABLE IF EXISTS formula_ingredients CASCADE;
CREATE TABLE formula_ingredients (
    formulas_id              bigint NOT NULL,
    paint_system_number      text,
    color_code               text NOT NULL,
    layer_number             integer,
    version                  numeric,
    is_history               boolean NOT NULL,
    ref_recipe_id            bigint,
    alternate_code           text,
    formulas_description     text,
    navigator_number         text,
    solid_type               text,
    undercoat                text,
    ingredient_order         integer NOT NULL,
    product_number           text NOT NULL,
    product_description      text,
    weight_percentage        numeric
);

