# Workshop login, roster and sessions

The workshop panel (`pgs/taller.html`) is a static page anyone can download.
What protects the data is the API: every `/api/staff/*` route checks a
session on the server. This guide covers `server/auth.js`, `server/names.js`,
and the rules the staff routes apply.

## The model in one paragraph

There is **one shared password** (`AUTOCOLOR_STAFF_PASSWORD`) that everyone at
the shop knows, and **one code per person** (`AUTOCOLOR_WORKER_IDS`), two
letters and five digits, such as `AB12345`. Logging in needs both: the
password is the secret, the code says who came in. One code can be the
**boss** (`AUTOCOLOR_BOSS_ID`). Sessions are random tokens kept in memory for
eight hours and sent in an `HttpOnly`, `SameSite=Strict` cookie.

## Configuration is read once

`server/auth.js` requires `./env` first, then reads the three variables **at
module load**. Changing any of them means restarting the process.

### Parsing the roster: `parseRoster(raw, variable)` (`:56`)

```
AUTOCOLOR_WORKER_IDS=AB12345:Ana Bravo,CD67890:Carlos Díaz
```

For each comma-separated entry:

1. Split at the first `:`. The left side is the code, the right side the name.
2. The code is trimmed and upper-cased. Empty entries are skipped.
3. A code that does not match `^[A-Z]{2}[0-9]{5}$` is **skipped with a
   warning**. The database columns that store codes (`occupied_by`,
   `worker_notes.worker_id`) check the same shape, so a code like `JEFE` would
   log in and then fail with a `500` on the first vehicle it took.
4. The name is trimmed and kept as written (it is shown as written). It is
   optional; without it the panel shows the code.

It returns `{ codes: Set, names: Map }`.

### The boss (`:92-101`)

`AUTOCOLOR_BOSS_ID` is parsed the same way. Only the first code counts (a
warning is printed if there are more). Then:

- the boss's name is added to the shared name map;
- the boss's code is **removed** from the worker set. Listed in both, the boss
  would appear in his own monitor as a worker holding nothing, and could be
  sent notes.

The boss does not need to be listed in `AUTOCOLOR_WORKER_IDS`;
`verifyWorkerId()` accepts his code on its own.

## Functions

| Function | Line | Returns |
| --- | --- | --- |
| `isConfigured()` | 108 | Whether a password is set. Without one, every staff route is `503`. |
| `hasWorkerIds()` | 129 | Whether anyone can log in: any worker, or a boss. |
| `isBoss(code)` | 134 | Case-insensitive comparison with the boss code; `false` if there is none. |
| `listWorkerIds()` | 148 | Sorted worker codes, boss excluded. The monitor uses it to show idle workers. |
| `workerName(code)` | 158 | Configured name or `''`. |
| `verifyPassword(entered)` | 120 | Constant-time comparison (below). |
| `verifyWorkerId(entered)` | 172 | The normalised code if it is the boss's or on the roster, else `''`. |
| `createSession(workerId)` | 179 | A new token. |
| `readSession(req)` | 206 | The token if its session is alive, else `''`. Expired sessions are deleted on read. |
| `sessionWorkerId(req)` | 218 | The worker code of the live session, or `''`. |
| `destroySession(token)` | 185 | Deletes it. |
| `cookieHeader(token)` / `clearCookieHeader()` | 228 / 240 | `Set-Cookie` values. |

### Comparing the password

```js
function verifyPassword(entered) {
    if (!isConfigured() || typeof entered !== 'string' || entered.length === 0) return false;
    const a = crypto.createHash('sha256').update(entered).digest();
    const b = crypto.createHash('sha256').update(PASSWORD).digest();
    return crypto.timingSafeEqual(a, b);
}
```

`timingSafeEqual` needs equal-length buffers. Hashing both sides first makes
them 32 bytes each, whatever was typed, so the comparison time says nothing
about how many leading characters were right.

The worker code is **not** compared in constant time. It identifies, it is not
the secret, and the attempt limit slows blind guessing.

## Logging in

`POST /api/staff/login` in `server/server.js:1106`:

