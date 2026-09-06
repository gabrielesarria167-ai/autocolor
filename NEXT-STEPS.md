# Next steps — email delivery and the review findings

Working notes for the email work. Same shape as
[`LAUNCH-CHECKLIST.md`](LAUNCH-CHECKLIST.md): each item says what it is and,
where it matters, **what I need from you**. Site copy stays in Spanish; these
notes are English like the rest of the docs.

---

## Where it stands

| | |
|---|---|
| Shop panel 503 | Fixed — `AUTOCOLOR_WORKER_IDS` declared in `render.yaml` and set in Render |
| Worker codes on login | Password + code, one shared error, code in the session and in `whoami` |
| Required fields | email, Departamento, Provincia enforced in the wizard and in `validateRequest` |
| Two emails | Built, laid out on the supplied mock, escaped, plain-text half included |
| Email delivery | **Moved off Gmail SMTP to the Brevo API — on branch `mail-brevo`, needs your account (§1)** |
| Review findings | 13 of 15 closed; the 2 left are not about email (§2) |

---

## 1. Delivery: Brevo over HTTPS

Gmail SMTP is gone. It never worked from Render — four rounds, and the
measurement that settled it: a healthy connect to `smtp.gmail.com:587` takes
**22 ms**, and Render's timed out at 15,000 ms without an answer, on both 465
and 587. Longer timeouts, forced IPv4, one transport per attempt and a
six-attempt retry ladder over 48 minutes all failed to change it. A closed path
does not open by retrying.

Notices now go out as one HTTPS request to `https://api.brevo.com/v3/smtp/email`.
Port 443 is never blocked, and Brevo verifies **a single sender address** rather
than a whole domain — which is what makes it usable here, since the shop has no
domain of its own. `nodemailer` is gone with it, so `pg` is the only dependency
again.

### Needs from you

1. Create a free account at <https://www.brevo.com>.
2. **Verify `gabrielesarria167@gmail.com` as a sender** — Brevo → Senders, then
   click the link in the confirmation email. Without this the API answers `400`
   and sends nothing.
3. Create an API key — Brevo → SMTP & API → API keys.
4. In Render, add `AUTOCOLOR_BREVO_KEY` with that key, and **delete
   `AUTOCOLOR_SMTP_USER` and `AUTOCOLOR_SMTP_PASS`**, which nothing reads any
   more. Restart the service.

Then the deploy log says, on its own, whether it works:

```
Correos de aviso: listos (Brevo, de Autocolor <…>, cuenta …).      ← working
Correos de aviso: NO FUNCIONAN — 401 Unauthorized — Key not found  ← the key
Correos de aviso: NO FUNCIONAN — 400 … sender.email is not valid   ← sender not verified
```

The boot check asks Brevo for the account rather than sending a test message,
so it costs nothing and nobody receives anything.

### What I could not test

Everything is exercised against a fake Brevo that mimics the documented API —
request shape, headers, UTF-8 bodies, `401`/`400`/`429`/`500` handling, timeouts
and the retry rules — plus a full run through the real server. **What I could
not test is the real service**, since that needs your key. The request is built
strictly to Brevo's published API, but the first real send is the proof.

The free plan is **300 emails/day**. At two per request that is 150 requests a
day, well above what the shop gets.

### One design consequence worth knowing

The logo used to travel inside the message, referenced by `cid:`. Brevo's API
has no way to express that — an inline attachment needs a `Content-ID` MIME
header, and its attachment list only takes named files. So the logo is now a
normal image URL pointing at the site's own `/imgs/logoEmail.jpg`, which is
public and already served. Where there is no site URL (a dev machine), the
layout writes the shop's name instead of showing a broken image.

---

## 2. Code review findings

From a max-effort review of `git diff 0079023..HEAD`. **13 of 15 are closed.**
Needs nothing from you. Details of the closed ones are in the git history; the
two that remain:

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

The SMTP credentials alert of Sept 6 fired on a placeholder in `.env.example`,
not a real secret: a commented host + gmail user + sixteen lowercase letters
reads exactly like a Google app password. Your real `.env` has never been
committed (`git log --all --diff-filter=A -- .env` is empty). That placeholder
is gone entirely now — there is no SMTP config left to look credential-shaped.

**Needs from you:** mark the alert as a false positive. Nothing to revoke.

### 3.3 The footer email address

`index.html` advertises `info@autocolorayacucho.com`, which nobody can receive
at. Customers replying there get nothing. Already flagged as item B2 in
`LAUNCH-CHECKLIST.md`.

**Needs from you:** either point it at the Gmail or drop the row.

---

## Suggested order

1. The Brevo account (§1), then merge `mail-brevo` and deploy. Nothing else
   here matters until notices actually arrive.
2. Chores §3.1 and §3.2 — quick, and §3.1 is a two-minute config change.
3. Findings #6 and #7.

---

## Useful while working

```bash
node tools/mailpreview.js          # both emails, text + HTML written to disk
```

`MAILPREVIEW_OUT=<dir>` chooses where the HTML lands. With no
`AUTOCOLOR_SITE_URL` set it points itself at the repo, so the logo and the
buttons render when you open it in a browser.
