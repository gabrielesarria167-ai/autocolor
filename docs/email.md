# Email notices

Every new quote request and every paint order sends two emails: a
confirmation to the customer with their tracking code, and a notice to the
shop with the details. Walk-ins registered by the boss send the same two, with
different wording.

Files: `server/mail.js` (content, queue, transport), `server/mailhtml.js`
(the HTML layouts) and `server/netcheck.js` (network diagnosis).

## The three rules

1. **An email can never lose a request.** The row is stored and the `201` is
   sent before any email is attempted. `notifyNewRequest()` and
   `notifyNewPaintOrder()` are synchronous, only queue messages, and never
   throw, so the route handler calls them without `await` or `.catch()`.
2. **Failures are visible.** Startup checks the Brevo key and says whether
   mail works. Each send and each failure is logged by what it was ("aviso al
   taller de 4820175639"), never by address. On shutdown, unsent messages are
   listed by name.
3. **No duplicate if it can be avoided.** A send that was cut off mid-request,
   where Brevo may already have accepted it, is not retried.

## Transport: the Brevo HTTP API

Mail goes out with one `fetch` POST to `https://api.brevo.com/v3/smtp/email`
with an `api-key` header. No SMTP and no library, so `pg` stays the only
dependency.

Why not SMTP: `render.yaml` and the header of `mail.js` document it. From
Render, connections to `smtp.gmail.com` on port 465 were blocked, and on 587
they timed out for long periods (15 s with no answer, where a healthy
connection takes 22 ms). Retries over 48 minutes did not help. Port 443 is
never blocked. Brevo also verifies a **single sender address** rather than a
domain, which matters because the shop does not have its own domain yet.

The sender address must be verified in Brevo (Senders), or every send answers
`400`.

### `request(url, { method, body })` (`mail.js:379`)

- Sends JSON with `AbortSignal.timeout(15000)`. Fifteen seconds is generous
  for a few kilobytes; longer means something is wrong and a retry is better.
- If `fetch` itself rejects (no response at all), it throws an `Error` whose
  message comes from `reasonFor()` (`:430`: timeout, cancelled, or the network
  code) and whose `cause` is the original error.
- If the response is not 2xx, it reads Brevo's JSON `message` or `code` and
  throws `"<status> <statusText>: <detail>"` with `err.status` set.
- `decorate()` (`:413`) appends how long it took: a `401` in 200 ms means the
  key is wrong; a timeout at 15 s means the API cannot be reached.

### `brevoBody(message)` (`:357`)

Translates the internal message shape `{ to, subject, text, html, replyTo }`
into Brevo's `{ sender, to: [{ email }], subject, htmlContent, textContent,
replyTo }`. Both bodies travel together, and Brevo builds the
multipart/alternative. The text body is what watches, phone notifications and
text-only clients show.

## The outbox queue

```js
const OUTBOX = [];            // { what, message, attempt, retryAt }
const RETRY_DELAYS_MS = [30000, 120000, 300000, 900000, 1800000];
const MAX_OUTBOX = 100;
```

### `enqueue(what, build)` (`:906`)

Builds the message **inside a try**, so a bug in a template is logged and
dropped rather than becoming an unhandled rejection that kills the process.
Pushes `{ what, message, attempt: 0, retryAt: 0 }`. If the queue exceeds 100,
the oldest items are dropped with a log line: a mail outage must not eat the
process's memory.

### `drain()` (`:931`)

```js
if (draining) return;
draining = true;
try {
    for (;;) {
        const index = OUTBOX.findIndex((item) => item.retryAt <= Date.now());
        if (index === -1) break;
        const [item] = OUTBOX.splice(index, 1);
        try {
            await attemptSend(item.message);
            // log success
        } catch (err) {
            if (isDeliveryUnknown(err)) { /* log, do not retry */ continue; }
            const delay = isPermanent(err) ? undefined : RETRY_DELAYS_MS[item.attempt];
            if (delay === undefined) { /* log, give up */ continue; }
            item.attempt += 1;
            item.retryAt = Date.now() + delay;
            OUTBOX.push(item);
        }
    }
} finally {
    draining = false;
    scheduleNextAttempt();
}
```

- **One at a time.** The `draining` flag makes concurrent `kick()` calls
  no-ops. A message queued while a drain is running is picked up by that
  drain's next loop iteration.
- **Six attempts** over roughly 48 minutes: now, then +30 s, +2 min, +5 min,
  +15 min, +30 min.
- **Permanent failures** (`isPermanent()`, `:448`): any 4xx except 429. A bad
  key (401) or an unverified sender (400) will not fix itself. 429 means "not
  now", so it is retried.
- **Unknown delivery** (`isDeliveryUnknown()`, `:479`): no HTTP status, the
  underlying error is a timeout or abort, and its code is not one of the
  "never connected" codes (`ENOTFOUND`, `ECONNREFUSED`,
  `UND_ERR_CONNECT_TIMEOUT`, …). The request may have reached Brevo, so a retry
  could deliver it twice. It stops. Any other error without a status is
  retried: a duplicate can be explained, a missing email cannot be seen.
- `scheduleNextAttempt()` (`:976`) sets one timer for the earliest `retryAt`.
  The timer is `unref`'d so a pending email never keeps the process alive.

`kick()` (`:923`) is `drain().catch(log)`, the only way `drain` is called.

### `close()` (`:1054`)

Called by the server's shutdown handler **after** `server.close()`. Cancels
the retry timer and logs every unsent message by name. The queue is in memory
on purpose: persisting it would need a table and a migration to cover the rare
case of Render stopping the instance during a mail outage, and in that case the
request is still in the database and on the panel.

## Daily caps

The customer confirmation is the only message whose recipient is chosen by
whoever calls the public API. Without a ceiling, a script could make the shop
send branded mail to any address and use up Brevo's free quota (300 a day),
after which real customers stop getting codes and the sender's reputation
suffers.

`withinDailyCap(kind, address)` (`:867`), reset at midnight UTC or on restart:

| Counter | Default | Applies to |
| --- | --- | --- |
| total | 280 (`AUTOCOLOR_MAIL_DAILY_CAP`) | every message |
| customer | 120 (`AUTOCOLOR_MAIL_CUSTOMER_DAILY_CAP`) | customer confirmations |
| per address | 3 | customer confirmations to one inbox, silently |

Each refusal reason is logged once per day. `notifyNewRequest()` returns
`{ customer: true }` only when the confirmation was queued; the walk-in route
passes that to the panel as `mailQueued`, so the boss knows whether to read the
code out at the counter.

## The four messages

`notifyNewRequest(created, data, { walkIn })` (`:819`) and
`notifyNewPaintOrder(created, data)` (`:794`) each queue up to two messages:

| Builder | To | Subject |
| --- | --- | --- |
| `customerMessage()` (`:491`) | the customer | «Tu solicitud en Autocolor: código …» / «Tu vehículo en Autocolor: …» for walk-ins |
| `shopMessage()` (`:536`) | `AUTOCOLOR_MAIL_SHOP`, reply-to the customer | «Solicitud …, placa ABC-123» |
| `paintCustomerMessage()` (`:696`) | the customer, if they left an email | «Tu pedido de matizado…» / «Tu visita a Autocolor…» for `in_person` |
| `paintShopMessage()` (`:754`) | the shop, reply-to the customer | «Matizado …, <company>» |

Subjects only contain the server-generated code and, for the shop, the plate
(already validated against `PLATE_RE`) or the company name. Nothing typed goes
into a customer's subject line.

The customer email for a request lists the next steps (`customerSteps()`,
`:286`) using the site's own promises: a call with a closed price within 24
hours, then bringing the car in, then picking it up with a five-year written
guarantee. A walk-in skips the quote and drop-off steps. The received time is
formatted in `America/Lima`, because the server runs in UTC.

### Labels are shared with the pages

- Panel names come from `src/parts.js` (`parts.label()`), the same file the
  wizard uses, so the email names panels the way the customer saw them.
- Tin sizes, finishes and prices come from `src/paints.js`.
- `QUALITY_LABELS`, `BODY_TYPE_LABELS` and `VEHICLE_LABELS` (`:155-180`) are
  copies of browser-side maps. Every lookup goes through `label()`
  (`:189`), which uses `Object.hasOwn`: an id of `constructor` once produced
  «function Object() { [native code] }» in a shop email.

### Text helpers

- `oneLine(value)` (`:317`) collapses whitespace, including newlines pasted
  into a name.
- `row(label, value)` (`:327`) and `block(title, rows)` (`:333`) build the
  aligned plain-text body; empty values drop out.
- `formatPhone()` (`:212`) turns `+51935646304` into `+51 935 646 304`.
- `colourHex(data)` (`:679`) prefers the hex `confirmColour()` stored, then
  the local catalogue, then none.

## The HTML layouts (`server/mailhtml.js`)

Table-based HTML with inline styles, which is what email clients render
reliably. `shell()` (`:255`) is the outer frame: preheader, logo, card,
footer with address and hours.

**Everything a person typed goes through `escapeHtml()`** (`:88`), which
escapes `& < > " '`. `escapeMultiline()` also turns newlines into `<br>` for
notes. Rows passed with an `html` field are built from already-escaped parts.

