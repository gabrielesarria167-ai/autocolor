# Next steps — email delivery and the review findings

Working notes for the email work. Same shape as
[`LAUNCH-CHECKLIST.md`](LAUNCH-CHECKLIST.md): each item says what it is and,
where it matters, **what I need from you**. Site copy stays in Spanish; these
notes are English like the rest of the docs.

Everything below is committed and pushed to `main`. Nothing is half-applied.

---

## Where it stands

| | |
|---|---|
| Shop panel 503 | Fixed — `AUTOCOLOR_WORKER_IDS` declared in `render.yaml` and set in Render |
| Worker codes on login | Password + code, one shared error, code in the session and in `whoami` |
| Required fields | email, Departamento, Provincia enforced in the wizard and in `validateRequest` |
| Two emails | Built, laid out on the supplied mock, escaped, plain-text half included |
| Email delivery | **Retried, not fixed at the source — see §1** |
| Review findings | 13 of 15 closed; the 2 left are not about email (§2) |

---

## 1. Delivery: Gmail SMTP kept, with a queue in front of it

The decision was to stay on Gmail SMTP rather than move to an HTTPS provider.
That is workable, but only because the sending path no longer assumes a send
either succeeds or is lost.

**What the problem actually is.** A healthy TCP connect to `smtp.gmail.com:587`
completes in **22 ms**. From Render it times out at what was then 60,000 ms,
across two different Gmail IPs (`142.251.127.108`, `192.178.155.109`), and then
works on the next try. Nothing is slow — packets get dropped, in stretches. So
raising the timeout never helped: it only made each failure slower to report.

**What now happens instead.** `notifyNewRequest()` puts both messages in a queue
and returns. The queue sends one at a time and retries what fails, six attempts
over about 48 minutes (30 s, 2 min, 5 min, 15 min, 30 min). The gaps are wide on
purpose: a retry two seconds later lands in the same bad stretch, and
`smtp.gmail.com` rotates its A record every ~135 s, so waiting also changes the
IP — and the route — being tried.

Three things fell out of that and are worth knowing:

- Timeouts are back down to **15 s / 15 s / 30 s**. What rescues a mail is
  trying again later, not waiting longer inside one attempt.
- The connection **pool is gone**; each attempt builds and drops its own
  transport. The pool was shared state that one request's error handling could
  tear down under another request's send — and `sendMail()` on a closed pool
  neither resolves nor rejects, so that mail vanished with no log line at all.
- A **5xx is not retried**. 535 (bad app password) and 550 (no such address) do
  not improve with repetition, and retrying 535 hands Google five failed logins
  from one IP.

**How to read the deploy log now:**

```
Correos de aviso: listos (smtp.gmail.com 142.251.127.108:587, de …)   ← working
Correos de aviso: NO FUNCIONAN — <reason> (host ip:port, tras N s)    ← broken, reason given
Correos de aviso: apagados — faltan …                                 ← not configured
```

```
[mail] falló aviso al taller de 4820175639, se reintenta en 30 s: …   ← normal, wait for it
[mail] salió aviso al taller de 4820175639 (al intento 2)             ← it arrived
[mail] no salió aviso al taller de 4820175639: …                      ← actually lost
```

`GET /api/staff/whoami` returns a `mail` block with the account, the address
actually connected to, and `pending` — how many notices are waiting. A `pending`
that does not fall between two calls is the sign that mail is down.

### If it still is not enough

**Needs from you, only if mail keeps not arriving.** The queue turns "lost" into
"late", but it cannot fix a stretch that lasts longer than 48 minutes. The way
out is HTTPS on port 443, which no host blocks. Brevo is the one to use: it
verifies a **single sender address** rather than a whole domain, so your Gmail
is enough — that is why it beats Resend/SendGrid here, since the shop has no
domain of its own.

1. Create a free account at <https://www.brevo.com>.
2. Verify `gabrielesarria167@gmail.com` as a sender (Senders → confirmation
   link sent to that inbox).
3. Put the API key in Render as `AUTOCOLOR_BREVO_KEY`.

