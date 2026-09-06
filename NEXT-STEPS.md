# Next steps — email delivery and the review findings

Working notes for the email work. Same shape as
[`LAUNCH-CHECKLIST.md`](LAUNCH-CHECKLIST.md): each item says what it is and,
where it matters, **what I need from you**. Site copy stays in Spanish; these
notes are English like the rest of the docs.

Everything below is committed and pushed to `main`. Nothing is half-applied.

---

## Where it stands

Shipped and working:

| | |
|---|---|
| Shop panel 503 | Fixed — `AUTOCOLOR_WORKER_IDS` declared in `render.yaml` and set in Render |
| Worker codes on login | Password + code, one shared error, code in the session and in `whoami` |
| Required fields | email, Departamento, Provincia enforced in the wizard and in `validateRequest` |
| Two emails | Built, laid out on the supplied mock, escaped, plain-text half included |
| Email delivery | **Not working reliably — see below** |

---

## 1. The blocker: SMTP from Render is not a usable transport

**This is the one thing stopping emails from arriving.** Four attempts: one
delivered, three timed out.

The measurement that settles it: a healthy TCP connect to `smtp.gmail.com:587`
completes in **22 ms**. On Render it times out at **60,000 ms**, across two
different Gmail IPs (`142.251.127.108`, `192.178.155.109`). Connections that
are going to succeed finish in tens of milliseconds. Nothing is slow — the
packets are being dropped.

Consequences of that, already learned the hard way:

- Raising `CONNECT_TIMEOUT_MS` from 10 s to 60 s fixed nothing. It only made
  each failure six times slower to report. The single success was luck.
- Port 465 is blocked by Render outright; 587 is what the code defaults to now
  (`server/mail.js:63`). Do not move it back.
- With the retry, a failing request now costs up to **4 minutes** of background
  work.

### The fix: Brevo over HTTPS