1. No password configured → `503`.
2. **Five failed attempts a minute** per IP (or IPv6 /64) → `429`. The handler
   reads the `login:<ip>` bucket without incrementing it. Only failures are
   counted, because the whole shop logs in from one address at shift change.
3. No worker codes configured → `503`. Otherwise the panel would open to
   anyone with the password, without identifying them.
4. The body must be an object.
5. **Both checks always run**:
   ```js
   const workerId = auth.verifyWorkerId(body.workerId);
   const passwordOk = auth.verifyPassword(body.password);
   if (!workerId || !passwordOk) { rateLimit(loginKey, 5); … 401 }
   ```
   Short-circuiting on an unknown code used to skip the password hash, and the
   faster answer told a prober which codes did not exist. The `401` message
   does not say which of the two was wrong, for the same reason.
6. On success: a log line, `Set-Cookie` with a new session, and
   `{ ok: true, workerId }`.

## Sessions and the cookie

```js
const sessions = new Map();   // token -> { expiresAt, workerId }
const token = crypto.randomBytes(32).toString('base64url');
```

- **In memory.** A restart (every deploy, and Render's free-plan idle
  shutdown) logs everyone out. That was chosen over a sessions table: the
  panel serves a handful of people, and a table is more to maintain.
- **Eight hours** (`SESSION_MS`), one working day. The cookie's `Max-Age`
  matches.
- **Cookie**: `autocolor_staff=<token>; HttpOnly; SameSite=Strict; Path=/;
  Max-Age=28800`, plus `Secure` when `AUTOCOLOR_STAFF_COOKIE_SECURE=1`.
  `HttpOnly` keeps scripts from reading it. `SameSite=Strict` keeps browsers
  from sending it on requests started by another site, which is what protects
  the state-changing staff routes from cross-site request forgery.
- `parseCookies()` (`:191`) is a minimal `a=1; b=2` parser. There is only one
  cookie and its value is base64url, so nothing needs decoding.
- An hourly, `unref`'d `setInterval` (`:245`) deletes expired sessions.

## Worker names: `server/names.js`

```js
function nameFor(workerId) {
    const code = String(workerId || '').trim().toUpperCase();
    if (!CODE_RE.test(code)) return '';
    return auth.workerName(code);
}
```

The single place a name is decided. The server attaches names to every row it
sends (`withHolders()` in `server.js`), so the browser never keeps its own copy.
It returns `''` for an unknown or unnamed code, and every caller then shows the
code. (An older version invented a name from the initials; a made-up name next
to real ones was worse than a bare code.)

## Who may do what

The server enforces all of this. The panel only hides controls that would be
refused.

| Action | Worker | Boss |
| --- | --- | --- |
| See the vehicle queue and paint orders | yes | yes |
| Take, join or release a vehicle | yes | **no** (`refuseBoss`) |
| Change a vehicle's status | only while holding it | **no** |
| Change a paint order's status | yes | **no** |
| See the monitor (who holds what) | no (`requireBoss`) | yes |
| Write or remove a note on a worker | no | yes |
| Register a walk-in vehicle | no | yes |
| Define or edit an `in_person` paint order | no | yes |
| `whoami` details (proxy headers, mail config) | own IP, code and role only | everything |

The boss runs the shop rather than working on cars. If he could take a
vehicle, he would appear as a row in his own monitor.

## What the browser sees

`GET /api/staff/requests` returns a `viewer` object:

```json
{ "workerId": "AB12345", "name": "Ana Bravo", "isBoss": false,
  "note": { "text": "…", "updatedAt": "…" } }
```

`isBoss` only chooses which profile the page draws. It grants nothing: every
boss-only route checks the session again on the server.

## Failure modes worth knowing

- Password set but no codes → login answers `503` «El panel del taller no está
  configurado…», and the startup log names `AUTOCOLOR_WORKER_IDS`.
- A code with the wrong shape in the environment → a warning at startup, and
  that person cannot log in.
- After a deploy, every open panel gets `401` on its next request and shows
  the login form with «Tu sesión venció».
