# Database colori Sherwin-Williams Collision Core → Postgres

Bundle di caricamento generato il 20/09/2026 dal database
`MX.db` dell'installazione Lazzumix (versione dati `202606081414`).

Contiene l'intero database colori: 95.059 colori, 257.530 formule e 1.471.129
associazioni veicolo→colore su 26 sistemi di verniciatura.

## Prerequisiti

Postgres già installato, con `psql` nel PATH. Nessun altro requisito: i dati sono
CSV e gli script sono SQL standard. Non serve essere superutente.

Spazio su disco: circa 400 MB per i CSV estratti, più circa 1,2 GB per il database
Postgres risultante (dati più indici).

## Caricamento

Estrai l'archivio e, **dalla cartella del bundle** (i percorsi nei `\copy` sono
relativi), esegui:

```bash
psql -U postgres -c "CREATE DATABASE colordb"
psql -U postgres -d colordb -f 01_schema.sql
psql -U postgres -d colordb -f 02_load.sql
psql -U postgres -d colordb -f 03_indexes.sql
psql -U postgres -d colordb -f 04_verify.sql
```

Su Windows con PowerShell è identico. Se l'utente non è `postgres`, sostituiscilo.

Tempi indicativi su un SSD: il caricamento richiede qualche minuto, la creazione
degli indici altrettanto. `02_load.sql` e `03_indexes.sql` hanno `\timing on`,
quindi vedrai la durata di ogni passo.

`04_verify.sql` stampa i conteggi attesi a fianco di quelli reali: se una riga
mostra `DIVERSO`, il caricamento di quella tabella è incompleto.

## Struttura

| Tabella | Righe | Contenuto |
|---|---:|---|
| `vehicle_color_lookup` | 1.471.129 | **Tabella principale**: marca, modello, anni, codice OEM → codice colore |
| `formula_ingredients` | 1.645.049 | Ricette, un ingrediente per riga |
| `color_usage_notes` | 422.347 | Note d'uso per colore e marca |
| `formulas` | 257.530 | Ricette in formato largo, 15 ingredienti per riga |
| `related_colors` | 181.820 | Colori correlati |
| `colors` | 95.059 | Anagrafica colori |
| `variants` | 21.478 | Varianti di colore |
| `makes_models` | 5.232 | Indice marche e modelli |
| `products` | 786 | Basi e prodotti, con densità e dati VOC |
| `paint_systems` | 26 | Sistemi di verniciatura |

Relazioni:

```
vehicle_color_lookup.color_code
    -> formula_ingredients.color_code   (+ paint_system_number)
        -> products.product_number
```

`colors.color_id` corrisponde a `vehicle_color_lookup.color_code`.
Il campo `colors.color_code` è invece vuoto su 6.220 righe e non va usato come chiave.

Non sono definite foreign key: i dati sorgente non sono perfettamente consistenti
dal punto di vista referenziale e i vincoli farebbero fallire il caricamento.

## Tre cose da sapere prima di scrivere query

### 1. Il 56% dei colori è associato alla marca, non al modello

`model` è NULL su 825.592 righe di 1.471.129. Non è un dato mancante: la sorgente
associa molti colori all'intera marca anziché a un modello specifico. La colonna
`is_brand_level` distingue i due casi.

Solo 248 marche su 534 hanno dati di modello. Per marche come HUMMER (2.086 righe
con modello su 23.235) la quasi totalità dei colori esiste solo a livello marca.

**Una ricerca che filtra solo su `model` perde più della metà dei colori disponibili.**
Va sempre incluso il fallback:

```sql
WHERE lower(make) = lower('VOLKSWAGEN')
  AND (lower(model) = lower('GOLF') OR is_brand_level)
```

C'è una funzione che lo fa già:

```sql
SELECT * FROM cerca_colori('VOLKSWAGEN', 'GOLF');
SELECT * FROM cerca_colori('FIAT');           -- tutti i colori della marca
```

### 2. Le formule storiche convivono con quelle correnti

71.099 righe di `formulas` hanno `is_history = true`: sono versioni superate che
condividono lo stesso `color_code` con la versione corrente.

**Raggruppa sempre per `formulas_id`, mai per `color_code`**, altrimenti gli
ingredienti delle due versioni si mescolano. Per le sole ricette attuali filtra
`is_history = false`.

### 3. Gli anni a 0 sono diventati NULL

Nella sorgente `YearMinimum = 0` (48.998 righe) significa "non specificato". Qui è
NULL, perché 0 non è un anno.

## Query di esempio

Colori di un veicolo:

```sql
SELECT * FROM cerca_colori('TOYOTA', 'COROLLA');
```

Dal codice colore alla ricetta, solo versione corrente:

```sql
SELECT formulas_id, layer_number, ingredient_order,
       product_number, product_description, weight_percentage
FROM formula_ingredients
WHERE color_code = '78001' AND is_history = false
ORDER BY layer_number, ingredient_order;
```

Ricerca per codice colore del costruttore:

```sql
SELECT make, model, year_min, year_max, color_description, color_code, paint_system_short
FROM vehicle_color_lookup
WHERE owner_color_code = '0001'
ORDER BY make, model;
```

Ricerca testuale sulla descrizione del colore:

```sql
SELECT DISTINCT make, color_description, color_code, paint_system_short
FROM vehicle_color_lookup
WHERE color_description ILIKE '%oakgruen%';
```

Verifica di una ricetta: i pesi devono sommare a 100.

```sql
SELECT formulas_id, color_code, round(sum(weight_percentage), 2) AS totale
FROM formula_ingredients
WHERE color_code = '78001' AND is_history = false
GROUP BY formulas_id, color_code;
```

Vale per 255.044 ricette su 257.530. Le 2.486 fuori intervallo sono concentrate nei
sistemi 2S, 44, 04, 2P, 94 e 96: è una caratteristica dei dati di origine, non
dell'estrazione.

## Note sulla conversione

I dati sorgente hanno alcune particolarità che sono state normalizzate qui:

- La sorgente memorizza la **stringa di testo `NULL`** al posto del valore SQL NULL
  (68.949 righe sul solo `ProductNumber_05`, e la totalità di `ContainsAluminum`).
  È stata convertita in NULL vero. Per questo `products.contains_aluminum` è
  interamente NULL: nella sorgente non era mai valorizzato.
- `formulas.revision_date` è **testo, non timestamp**: la sorgente contiene date
  malformate che una colonna `timestamp` rifiuterebbe, scartando righe per il resto
  valide.
- I decimali usano il punto e i CSV sono UTF-8 **senza BOM**, come richiede il
  `COPY` di Postgres.
- `position` della sorgente è stata rinominata `color_position`, perché `POSITION`
  in Postgres è una funzione.

## Se qualcosa va storto

**`could not open file ... for reading`** — stai eseguendo `psql` da una cartella
diversa da quella del bundle. I percorsi nei `\copy` sono relativi.

**`extra data after last expected column`** — il CSV e lo schema sono disallineati.
Rigenera il bundle: `01_schema.sql` e `02_load.sql` sono prodotti dalla stessa
definizione e non possono divergere se generati insieme.

**Caricamento molto lento** — verifica di aver eseguito `03_indexes.sql` *dopo*
`02_load.sql` e non prima.
