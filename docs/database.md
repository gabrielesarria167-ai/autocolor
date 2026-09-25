# The `autocolor` database

Three tables: `requests` (quote requests and walk-ins), `paint_orders`
(matizado orders) and `worker_notes` (what the boss told each worker). The
schema is `server/schema.sql`; every query is in `server/db.js`.

The colour catalogue is a **different** database; see
[colour-database.md](colour-database.md).

## Connecting

`server/db.js:27` builds one `pg.Pool` from one of two exclusive
configurations:

- **`DATABASE_URL` set** (Neon in production): the URL is the whole
  configuration. `max: 10`, `idleTimeoutMillis: 30s`,
  `connectionTimeoutMillis: 15s` (generous, because the first connection
  after Neon suspends pays the startup).
- **Not set** (local): `PGHOST` (`localhost`), `PGPORT` (`5434`),
  `PGDATABASE` (`autocolor`), `PGUSER`, `PGPASSWORD`; timeout 5 s.

They are not mixed on purpose. `pg` does
`Object.assign({}, config, parse(connectionString))`, so a `port` next to a
URL would be silently overridden. The local port is written in because the
default 5432 is the machine's general Postgres, and the app would otherwise
write to it without anyone noticing.

`pool.on('error', …)` (`:66`) logs and does nothing else. `pg` emits `error`
on the pool when an idle connection drops (Postgres restarted, Neon suspended),
and an `error` event with no listener is an uncaught exception that kills
Node. The pool already discards the broken client.

## Retries and "unreachable"

Neon suspends compute when idle. The first connection after that can time out
while it wakes. `db.js` retries **getting a connection**, and never the query:

```js
async function connect() {                       // server/db.js:136
    for (let attempt = 1; ; attempt++) {
        try {
            return await pool.connect();
        } catch (err) {
            if (!unreachable(err) || attempt >= CONNECT_ATTEMPTS) throw err;
            await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
        }
    }
}

async function query(text, values) {            // server/db.js:151
    const client = await connect();
    try { return await client.query(text, values); }
    finally { client.release(); }
}
```

If `pool.connect()` fails, nothing was sent, so asking again cannot create a
duplicate order. If the connection dies after the `INSERT` was sent, the error
propagates: one error is better than two identical orders with different codes.