Pieces:

| Function | What it draws |
| --- | --- |
| `detailRows(rows)` / `summaryRows(rows)` | Label/value rows; empty values are dropped. |
| `codePanel(label, code)` | The dark panel with the tracking code. |
| `button(href, text)` | A table-based button. |
| `timeline(steps)` / `stepMarker()` | The "what happens next" track, with done/now/next states. |
| `wordmark(logoUrl, logoDarkUrl)` | Light and dark logos, or the name in text when there is no site URL. |
| `swatchBox()` / `swatchHero()` | The paint colour, or a dashed "Sin muestra" box. |
| `customerHtml()`, `shopHtml()`, `paintCustomerHtml()`, `paintShopHtml()` | The four layouts. |

**Dark mode.** Colours are defined twice at the top of the file (light and
`*_DARK`). A `prefers-color-scheme: dark` style block switches classes such as
`c-ink` and `c-body`, and swaps the logo for its white version, for clients
that honour it.

**The logo is a URL**, `<site>/imgs/brand/logo-email.png` and
`logo-email-white.png`. Brevo's API cannot attach inline (`cid:`) images, and
Gmail strips `data:` URIs. They are transparent PNGs, so clients that invert
colours do not leave a white block. Without a site URL (local machine) the
shop's name is written out instead.