Port 443 is never blocked. Brevo verifies a **single sender address**, not a
whole domain, so your Gmail is enough — that is why it beats Resend/SendGrid
here, since the shop has no domain (the site lives on Render's subdomain, whose
DNS is Render's).

**Needs from you:**

1. Create a free Brevo account at <https://www.brevo.com>.
2. Verify `gabrielesarria167@gmail.com` as a sender (Senders → confirmation
   link sent to that inbox).
3. Put the API key in Render as `AUTOCOLOR_BREVO_KEY`.

Then I rewrite the transport half of `server/mail.js` — roughly 60 lines. The
message builders, both layouts, the escaping and `tools/mailpreview.js` are all
transport-independent and do not change. `nodemailer` gets dropped, so `pg`
becomes the only dependency again, and the SMTP env vars stop being read.

Shape of the call:

```js
await fetch('https://api.brevo.com/v3/smtp/email', {
  method: 'POST',
  headers: { 'api-key': KEY, 'content-type': 'application/json' },
  body: JSON.stringify({ sender, to, replyTo, subject, textContent, htmlContent }),
});
```

One thing to check when writing it: Brevo takes the inline logo as a base64
`content` in an `attachment` entry, not a file path, so the `cid:` reference in
`server/mailhtml.js` needs to keep working the same way.

---

## 2. Code review findings — 15, all confirmed

From a max-effort review of `git diff 0079023..HEAD`. These are
**transport-independent**: they need fixing whether or not the Brevo switch
happens. Needs nothing from you.

### Fix first — these lose mail or kill the process

| # | Where | What |
|---|---|---|
| 1 | `server/mail.js:484` | `close()` runs from per-request code but tears down the **process-wide** pool. `sendMail` on a closed pool **never settles** — no resolve, no reject, no log line. Under concurrency, mails vanish leaving nothing in the logs, and `notifyNewRequest` stays pending forever holding customer PII. Verified directly. |
| 2 | `server/server.js:687` | `notifyNewRequest` is called with no `.catch()` and there is no `unhandledRejection` handler, but it builds both messages **outside** the `try`, so it can reject. On Node 24 that exits the process — after the 201 was already sent, taking every staff session with it. |
| 3 | `server/mail.js:414` | Text builder guards only `mileage === null`; the HTML builder guards `null` and `undefined`. An absent mileage throws — and via #2 that is a crash, not a lost mail. |
| 4 | `server/mail.js:172` | `partLabel` resolves `Object.prototype` keys. `parts: ['constructor']` passes `PART_RE` and puts `function Object() { [native code] }` into the shop email. Use `Object.create(null)` or `Object.hasOwn`. |
| 5 | `server/server.js:866` | `mail.close()` runs before `server.close()` on SIGTERM, aborting in-flight mail on every redeploy and spin-down. |

### Then — real but not fatal

| # | Where | What |
|---|---|---|
| 6 | `server/auth.js:81` | `verifyWorkerId` checks membership but not shape, while the browser hard-enforces `[A-Za-z]{2}[0-9]{5}`. A code like `JEFE` in the env var is accepted server-side and blocked client-side: that person can never log in, and the error blames their typing. |
| 7 | `src/repair.js:835` | Clearing the email field hides the error but leaves Confirmar disabled with no explanation — the `input` handler still encodes "empty email is valid". |
| 8 | `server/mail.js:485` | Retry and pool teardown fire on **any** error class, so a permanent 535/550 discards a warm connection. Meanwhile `verify()` at boot has no retry, so one transient timeout prints `NO FUNCIONAN` — the false alarm it exists to prevent. Retry belongs inside `send()`, gated on transient codes. |
| 9 | `tools/mailpreview.js:67` | `cid:` rewrite is greedy past attribute boundaries (body text is escaped, so `[^"]+` cannot stop) and `logo` is an unescaped replacement string. The preview can differ from the real email. |
| 10 | `server/mailhtml.js:192` | `footerNote` is the one unescaped interpolation in `shell()`. No live failure — both callers pass literals — but it is the single gap in the escape discipline. |

### Cleanup

| # | Where | What |
|---|---|---|
| 11 | `server/mail.js:105` | Logo re-read from disk per email (`path:` → `createReadStream` per message). `content: fs.readFileSync(...)` once at load. |
| 12 | `server/mailhtml.js:50` | `SHOP_ADDRESS` / `SHOP_HOURS` are a third copy of values in `index.html:583,596`, with no keep-in-sync comment, and **already drifted** on their first commit. |
| 13 | `server/mailhtml.js:328` | Text and HTML halves recompute the same derived fields (`zone` ×3, `vehicle` ×2, mileage guard already diverged — that is finding #3). `htmlContext()` at `mail.js:200` is the seam. |
| 14 | `tools/mailpreview.js:43` | `MINIMAL` fixture sets `email`/`department`/`province` to `null`, which `validateRequest` can no longer produce. The only degraded-rendering case tests an impossible payload. |
| 15 | — | Minor: `row(width)` always `16`; `eyebrow(color)` never passed; `escapeHtml` exported unused; Spanish identifiers (`faltan`, `cliente`, `taller`, `escritos`) against the repo's English-identifier convention; successful login logged at `console.warn` (`server/server.js:631`) where every other warn marks an anomaly. |

---

## 3. Chores that need you

### 3.1 Rotate the worker codes

Three real codes (`JP64723`, `MG06602`, `CQ01447`) were committed to a public
repo in README, `render.yaml` and two source comments. They are removed from
`HEAD` but **remain in git history**, which removing them does not erase.

Not a breach — the password is the secret, the code only identifies — but it
undoes the design decision that login answers identically for a bad code and a
bad password, so probing cannot map which codes exist.

**Needs from you:** pick five new codes, update `AUTOCOLOR_WORKER_IDS` in
Render and in your local `.env`, restart the service. Rotating is much less
disruptive than rewriting history. Keep the `[A-Za-z]{2}[0-9]{5}` shape until
finding #6 is fixed.

### 3.2 GitGuardian alert — false positive

The SMTP credentials alert of Sept 6 fired on a placeholder in
`.env.example`, not a real secret: a commented host + gmail user + sixteen
lowercase letters reads exactly like a Google app password. Your real `.env`
has never been committed (`git log --all --diff-filter=A -- .env` is empty).
The placeholder is no longer credential-shaped.

**Needs from you:** mark the alert as a false positive. Nothing to revoke.

### 3.3 The footer email address

`index.html` advertises `info@autocolorayacucho.com`, which nobody can receive
at. Customers replying there get nothing. Already flagged as item B2 in
`LAUNCH-CHECKLIST.md`.

**Needs from you:** either point it at the Gmail or drop the row.

---

## Suggested order

1. Findings #1–#5 — silent mail loss and process crashes, independent of transport.
2. Brevo, once you have the account (§1) — this is what makes mail actually arrive.
3. Findings #6–#10.
4. Chores §3.1 and §3.2 — quick, and #3.1 is a two-minute config change.
5. Cleanup #11–#15.

---

## Useful while working

```bash
node tools/mailpreview.js          # both emails, text + HTML written to disk
```

`MAILPREVIEW_OUT=<dir>` chooses where the HTML lands; the logo is rewritten to
the repo file so it opens in a browser.

Reading the deploy log — the startup check runs on every boot and says whether
mail works at all, independent of any request:

```
Correos de aviso: listos (smtp.gmail.com 142.251.127.108:587, de …)   ← working
Correos de aviso: NO FUNCIONAN — <reason> (host ip:port, tras N s)    ← broken, reason given
Correos de aviso: apagados — faltan …                                 ← not configured
```

In the per-request log, `falló … reintentando` is a warning and the retry may
still succeed; only `no salió` is a real failure. A `?` where the address should
be means something closed the transport underneath that send — that is finding
#1.

`GET /api/staff/whoami` returns a `mail` block with the account and the address
actually connected to, never the password.
