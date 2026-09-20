-- Indici e viste di comodo.
-- Da eseguire DOPO 02_load.sql: creare gli indici prima del caricamento
-- rallenta il COPY di un ordine di grandezza su 1,4 milioni di righe.

\timing on

-- ---------------------------------------------------------------------------
-- vehicle_color_lookup: la tabella su cui si fanno le ricerche
-- ---------------------------------------------------------------------------

-- I dati sorgente sono in maiuscolo. Gli indici su lower() servono perche'
-- le ricerche reali saranno quasi sempre case-insensitive.
CREATE INDEX idx_vcl_make_model    ON vehicle_color_lookup (lower(make), lower(model));
CREATE INDEX idx_vcl_make          ON vehicle_color_lookup (lower(make));
CREATE INDEX idx_vcl_owner_code    ON vehicle_color_lookup (owner_color_code);
CREATE INDEX idx_vcl_color_code    ON vehicle_color_lookup (color_code);
CREATE INDEX idx_vcl_paint_system  ON vehicle_color_lookup (paint_system_number);

-- ---------------------------------------------------------------------------
-- formula_ingredients: dal codice colore alla ricetta
-- ---------------------------------------------------------------------------

CREATE INDEX idx_fi_color_paint  ON formula_ingredients (color_code, paint_system_number);
CREATE INDEX idx_fi_formulas_id  ON formula_ingredients (formulas_id);
CREATE INDEX idx_fi_product      ON formula_ingredients (product_number);

-- Indice parziale sulle sole ricette correnti: e' la ricerca abituale, e
-- l'indice risulta molto piu' piccolo escludendo le 71.099 righe storiche.
CREATE INDEX idx_fi_current ON formula_ingredients (color_code)
    WHERE is_history = false;

-- ---------------------------------------------------------------------------
-- Tabelle di supporto
-- ---------------------------------------------------------------------------

CREATE INDEX idx_formulas_color   ON formulas (color_code);
CREATE INDEX idx_formulas_ps      ON formulas (paint_system_number);
CREATE INDEX idx_colors_color_id  ON colors (color_id);
CREATE INDEX idx_colors_code      ON colors (color_code);
CREATE INDEX idx_notes_color      ON color_usage_notes (color_code);
CREATE INDEX idx_related_make     ON related_colors (lower(make), lower(model));
CREATE INDEX idx_related_color    ON related_colors (color_code);
CREATE INDEX idx_variants_std     ON variants (standard_color_code);
CREATE INDEX idx_products_number  ON products (product_number);
CREATE INDEX idx_makes_models     ON makes_models (lower(make), lower(model));

-- ---------------------------------------------------------------------------
-- Vista di comodo per il caso d'uso principale
-- ---------------------------------------------------------------------------

-- Proiezione ridotta ai campi che servono per "veicolo -> codice colore".
CREATE OR REPLACE VIEW v_vehicle_colors AS
SELECT make,
       model,
       is_brand_level,
       year_min,
       year_max,
       owner_color_code,
       color_description,
       color_family,
       color_code,
       paint_system_number,
       paint_system_short
FROM vehicle_color_lookup;

-- Ricerca per marca e modello, con fallback sulle righe a livello marca.
-- Le righe con is_brand_level = true sono colori validi per tutta la marca:
-- ometterle perderebbe oltre meta' delle associazioni disponibili.
CREATE OR REPLACE FUNCTION cerca_colori(p_make text, p_model text DEFAULT NULL)
RETURNS TABLE (
    make                text,
    model               text,
    livello             text,
    anni                text,
    codice_oem          text,
    descrizione_colore  text,
    codice_colore       text,
    sistema             text
)
LANGUAGE sql STABLE AS $$
    SELECT v.make,
           v.model,
           CASE WHEN v.is_brand_level THEN 'marca' ELSE 'modello' END,
           CASE WHEN v.year_min IS NULL AND v.year_max IS NULL THEN NULL
                WHEN v.year_min = v.year_max THEN v.year_min::text
                ELSE concat_ws('-', v.year_min::text, v.year_max::text) END,
           v.owner_color_code,
           v.color_description,
           v.color_code,
           v.paint_system_short
    FROM vehicle_color_lookup v
    WHERE lower(v.make) = lower(p_make)
      AND (p_model IS NULL
           OR lower(v.model) = lower(p_model)
           OR v.is_brand_level)
    ORDER BY v.is_brand_level, v.model, v.year_min;
$$;

ANALYZE;
