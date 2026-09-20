-- Caricamento dei dati.
-- Usa \copy (lato client) e non COPY (lato server): non servono
-- privilegi di superutente ne' accesso al filesystem del server.
-- NULL '' significa: campo vuoto non quotato = NULL.
\timing on

\echo Caricamento paint_systems...
\copy paint_systems (paint_system_number, paint_system_short_description, paint_system_description, is_selectable, paint_systems_id) FROM 'data/paint_systems.csv' WITH (FORMAT csv, HEADER true, NULL '')

\echo Caricamento colors...
\copy colors (color_id, color_code, color_name, colors_sw_id) FROM 'data/colors.csv' WITH (FORMAT csv, HEADER true, NULL '')

\echo Caricamento products...
\copy products (product_number, product_description, product_short_description, density, voc_dry, voc_dry_me, voc_total, voc_total_me, weight_percent_water, weight_percent_solid_material, weight_percent_solvent, contains_aluminum, weight_percent_acetone, weight_percent_pctbf, weight_percent_tba, weight_percent_ma, products_id, product_category_number, status) FROM 'data/products.csv' WITH (FORMAT csv, HEADER true, NULL '')

\echo Caricamento makes_models...
\copy makes_models (make, model) FROM 'data/makes_models.csv' WITH (FORMAT csv, HEADER true, NULL '')

\echo Caricamento color_usage_notes...
\copy color_usage_notes (color_code, make, notes, paint_system_number, color_usage_notes_id) FROM 'data/color_usage_notes.csv' WITH (FORMAT csv, HEADER true, NULL '')

\echo Caricamento variants...
\copy variants (standard_color_code, variant_description, variant_color_code, paint_system_number, paint_system_description, color_flop, variant_alternate_color_name, variant_code, mvl, ref_recipe_id) FROM 'data/variants.csv' WITH (FORMAT csv, HEADER true, NULL '')

\echo Caricamento related_colors...
\copy related_colors (make, model, color_description, owner_color_code, owner_color_code_1, owner_color_code_2, owner_color_code_3, owner_color_code_4, owner_color_code_5, year_minimum, year_maximum, main_mix_logic_code, related_mix_logic_code, position, color_code, paint_system_number, paint_system_short_description, paint_system_description, notes, variant_count, navigator_number) FROM 'data/related_colors.csv' WITH (FORMAT csv, HEADER true, NULL '')

\echo Caricamento formulas...
\copy formulas (paint_system_number, color_code, layer_number, version, revision_date, alternate_code, product_number_01, weight_percentage_01, product_number_02, weight_percentage_02, product_number_03, weight_percentage_03, product_number_04, weight_percentage_04, product_number_05, weight_percentage_05, product_number_06, weight_percentage_06, product_number_07, weight_percentage_07, product_number_08, weight_percentage_08, product_number_09, weight_percentage_09, product_number_10, weight_percentage_10, product_number_11, weight_percentage_11, product_number_12, weight_percentage_12, product_number_13, weight_percentage_13, product_number_14, weight_percentage_14, product_number_15, weight_percentage_15, navigator_number, formulas_id, chip_number, color_flop, formulas_description, ref_color_id, paint_systems_id, solid_type, undercoat, label_ghs_por, label_ghs_spa, is_history, ref_recipe_id) FROM 'data/formulas.csv' WITH (FORMAT csv, HEADER true, NULL '')

\echo Caricamento vehicle_color_lookup...
\copy vehicle_color_lookup (make, model, is_brand_level, year_min, year_max, owner_color_code, owner_color_code_1, owner_color_code_2, owner_color_code_3, owner_color_code_4, owner_color_code_5, color_description, color_family, color_code, main_mixlogic_code, related_mixlogic_code, color_position, paint_system_number, paint_system_short, paint_system_desc, variant_count, accent_color_count, variant_type, navigator_number, chip_number, color_flop, solid_type, formulas_description, mutation_date, region_name, sherwin_code, gen2_box_chip_location, gen2_box_chip_number, motor_box_chip_location, motor_box_chip_number, notes) FROM 'data/vehicle_color_lookup.csv' WITH (FORMAT csv, HEADER true, NULL '')

\echo Caricamento formula_ingredients...
\copy formula_ingredients (formulas_id, paint_system_number, color_code, layer_number, version, is_history, ref_recipe_id, alternate_code, formulas_description, navigator_number, solid_type, undercoat, ingredient_order, product_number, product_description, weight_percentage) FROM 'data/formula_ingredients.csv' WITH (FORMAT csv, HEADER true, NULL '')

ANALYZE;
