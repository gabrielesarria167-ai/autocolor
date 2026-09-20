-- Verifica del caricamento.
-- I valori attesi sono stati misurati sul database di origine al momento
-- della generazione del bundle. Se una riga riporta DIVERSO, il caricamento
-- di quella tabella e' incompleto.

\echo ''
\echo '=== 1. Conteggio righe ==='

WITH attesi (tabella, righe_attese) AS (
    VALUES ('vehicle_color_lookup', 1471129),
           ('formula_ingredients',  1645049),
           ('color_usage_notes',     422347),
           ('formulas',              257530),
           ('related_colors',        181820),
           ('colors',                 95059),
           ('variants',               21478),
           ('makes_models',            5232),
           ('products',                 786),
           ('paint_systems',             26)
), reali (tabella, righe_reali) AS (
    SELECT 'vehicle_color_lookup', count(*) FROM vehicle_color_lookup
    UNION ALL SELECT 'formula_ingredients', count(*) FROM formula_ingredients
    UNION ALL SELECT 'color_usage_notes',   count(*) FROM color_usage_notes
    UNION ALL SELECT 'formulas',            count(*) FROM formulas
    UNION ALL SELECT 'related_colors',      count(*) FROM related_colors
    UNION ALL SELECT 'colors',              count(*) FROM colors
    UNION ALL SELECT 'variants',            count(*) FROM variants
    UNION ALL SELECT 'makes_models',        count(*) FROM makes_models
    UNION ALL SELECT 'products',            count(*) FROM products
    UNION ALL SELECT 'paint_systems',       count(*) FROM paint_systems
)
SELECT a.tabella,
       a.righe_attese,
       r.righe_reali,
       CASE WHEN a.righe_attese = r.righe_reali THEN 'OK' ELSE 'DIVERSO' END AS esito
FROM attesi a
JOIN reali r USING (tabella)
ORDER BY a.righe_attese DESC;

\echo ''
\echo '=== 2. Distribuzione marca / modello ==='
\echo 'Attesi: 825.592 a livello marca, 645.537 a livello modello.'

SELECT CASE WHEN is_brand_level THEN 'marca' ELSE 'modello' END AS livello,
       count(*) AS righe,
       CASE WHEN (is_brand_level     AND count(*) = 825592)
              OR (NOT is_brand_level AND count(*) = 645537)
            THEN 'OK' ELSE 'DIVERSO' END AS esito
FROM vehicle_color_lookup
GROUP BY is_brand_level
ORDER BY is_brand_level;

\echo ''
\echo '=== 3. Coerenza delle ricette: i pesi devono sommare a 100 ==='
\echo 'Attese 257.530 ricette, di cui 255.044 entro 100 +/- 0,5 (99,0%).'
\echo 'Le 2.486 fuori intervallo sono una caratteristica dei dati di origine.'

WITH s AS (
    SELECT formulas_id, sum(weight_percentage) AS totale
    FROM formula_ingredients
    GROUP BY formulas_id
)
SELECT count(*)                                              AS ricette,
       count(*) FILTER (WHERE abs(totale - 100) < 0.5)       AS entro_100,
       round(100.0 * count(*) FILTER (WHERE abs(totale - 100) < 0.5)
             / count(*), 2)                                  AS percentuale,
       CASE WHEN count(*) = 257530
                 AND count(*) FILTER (WHERE abs(totale - 100) < 0.5) = 255044
            THEN 'OK' ELSE 'DIVERSO' END                     AS esito
FROM s;

\echo ''
\echo '=== 4. Valori NULL normalizzati correttamente ==='
\echo 'La stringa letterale NULL non deve comparire come testo da nessuna parte.'

SELECT 'vehicle_color_lookup.model'      AS colonna, count(*) AS occorrenze_stringa_null
FROM vehicle_color_lookup WHERE model = 'NULL'
UNION ALL
SELECT 'formula_ingredients.product_number', count(*)
FROM formula_ingredients WHERE product_number = 'NULL'
UNION ALL
SELECT 'formulas.alternate_code', count(*)
FROM formulas WHERE alternate_code = 'NULL';

\echo ''
\echo '=== 5. Query di esempio: VOLKSWAGEN GOLF ==='
\echo 'Deve restituire righe sia a livello modello sia a livello marca.'

SELECT * FROM cerca_colori('VOLKSWAGEN', 'GOLF') LIMIT 10;

\echo ''
\echo '=== 6. Query di esempio: dal codice colore alla ricetta ==='

SELECT formulas_id, layer_number, ingredient_order,
       product_number, product_description, weight_percentage
FROM formula_ingredients
WHERE color_code = '78001' AND is_history = false
ORDER BY layer_number, ingredient_order;