Then only the transport half of `server/mail.js` changes — roughly 60 lines.
The queue, the message builders, both layouts, the escaping and
`tools/mailpreview.js` are all transport-independent and stay as they are.
`nodemailer` gets dropped, so `pg` becomes the only dependency again.

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

## 2. Code review findings

From a max-effort review of `git diff 0079023..HEAD`. **12 of 15 are closed.**
Needs nothing from you.

### Closed

| # | Where | What it was |
|---|---|---|
| 1 | `server/mail.js` | Per-request code tore down the process-wide pool; `sendMail` on a closed pool never settled, so mails vanished with no log line. **Pool removed entirely** — one transport per attempt, nothing shared to tear down. |
| 2 | `server/server.js` | `notifyNewRequest` was async, called with no `.catch()`, and could reject — which exits the process on Node 24, after the 201 was sent. It is **synchronous now** and catches its own message-building errors; a process-wide `unhandledRejection` handler backs that up. |
| 3 | `server/mail.js` | Text and HTML guarded mileage differently, so an absent mileage threw. Both halves now call one `mileageLabel()`. |
| 4 | `server/mail.js` | `partLabel` resolved `Object.prototype` keys, so `parts: ['constructor']` put `function Object() { [native code] }` in the shop email. All four label maps go through `Object.hasOwn` now. |
| 5 | `server/server.js` | `mail.close()` ran before `server.close()` on SIGTERM, aborting in-flight mail on every redeploy. Order reversed. |
| 8 | `server/mail.js` | Retry fired on any error class, discarding a warm connection on a permanent 535/550, while `verify()` at boot had no retry and cried wolf on one transient timeout. Retry is now inside the queue and gated on `isPermanent()`; `verify()` gets two tries. |
| 9 | `tools/mailpreview.js` | The `cid:` rewrite was greedy past attribute boundaries and the replacement string was unescaped, so the preview could differ from the real email. |
| 10 | `server/mailhtml.js` | `footerNote` was the one unescaped interpolation in `shell()`. |
| 11 | `server/mail.js` | The logo was re-read from disk per email; it is read once at load, and a missing file degrades instead of refusing to boot. |
| 12 | `server/mailhtml.js` | `SHOP_ADDRESS` / `SHOP_HOURS` duplicated `index.html` with no keep-in-sync note and an accent already drifted. Note added, accent fixed in `index.html`. |
| 13 | `server/mail.js` | Text and HTML recomputed the same derived fields separately — which is how #3 happened. `mileageLabel`, `zoneLabel` and `vehicleName` are shared through `htmlContext()`. |
| 14 | `tools/mailpreview.js` | The one degraded-rendering fixture tested a payload `validateRequest` can no longer produce. Split into a realistic minimum and a `LEGACY` row for the pre-requirement case. |

#15 went with them: `row()` lost its always-`16` width argument, `eyebrow()`
its never-passed colour, `escapeHtml` is no longer exported unused,
`tools/mailpreview.js` uses English identifiers like the rest of the repo, and
a successful staff login is logged at `console.log` rather than `console.warn`.

### Still open — neither of them about email

| # | Where | What |
|---|---|---|
| 6 | `server/auth.js:81` | `verifyWorkerId` checks membership but not shape, while the browser hard-enforces `[A-Za-z]{2}[0-9]{5}`. A code like `JEFE` in the env var is accepted server-side and blocked client-side: that person can never log in, and the error blames their typing. |
| 7 | `src/repair.js:835` | Clearing the email field hides the error but leaves Confirmar disabled with no explanation — the `input` handler still encodes "empty email is valid". |

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

1. Deploy and send a test request. Watch for `salió … (al intento N)` in the
   log; N > 1 is the queue doing its job, not a problem.
2. Chores §3.1 and §3.2 — quick, and §3.1 is a two-minute config change.
3. Findings #6 and #7.
4. Brevo (§1), only if mail is still not arriving after the queue.

---

## Useful while working

```bash
node tools/mailpreview.js          # both emails, text + HTML written to disk
```

`MAILPREVIEW_OUT=<dir>` chooses where the HTML lands; the logo is rewritten to
the repo file so it opens in a browser.