## Startup verification

`verify()` (`mail.js:1007`) calls `GET https://api.brevo.com/v3/account`: it
checks the key and the network path without spending a send or emailing
anyone. Two attempts, unless the first failure is permanent. The server prints
«Correos de aviso: listos (…)» or «NO FUNCIONAN» with the reason. A `401` is
the key; a `400` usually the unverified sender.

`describe()` (`:1031`) gives the configuration without the key, plus
`pending` (queue length), for the boss's `whoami`. A `pending` count that does
not go down between two checks means mail is down.

## `netcheck.js`

Runs only when the startup verification failed. `run()` opens a TCP socket
(IPv4 only, since Render has no outbound IPv6) to three hosts at once, with an
8 s cap and without sending a byte:

1. `api.brevo.com:443`, the destination;
2. `www.cloudflare.com:443`, any other HTTPS site;
3. `console.neon.tech:443`.

`verdictFor()` then prints one of three conclusions: Brevo is reachable, so
look at the reason (key or sender); the internet is reachable but Brevo is not,
so wait; or nothing is reachable, so it is the host or DNS.

## Previewing without sending

```bash
node tools/mailpreview.js
```

Builds the emails for a sample request (including one without an email
address) using the exported builders, with `AUTOCOLOR_SITE_URL` pointed at the
repository so the logo and links resolve locally. It prints each message's
headers and text body, and writes each HTML body to a file in
`MAILPREVIEW_OUT` (default: the system temp directory) to open in a browser.
Nothing is sent.