`unreachable(err)` (`:112`) is true for socket error codes (`ENOTFOUND`,
`ETIMEDOUT`, `ECONNRESET`, …), Postgres admin-shutdown and startup codes
(`57P01`–`57P03`), the whole `08xxx` connection-exception class, and the
three code-less timeout messages `pg` and `pg-pool` produce. It deliberately
does **not** match a bare "timeout", which would also catch a statement timeout
(`57014`): that is a slow query or a bug, not a missing database. The server
uses the same function to answer `503` instead of `500`
([server.md](server.md#errors)).

`ping({ attempts })` (`:699`) is the startup check, with waits of 1 s, 2 s,
3 s between tries.

## Tracking codes

```js
function generateId() {                          // server/db.js:75
    return String(crypto.randomInt(1_000_000_000, 10_000_000_000));
}
```

Ten digits, never a leading zero (so it always prints as ten), drawn from a
CSPRNG. The code is the only credential for the public lookup, so it must not
be sequential or predictable. It is generated in Node, not in SQL, so it can
collide with an existing id. The primary key turns that into error `23505`,
and `createRequest()` / `createPaintOrder()` draw again, up to five times.
With 9 billion possible codes a clash is very rare.

`char(10)` pads, so every read does `row.id.trim()`.

## `requests`

Defined at `server/schema.sql:15`.

| Column | Type | Constraint / meaning |
| --- | --- | --- |
| `id` | `char(10)` PK | `^[0-9]{10}$`. The tracking code. |
| `brand`, `model` | `text` | Display names, not catalogue ids ("Yaris Sedán"). NULL only on very old rows. |
| `body_type` | `text` | One of eight body types. |
| `model_year` | `integer` | 1980–2100. The server applies the tighter current-year + 1 limit. |
| `plate` | `text` | `^[A-Z0-9]{3}-[A-Z0-9]{3}$`. |
| `mileage` | `integer` | ≥ 0. |
| `color_code` | `text` | Optional factory code. |
| `vehicle` | `text NOT NULL` | The 3D silhouette: `van`, `wagon`, `pickup`, `suv`. |
| `quality` | `text NOT NULL` | `standard`, `premium`, `custom`. |
| `parts` | `text[] NOT NULL DEFAULT '{}'` | GLB node ids of the chosen panels. |
| `first_name`, `last_name` | `text NOT NULL` | Non-blank. |
| `department`, `province` | `text` | Required by the wizard, not by the walk-in form. |
| `phone` | `text NOT NULL` | `+51` and nine digits. |
| `email`, `notes` | `text` | |
| `status` | `text NOT NULL DEFAULT 'recibido'` | One of eleven statuses. This `CHECK` is the final word; copies live in `server/server.js` and `src/statuses.js`. |
| `occupied_by` | `text[] NOT NULL DEFAULT '{}'` | Worker codes holding the vehicle. See below. |
| `created_at`, `updated_at` | `timestamptz` | `updated_at` kept by a trigger. |

### The `occupied_by` constraint

```sql
CHECK (cardinality(occupied_by) <= 2
       AND array_position(occupied_by, NULL) IS NULL
       AND (cardinality(occupied_by) < 2 OR occupied_by[1] <> occupied_by[2])
       AND array_to_string(occupied_by, ',') ~
           '^([A-Z]{2}[0-9]{5}(,[A-Z]{2}[0-9]{5})?)?$')
```

Line by line:

1. At most two holders. A car is painted by a pair.
2. No `NULL` element. `array_to_string` would silently skip one, so it is
   checked separately.
3. The two holders are different people. Only asked when there are two: on an
   empty array both subscripts are `NULL`, and `NULL <> NULL` is not false, so
   the `OR` keeps an empty array valid.
4. Each element is a worker code. A `CHECK` cannot contain a subquery
   (`unnest` with `bool_and`), so the array is joined with commas and matched
   against a regex that allows zero, one or two codes.

The server enforces the same rules, but this is what makes them true even if a
query had a bug.

### Indexes and trigger

`requests_status_created_at_idx` on `(status, created_at DESC)` serves the
queue listing. `requests_touch_updated_at()` sets `NEW.updated_at := now()`
before every `UPDATE`, so a status changed by hand in `psql` still gets a
fresh date.

## `paint_orders`

Defined at `server/schema.sql:243`. A separate table because it is a separate
trade: no vehicle stays at the shop, no panels, a shorter status list.

| Column | Meaning |
| --- | --- |
| `id` | Same kind of 10-digit code, same generator. |
| `method` | `code`, `model`, `reading`, `in_person`. |
| `brand`, `color_code`, `color_name` | NULL for an undefined `in_person` order. `color_code` is the factory code from the label. |
| `sw_code` | Sherwin-Williams id, when the colour came from the colour database. |
| `finish` | `solido`, `metalico`, `perlado`, `tricapa`. |
| `reading_l`, `reading_a`, `reading_b` | Optional CIELAB reading, `numeric` with two decimals. |
| `size` | Tin size as a gallon fraction id (`1_32` … `1_1`). |
| `units` | 1–20. |
| `price` | Whole soles, ≥ 0. **What the page showed**, not the bill. |
| `company` | The buying shop, non-blank. |
| `ruc`, `department`, `province` | No longer asked for; kept for old rows. |
| `first_name`, `last_name`, `phone`, `email`, `notes` | Contact. Email optional. |
| `hex` | `^#[0-9a-f]{6}$` swatch colour, from the colour database or the boss. |
| `status` | `recibido`, `preparacion`, `listo`, `entregado`, `cancelado`. |
| `created_at`, `updated_at` | Same trigger function as `requests`. |

## `worker_notes`

Defined at `server/schema.sql:381`. One row per worker (the primary key is
`worker_id`), so writing a note replaces the previous one.

| Column | Constraint |
| --- | --- |
| `worker_id` | PK, `^[A-Z]{2}[0-9]{5}$` |
| `note` | 1–500 characters after trimming |
| `written_by` | worker-code shape (the boss) |
| `updated_at` | set by the upsert, not by a trigger |

There is no foreign key: the roster lives in environment variables, not in a
table.

## How `schema.sql` migrates

The file is **idempotent**: applying it again changes nothing. It is both the
schema for a new database and the migration for an old one:

- `CREATE TABLE IF NOT EXISTS` creates tables on a fresh database.
- `ALTER TABLE … ADD COLUMN IF NOT EXISTS` adds columns that arrived later.
- Constraints whose allowed values changed are dropped and re-added under
  their own name (`requests_vehicle_check`, `requests_status_check`,
  `paint_orders_method_check`, `requests_occupied_by_check`). `CREATE TABLE IF
  NOT EXISTS` never updates an existing table's constraints.
- A `DO $$ … $$` block (`:137`) converts `occupied_by` from `text` to `text[]`
  only if its current type is not already an array. `ALTER COLUMN … TYPE` has
  no `IF`, and applying it twice would wrap an array in another array.
- Data fixes:
  - `vehicle = 'suv'` rows created **before** `2026-09-04 00:00+00` become
    `pickup`. The old "suv" silhouette was really a pickup. The date cutoff has
    an explicit time zone so the cutoff is the same from Lima and from Neon
    (UTC). Without the cutoff, every run would rewrite real SUV requests.
  - Retired statuses `presupuestado` → `recibido` and `en_taller` →
    `desmontaje_montaje`.
- All `paint_orders` migrations come **after** its `CREATE TABLE`. When they
  were above it, a fresh database aborted on the first `ALTER` of a table that
  did not exist yet, leaving `requests` and nothing else.

Two ways to apply it:

- `npm run db:schema` runs `psql -v ON_ERROR_STOP=1` against the local server
  on port 5434.
- `npm run db:migrate` runs `server/migrate.js`, which sends the whole file as
  **one parameterless query** through the app's own pool. With no parameters,
  `pg` uses the simple query protocol, which allows many statements (including
  `$$`-quoted function bodies) and runs them in one implicit transaction, so a
  failure leaves nothing half applied. On failure it prints the character
  position Postgres reported. With `DATABASE_URL=… npm run db:migrate` it
  migrates production. It is run by hand, never in Render's build command: a
  migration failure should not take the site down.

## The queries in `server/db.js`

### `createRequest(data)` (`:171`)

`INSERT_REQUEST` (`:79`) lists 18 columns and 18 placeholders, and returns
`id, status, created_at`. Retries on `23505` as described above. Returns
`{ id, status, createdAt }`.

### `findRequest(id)` (`:208`)

Selects only `id, brand, model, vehicle, first_name, last_name, status`. The
code travels on paper and in messages, so it must not be enough to get a
phone number or email.

### `listRequests({ status })` (`:412`)

```sql
SELECT … FROM requests
 WHERE ($1::text IS NULL OR status = $1)
   AND (status <> ALL($2::text[]) OR id IN (
         SELECT id FROM requests
          WHERE status = ANY($2::text[])
            AND ($1::text IS NULL OR status = $1)
          ORDER BY created_at DESC
          LIMIT 200))
 ORDER BY created_at DESC
```

with `$2 = ['entregado', 'cancelado']`. In words: every open job, whatever its
age, plus the 200 newest finished ones. A flat `LIMIT 200` used to hide an old
car that was still being painted once 200 newer requests arrived. The optional
status filter applies to both halves. It returns the phone (the panel is behind
the password and calling the customer is the job), `vehicle` and `parts` (for
the 3D parts view) and `partCount`.

### `listOccupied()` (`:468`)

Rows with `cardinality(occupied_by) > 0`, newest first, `LIMIT 500` as a
safety ceiling. No customer data: the monitor answers "who is on what".

### The single-statement pattern

The three statements that change occupancy or status share one shape, which
does the check, the change and the reason for a refusal atomically:

```sql
WITH cur AS (
    SELECT id, occupied_by FROM requests WHERE id = $1 FOR UPDATE
), upd AS (
    UPDATE requests r SET …
      FROM cur
     WHERE r.id = cur.id AND <the rule>
 RETURNING r.…
)
SELECT cur.occupied_by AS holders, upd.*
  FROM cur LEFT JOIN upd ON true
```

- `cur` locks the row (`FOR UPDATE`) and reports who held it at that moment.
- `upd` changes it only if the rule holds.
- The final `SELECT` returns one row with both: **zero rows** means the id
  does not exist; a row with **NULL `upd` columns** means the rule refused, and
  `holders` says why; otherwise the change happened.

A separate "read, then write" would leave a gap in which someone else could
change the row, and a refusal message could name the wrong person.

### `updateRequestStatus(id, status, viewerId)` (`:516`)

Rule: `cur.occupied_by @> ARRAY[$3::text]`, the caller is one of the holders.
The `SET` also clears `occupied_by` when the new status is finished:

```sql
occupied_by = CASE WHEN $2 = ANY($4::text[]) THEN '{}'::text[] ELSE r.occupied_by END
```

A delivered or cancelled car is in nobody's hands, and leaving it held kept it
on the boss's monitor forever. Returns `{ ok: true, id, status, occupiedBy,
updatedAt }` or `{ ok: false, reason: 'not_found' | 'forbidden', occupiedBy }`.

### `occupyRequest(id, workerId)` (`:566`)

```sql
UPDATE requests r SET occupied_by = r.occupied_by || $2::text
  FROM cur
 WHERE r.id = cur.id
   AND NOT (cur.occupied_by @> ARRAY[$2::text])
   AND cardinality(cur.occupied_by) < $3        -- MAX_HOLDERS = 2
```

The count is checked inside the statement that appends, on a locked row, so
two workers asking for the last place at once cannot both get it: the second
waits for the lock and then sees the array full. Taking a vehicle you already
hold is treated as success (idempotent). Returns `'full'` with the holders
otherwise.

### `releaseRequest(id, workerId)` (`:602`)

`array_remove(r.occupied_by, $2::text)`, only if the caller is a holder. The
other holder stays. Releasing a vehicle that is already free is a success.
Releasing one only others hold is `'forbidden'`.

### Paint orders

- `createPaintOrder(data)` (`:257`): 23 columns, same retry.
- `listPaintOrders({ status })` (`:329`): the same "all open + 200 newest
  finished" query as `listRequests`. No email, RUC, zone or reading.
- `updatePaintOrderStatus(id, status)` (`:353`): a plain `UPDATE … RETURNING`.
  Nobody "holds" a paint order.
- `definePaintOrder(id, data)` (`:372`): the `cur`/`upd` pattern with the rule
  `cur.method = 'in_person'`. Returns `'not_found'` or `'not_in_person'` on
  refusal. An order whose colour the customer chose on screen was quoted there,
  and rewriting it would change what they agreed to.

### Worker notes

- `listWorkerNotes()` (`:632`) and `findWorkerNote(workerId)` (`:640`).
- `setWorkerNote(workerId, note, writtenBy)` (`:659`):
  `INSERT … ON CONFLICT (worker_id) DO UPDATE SET …, updated_at = now()`. The
  `DEFAULT now()` only applies to the insert half, so the update sets it
  explicitly, or the date of the first note would stick forever.
- `clearWorkerNote(workerId)` (`:674`): `DELETE`. Deleting nothing is fine.

### `describe()` (`:718`)

"dbname at host", parsed from the URL, **never** the password, because it goes
into the host's log.

## Handy SQL

The end of `schema.sql` has queries for the shop: pending requests, one
request in full, a manual status change, and counts per status. Run them with
`npm run db:psql` locally.
