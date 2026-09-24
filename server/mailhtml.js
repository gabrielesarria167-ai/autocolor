'use strict';

/* =============================================================================
   mailhtml.js: the HTML body of the two emails

   server/mail.js builds the plain text and sends; the formatted version is
   built here. Both travel in the same message (multipart/alternative): the
   mail client shows the HTML if it can and falls back to the text if not, so
   the text is not a leftover, it is the other half and has to be kept up.

   The layout follows the mock-up the shop supplied: a tinted ground, a white
   600 px card with a thin border, small spaced capitals for the section
   labels and hairlines between rows. The colours follow the new logo: one
   ink, #262D40, as the only accent, as on the site.

   WHY TABLES AND INLINE STYLES. It is not sloppiness: Outlook renders with
   Word's engine, which knows nothing of flexbox, grid or float, and Gmail
   strips the <style> in the <head> when a message is forwarded. The only
   thing that survives everywhere is nested tables with the style stuck on
   each tag. The media queries in the <head> are the deliberate exception:
   where they are not understood, the 600 px layout is still readable.

   EVERYTHING A PERSON TYPES GOES THROUGH escapeHtml(). A surname with «&» or
   notes with «<» would break the layout, and notes accepts 2000 characters of
   free text: it is the way someone could slip tags into an email the
   workshop reads.
   ========================================================================== */

// The palette, the site's own (see the tokens at the top of styles.css). It is
// repeated on every tag because mail has no stylesheet worth the name (see
// the header), so it lives here once.
const GROUND = '#f3f4f7';   // the window ground
const CARD = '#ffffff';     // the card
const LINE = '#dadde5';     // borders and hairlines
const ACCENT = '#262d40';   // the logo's ink: labels, links, the plate, the button
const INK = '#262d40';      // headings and data
const BODY = '#5a6275';     // running text
const MUTED = '#666e81';    // labels and small print, 4.5:1 on CARD and on GROUND
const RULE_STRONG = '#c4c9d4'; // the dotted rail and the rings of the steps still ahead

// The same palette for readers with a dark system theme. The ink is too dark
// to read as type on the dark card, so text that was ink turns to a light
// steel (#c3c8d4, 10.2:1 on the card). So does the button: its ink fill is
// 1.2:1 against the dark card, which left a white label floating with no
// visible edge, so in dark mode it turns light steel with an ink label.
const GROUND_DARK = '#141824';
const CARD_DARK = '#1b2130';
const LINE_DARK = '#2f374b';
const ACCENT_DARK = '#c3c8d4';
const INK_DARK = '#f3f4f7';
const BODY_DARK = '#c3c8d4';
const MUTED_DARK = '#8e96a8';
const PANEL_DARK = '#262d40';   // the code panel, near-black in light mode
const NOTE_DARK = '#161b27';    // the notes box

// Schibsted Grotesk, the site's text face, only shows in clients that load the
// Google stylesheet (few: Gmail strips it). Arial is what nearly everyone
// really sees, and the layout is built to hold up in it.
const FONT = "'Schibsted Grotesk',Arial,Helvetica,sans-serif";
// The site's display face, for the customer email's headline. Same caveat.
const DISPLAY = "'Jost','Century Gothic',Futura,Arial,sans-serif";
// The site's label face, for codes, plates and the RUC. Same caveat; the
// fallback is Arial, not a typewriter face.
const LABEL = "'Archivo',Arial,Helvetica,sans-serif";


// The workshop's details in the footer of both emails.
//
// THEY ARE A COPY. The original is in the contact list in index.html (look
// for `contact__details`), and this cannot read it: that is a static page
// served as is and this runs on the server. If the address, the phone or the
// hours change, they have to change in both places.
//
// The wording does differ on purpose: the email spells them out («Lunes a
// sábado», and the country after the address) because an email can be read
// far from the site with nothing around it to give context. What has to match
// is the data, not the words.
const SHOP_ADDRESS = 'Jr. San Juan Masías, Ayacucho 05002, Perú';
const SHOP_PHONE = '+51 935 646 304';
const SHOP_PHONE_TEL = '+51935646304';
const SHOP_HOURS = 'Lunes a sábado, de 07:30 a 20:00';

/**
 * Escapes whatever goes inside the HTML. Applied to EVERYTHING that comes from
 * the form, no exceptions: easier to review than deciding case by case which
 * field can be trusted.
 */
function escapeHtml(value) {
    if (value === undefined || value === null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Same as escapeHtml, but keeping line breaks. For the notes. */
function escapeMultiline(value) {
    return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

/* -----------------------------------------------------------------------------
   Layout pieces
-------------------------------------------------------------------------- */

/** The small label in ink and spaced small capitals that opens each section. */
function eyebrow(text) {
    return `<div class="c-accent" style="font-family:${FONT}; font-size:11px; line-height:14px; letter-spacing:3px; color:${ACCENT}; text-transform:uppercase; padding-bottom:12px;">${escapeHtml(text)}</div>`;
}

/** The hairline between sections. It is a table because an <hr> renders
 *  differently in every client. */
function hairline(padding) {
    return `<tr><td class="px" style="padding:${padding};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="c-rule" style="border-top:1px solid ${LINE}; font-size:0; line-height:0;">&nbsp;</td></tr></table></td></tr>`;
}

/**
 * The «label / value» rows. Rows with no value drop out on their own, so a
 * request without a mileage does not leave an empty line.
 */
function detailRows(rows) {
    const kept = rows.filter((r) => r && r.value !== '' && r.value !== null && r.value !== undefined);
    return kept.map((row, i) => {
        const last = i === kept.length - 1;
        const border = last ? '' : ` border-bottom:1px solid ${LINE};`;
        return `<tr>
                <td class="detail-label" width="150" style="font-family:${FONT}; font-size:14px; line-height:22px; color:${MUTED}; padding:12px 0;${border} vertical-align:top;">${escapeHtml(row.label)}</td>
                <td class="detail-value" style="font-family:${FONT}; font-size:15px; line-height:22px; color:${INK}; padding:12px 0;${border} vertical-align:top;">${row.html || escapeHtml(row.value)}</td>
              </tr>`;
    }).join('\n');
}

/** The dark panel with the code, which is what people come back looking for. */
function codePanel(label, code) {
    return `<table role="presentation" class="c-panel" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${INK};">
              <tr>
                <td class="c-panel" align="center" bgcolor="${INK}" style="padding:22px 24px; background-color:${INK};">
                  <div style="font-family:${FONT}; font-size:11px; line-height:14px; letter-spacing:3px; color:#c3c8d4; text-transform:uppercase; padding-bottom:10px;">${escapeHtml(label)}</div>
                  <div style="font-family:${LABEL}; font-size:28px; line-height:32px; letter-spacing:4px; color:#ffffff; font-weight:bold;">${escapeHtml(code)}</div>
                </td>
              </tr>
            </table>`;
}

/** The button. It sits in its own table with bgcolor so Outlook paints it.
 *  `compact` is the smaller one that sits beside the tracking code. */
function button(href, text, compact) {
    const size = compact
        ? 'font-size:14px; line-height:20px; letter-spacing:0.5px; padding:12px 18px; white-space:nowrap;'
        : 'font-size:15px; line-height:20px; letter-spacing:1px; padding:16px 40px;';
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td class="c-button" align="center" bgcolor="${ACCENT}" style="border-radius:0;">
                  <a class="c-button-label" href="${escapeHtml(href)}" target="_blank" style="display:block; font-family:${FONT}; ${size} font-weight:bold; color:#ffffff; text-decoration:none; border-radius:0;">${escapeHtml(text)}</a>
                </td>
              </tr>
            </table>`;
}

/** The square at the head of each step: a tick once done, its number otherwise.
 *  A character and not an icon, because mail clients do not draw SVG. */
function stepMarker(step, number) {
    const cell = 'align="center" valign="middle"';
    if (step.state === 'done') {
        return `<table role="presentation" width="28" cellpadding="0" cellspacing="0" border="0"><tr><td class="c-step-done" ${cell} width="28" height="28" bgcolor="${INK}" style="width:28px; height:28px; background-color:${INK}; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:28px; font-weight:bold; color:#ffffff;">&#10003;</td></tr></table>`;
    }
    const ring = step.state === 'now'
        ? `class="c-step-now" width="24" height="24" style="width:24px; height:24px; border:2px solid ${INK}; background-color:${CARD}; font-family:${LABEL}; font-size:13px; line-height:24px; font-weight:bold; color:${INK};"`
        : `class="c-step-next" width="26" height="26" style="width:26px; height:26px; border:1px solid ${RULE_STRONG}; background-color:${CARD}; font-family:${LABEL}; font-size:13px; line-height:26px; color:${MUTED};"`;
    return `<table role="presentation" width="28" cellpadding="0" cellspacing="0" border="0"><tr><td ${cell} ${ring}>${number}</td></tr></table>`;
}

/**
 * What happens after the request, as a vertical track (see customerSteps in
 * server/mail.js for the copy).
 *
 * Each step is two rows: the marker beside the title, then the rail beside
 * the detail. The rail is the left border of a 15 px cell after a 13 px one,
 * which puts it on the marker's centre line. A border on a cell is the only
 * way to draw a line that stretches with the text next to it in every client,
 * Outlook included; a div with a height does not.
 */
function timeline(steps) {
    const gap = '<td width="18" style="width:18px; font-size:0; line-height:0;">&nbsp;</td>';
    return steps.map((step, i) => {
        const last = i === steps.length - 1;
        const ahead = step.state === 'next';
        // The rail below a step leads to the next one: solid once this one is done.
        const rail = last ? ['', '']
            : step.state === 'done'
                ? ['c-rail-done', `border-left:2px solid ${INK};`]
                : ['c-rail', `border-left:2px dotted ${RULE_STRONG};`];
        return `<tr>
                <td colspan="2" width="28" valign="top" style="width:28px;">${stepMarker(step, i + 1)}</td>
                ${gap}
                <td class="${ahead ? 'c-body' : 'c-ink'}" valign="middle" style="font-family:${FONT}; font-size:16px; line-height:28px; color:${ahead ? BODY : INK};${ahead ? '' : ' font-weight:bold;'}">${escapeHtml(step.title)}</td>
              </tr>
              <tr>
                <td width="13" style="width:13px; font-size:0; line-height:0;">&nbsp;</td>
                <td class="${rail[0]}" width="15" style="width:15px; ${rail[1]} font-size:0; line-height:0;">&nbsp;</td>
                ${gap}
                <td class="${ahead ? 'c-muted' : 'c-body'}" valign="top" style="font-family:${FONT}; font-size:14px; line-height:20px; color:${ahead ? MUTED : BODY}; padding:2px 0 ${last ? 0 : 22}px 0;">${escapeHtml(step.detail)}</td>
              </tr>`;
    }).join('\n');
}

/** The short label / value lines under the tracking code. Empty ones drop out,
 *  as in detailRows. `html` is for values that are already escaped. */
function summaryRows(rows) {
    return rows
        .filter((r) => r.value !== '' && r.value !== null && r.value !== undefined)
        .map((row) => `<tr>
                <td class="c-muted summary-label" width="116" valign="top" style="width:116px; font-family:${FONT}; font-size:14px; line-height:21px; color:${MUTED}; padding:4px 16px 4px 0;">${escapeHtml(row.label)}</td>
                <td class="c-ink summary-value" valign="top" style="font-family:${FONT}; font-size:14px; line-height:21px; color:${INK}; padding:4px 0;">${row.html || escapeHtml(row.value)}</td>
              </tr>`)
        .join('\n');
}

/**
 * The logo at the top, or the name written out if there is nowhere to fetch it.
 *
 * IT USED TO TRAVEL ATTACHED to the email and is now a URL on the site. An
 * embedded logo is referenced by an identifier (cid:), which is a MIME
 * header, and the API the emails go out through today does not expose it (see
 * LOGO_URL in server/mail.js). The image is served by the site, which is public.
 *
 * With no known site (the work machine, where there is no
 * RENDER_EXTERNAL_URL) there is no URL to put, and a broken image looks worse
 * than a well-written name. The alt text does the same in clients that do not
 * download remote images.
 */
function wordmark(logoUrl, logoDarkUrl) {
    if (!logoUrl) {
        return `<div class="c-ink" style="font-family:${FONT}; font-size:28px; line-height:32px; letter-spacing:0; color:${INK}; font-weight:bold;">autocolor</div>`;
    }

    const light = `<img class="c-logo-light" src="${escapeHtml(logoUrl)}" width="180" alt="Autocolor, laboratorio de matizado y pintado al horno" style="display:block; width:180px; max-width:60%; height:auto; margin:0 auto;">`;
    if (!logoDarkUrl) return light;

    // The second logo is hidden and only the media query above brings it
    // out. Inside a «not mso» conditional because Outlook renders with Word's
    // engine: it does not understand the media query, and without this it would show both.
    const dark = `<!--[if !mso]><!--><img class="c-logo-dark" src="${escapeHtml(logoDarkUrl)}" width="180" alt="Autocolor, laboratorio de matizado y pintado al horno" style="display:none; width:180px; max-width:60%; height:auto; margin:0 auto;"><!--<![endif]-->`;
    return light + dark;
}

/**
 * The frame: background, centred 600 px card and the logo on top.
 *
 * `preheader` is the line the inbox shows next to the subject. It is hidden in
 * the body: without it, what the list shows is the start of the email text,
 * which is almost never what one would summarise.
 */
function shell({ title, preheader, kicker, body, footerNote, logoUrl, logoDarkUrl }) {
    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(title)}</title>
<!--[if mso]>
<style>
  table, td, div, p, a { font-family: Arial, sans-serif; }
</style>
<![endif]-->
<link href="https://fonts.googleapis.com/css2?family=Jost:wght@500&family=Schibsted+Grotesk:wght@400;500;600;700&family=Archivo:wght@500;600;700&display=swap" rel="stylesheet">
<style>
  body { margin:0; padding:0; width:100%; background-color:${GROUND}; }
  table { border-collapse:collapse; }
  img { border:0; line-height:100%; outline:none; text-decoration:none; }
  a { color:${ACCENT}; }
  @media only screen and (max-width:600px) {
    .container { width:100% !important; }
    .px { padding-left:24px !important; padding-right:24px !important; }
    .detail-label { width:100% !important; display:block !important; padding-bottom:2px !important; border-bottom:0 !important; }
    .detail-value { width:100% !important; display:block !important; }
    .stack { width:100% !important; display:block !important; text-align:left !important; }
    .stack-gap { padding-left:0 !important; padding-top:16px !important; }
    .summary-label { width:100% !important; display:block !important; padding:6px 0 0 0 !important; }
    .summary-value { width:100% !important; display:block !important; padding:0 0 2px 0 !important; }
  }
  /* Dark mode.
     Everything carries !important because the real colour sits in each tag's
     style attribute (that is how it has to be in email, see the header) and a
     normal stylesheet rule does not beat an inline style. With !important it does.
     The link rule is the exception: it goes WITHOUT !important on purpose,
     so it does not override the button text, which has its own rule (.c-button). */
  @media (prefers-color-scheme: dark) {
    body, .c-ground { background-color:${GROUND_DARK} !important; }
    .c-card { background-color:${CARD_DARK} !important; border-color:${LINE_DARK} !important; }
    .c-rule { border-top-color:${LINE_DARK} !important; }
    .detail-label, .detail-value { border-bottom-color:${LINE_DARK} !important; }
    .c-ink, .detail-value { color:${INK_DARK} !important; }
    .c-body { color:${BODY_DARK} !important; }
    .c-muted, .detail-label { color:${MUTED_DARK} !important; }
    .c-accent { color:${ACCENT_DARK} !important; }
    a { color:${ACCENT_DARK}; }
    .c-panel { background-color:${PANEL_DARK} !important; border-color:${LINE_DARK} !important; }
    .c-note { background-color:${NOTE_DARK} !important; }
    .c-button { background-color:${ACCENT_DARK} !important; }
    .c-button-label { color:${CARD_DARK} !important; }
    .c-box { background-color:${NOTE_DARK} !important; border-color:${LINE_DARK} !important; }
    .c-box-rule { border-top-color:${LINE_DARK} !important; }
    .c-outline { border-color:${ACCENT_DARK} !important; }
    .c-step-done { background-color:${ACCENT_DARK} !important; color:${CARD_DARK} !important; }
    .c-step-now { background-color:${CARD_DARK} !important; border-color:${ACCENT_DARK} !important; color:${INK_DARK} !important; }
    .c-step-next { background-color:${CARD_DARK} !important; border-color:${LINE_DARK} !important; color:${MUTED_DARK} !important; }
    .c-rail-done { border-left-color:${ACCENT_DARK} !important; }
    .c-rail { border-left-color:${LINE_DARK} !important; }
    .c-logo-light { display:none !important; }
    .c-logo-dark { display:block !important; }
  }
</style>
</head>
<body class="c-ground" style="margin:0; padding:0; width:100%; background-color:${GROUND};">

<span style="display:none !important; visibility:hidden; opacity:0; color:${GROUND}; height:0; width:0; font-size:1px; line-height:1px; mso-hide:all; overflow:hidden;">${escapeHtml(preheader)}</span>

<table role="presentation" class="c-ground" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${GROUND};">
  <tr>
    <td align="center" style="padding:32px 12px;">

      <table role="presentation" class="container c-card" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px; background-color:${CARD}; border:1px solid ${LINE};">

        <tr>
          <td class="px" align="center" style="padding:36px 48px 24px 48px;">
            ${wordmark(logoUrl, logoDarkUrl)}
            <div class="c-muted" style="font-family:${FONT}; font-size:12px; line-height:16px; letter-spacing:3px; color:${MUTED}; padding-top:14px; text-transform:uppercase;">${escapeHtml(kicker)}</div>
          </td>
        </tr>

${hairline('0 48px')}

${body}

      </table>

      <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px;">
        <tr>
          <td class="px" align="center" style="padding:24px 48px 32px 48px;">
            <div class="c-muted" style="font-family:${FONT}; font-size:12px; line-height:19px; color:${MUTED};">
              ${escapeHtml(footerNote)}<br>
              ${escapeHtml(SHOP_ADDRESS)}
            </div>
          </td>
        </tr>
      </table>

    </td>
  </tr>
</table>

</body>
</html>`;
}

/* -----------------------------------------------------------------------------
   El correo del cliente

   Answers the question a customer has right after sending: now what? It
   leads with the steps ahead, the first one already ticked, then the tracking
   code beside the button that uses it and a short summary of what was asked
   for, and ends on the one way to ask something before the call.
-------------------------------------------------------------------------- */

function customerHtml(created, data, ctx, walkIn) {
    const name = ctx.oneLine(data.firstName);
    const model = ctx.oneLine(data.model);
    const plate = ctx.oneLine(data.plate);
    const lookupUrl = ctx.siteUrl ? `${ctx.siteUrl}/pgs/repair.html#consulta` : '';
    const whatsappUrl = `https://wa.me/${SHOP_PHONE_TEL.replace(/\D/g, '')}`;

    // «Juan, tu Corolla ya está en nuestra lista.» Without a model (a walk-in
    // picks a silhouette, not a catalogue entry) it names the request or the
    // vehicle instead; without a name the sentence starts at «Tu».
    const subject = model ? `tu ${model}` : walkIn ? 'tu vehículo' : 'tu solicitud';
    const where = walkIn ? 'ya está en el taller' : 'ya está en nuestra lista';
    const headline = name
        ? `${name}, ${subject} ${where}.`
        : `${subject.charAt(0).toUpperCase()}${subject.slice(1)} ${where}.`;

    const vehicle = ctx.vehicleName(data, true, true);
    const plateHtml = `<span class="c-ink" style="font-family:${LABEL}; font-weight:bold; letter-spacing:1px; color:${INK};">${escapeHtml(plate)}</span>`;
    const summary = summaryRows([
        {
            label: 'Vehículo',
            value: vehicle || plate,
            html: [vehicle && escapeHtml(vehicle), plate && plateHtml].filter(Boolean).join(', '),
        },
        { label: 'Piezas', value: ctx.partsLabel(data.parts) },
        { label: 'Acabado', value: ctx.qualityLabel(data.quality) },
        { label: 'Zona', value: ctx.zoneLabel(data) },
    ]);

    const body = `
        <tr>
          <td class="px" align="left" style="padding:36px 48px 0 48px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td class="c-step-done" align="center" valign="middle" width="22" height="22" bgcolor="${INK}" style="width:22px; height:22px; background-color:${INK}; font-family:Arial,Helvetica,sans-serif; font-size:13px; line-height:22px; font-weight:bold; color:#ffffff;">&#10003;</td>
                <td class="c-accent" style="padding-left:10px; font-family:${FONT}; font-size:11px; line-height:14px; letter-spacing:3px; color:${ACCENT}; text-transform:uppercase; font-weight:bold;">${walkIn ? 'Vehículo recibido' : 'Solicitud recibida'}</td>
              </tr>
            </table>
            <div class="c-ink" style="font-family:${DISPLAY}; font-size:32px; line-height:40px; color:${INK}; font-weight:500; padding-top:14px;">${escapeHtml(headline)}</div>
            <div class="c-body" style="font-family:${FONT}; font-size:16px; line-height:26px; color:${BODY}; padding-top:14px;">
              ${walkIn
                ? 'Esto es lo que sigue. Cualquier cosa que necesitemos consultarte, te llamamos.'
                : 'Esto es lo que sigue. No tienes que hacer nada hasta que te llamemos.'}
            </div>
          </td>
        </tr>

        <tr>
          <td class="px" style="padding:32px 48px 0 48px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${timeline(ctx.customerSteps(created, walkIn))}
            </table>
          </td>
        </tr>

        <tr>
          <td class="px" style="padding:36px 48px 0 48px;">
            <table role="presentation" class="c-box" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${GROUND}" style="background-color:${GROUND}; border:1px solid ${LINE};">
              <tr>
                <td style="padding:22px 24px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td class="stack" valign="middle">
                        <div class="c-muted" style="font-family:${FONT}; font-size:11px; line-height:14px; letter-spacing:2.5px; color:${MUTED}; text-transform:uppercase; padding-bottom:6px;">Código de seguimiento</div>
                        <div class="c-ink" style="font-family:${LABEL}; font-size:30px; line-height:34px; letter-spacing:3px; color:${INK}; font-weight:bold;">${escapeHtml(created.id)}</div>
                      </td>${lookupUrl ? `
                      <td class="stack stack-gap" align="right" valign="middle" style="padding-left:16px;">
                        ${button(lookupUrl, 'Ver el avance →', true)}
                      </td>` : ''}
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td class="c-box-rule" style="border-top:1px solid ${LINE}; padding:14px 24px 16px 24px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${summary}
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

${hairline('36px 48px 0 48px')}

        <tr>
          <td class="px" style="padding:24px 48px 36px 48px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td class="stack" valign="middle">
                  <div class="c-ink" style="font-family:${FONT}; font-size:15px; line-height:22px; color:${INK}; font-weight:bold;">${walkIn ? '¿Una duda sobre tu vehículo?' : '¿Una duda antes de la llamada?'}</div>
                  <div class="c-body" style="font-family:${FONT}; font-size:14px; line-height:22px; color:${BODY};">${escapeHtml(SHOP_HOURS)}</div>
                </td>
                <td class="stack stack-gap" align="right" valign="middle" style="padding-left:24px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td class="c-outline" style="border:1px solid ${INK};">
                        <a class="c-accent" href="${whatsappUrl}" target="_blank" style="display:block; font-family:${FONT}; font-size:14px; line-height:20px; font-weight:bold; color:${ACCENT}; text-decoration:none; white-space:nowrap; padding:11px 16px;">WhatsApp ${SHOP_PHONE}</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;

    return shell({
        title: walkIn
            ? `Tu vehículo en Autocolor (${created.id})`
            : `Tu solicitud en Autocolor (${created.id})`,
        preheader: walkIn
            ? `Tu código de seguimiento es ${created.id}. Con él puedes ver el avance de tu vehículo.`
            : `Tu código de seguimiento es ${created.id}. Te contactaremos en 24 horas con tu presupuesto.`,
        kicker: 'Taller de pintura automotriz',
        body,
        footerNote: walkIn
            ? 'Recibiste este correo porque dejaste tu vehículo en Autocolor.'
            : 'Recibiste este correo porque enviaste una solicitud en Autocolor.',
        logoUrl: ctx.logoUrl,
        logoDarkUrl: ctx.logoDarkUrl,
    });
}

/* -----------------------------------------------------------------------------
   The workshop's email

   Same visual language, different job: this confirms nothing, it is the sheet
   a quote is prepared from. What needs to change, changes:

     - Contact leads, not the greeting. Phone and email go at the top and as
       links, because the first thing done with this is calling, often from a
       phone.
     - The headline is customer and plate, which is how a job is recognised
       at a glance in an inbox with several.
     - Panels go by their name («Capó»), not the 3D model's identifier, and
       listed: they are the ones to quote.
     - No brand button and no promises: the link goes to the panel.
-------------------------------------------------------------------------- */

function shopHtml(created, data, ctx, walkIn) {
    const fullName = [ctx.oneLine(data.firstName), ctx.oneLine(data.lastName)].filter(Boolean).join(' ');
    const vehicle = ctx.vehicleName(data, false);
    const zone = ctx.zoneLabel(data);
    const panelUrl = ctx.siteUrl ? `${ctx.siteUrl}/pgs/taller.html` : '';
    const phone = ctx.formatPhone(data.phone);
    const email = ctx.oneLine(data.email);

    // Phone and email as links: calling or writing is the first thing done
    // on opening this, and on a phone a number that cannot be tapped ends up
    // copied by hand.
    const contactRows = detailRows([
        {
            label: 'Teléfono',
            value: phone,
            html: phone ? `<a class="c-accent" href="tel:${escapeHtml(phone.replace(/[^+\d]/g, ''))}" style="color:${ACCENT}; text-decoration:none; font-weight:bold;">${escapeHtml(phone)}</a>` : '',
        },
        {
            label: 'Email',
            value: email,
            html: email ? `<a class="c-accent" href="mailto:${escapeHtml(email)}" style="color:${ACCENT}; text-decoration:none;">${escapeHtml(email)}</a>` : '',
        },
        { label: 'Zona', value: zone },
    ]);

    const vehicleRows = detailRows([
        { label: 'Marca y modelo', value: vehicle },
        { label: 'Carrocería', value: ctx.bodyTypeLabel(data.bodyType) },
        { label: 'Año', value: data.year },
        { label: 'Kilometraje', value: ctx.mileageLabel(data.mileage) },
        { label: 'Código de color', value: ctx.oneLine(data.colorCode) },
        // The 3D viewer's silhouette does not always match the real body
        // (four silhouettes for eight bodies), so it goes separately.
        { label: 'Silueta 3D', value: ctx.vehicleLabel(data.vehicle) },
    ]);

    const workRows = detailRows([
        { label: 'Acabado', value: ctx.qualityLabel(data.quality) },
        {
            label: `Piezas (${data.parts.length})`,
            // As in the text version: no parts only happens on rows from before
            // both forms required them. Then no list either, which would show
            // as an empty bullet; detailRows prefers `html` over `value`.
            value: ctx.partsLabel(data.parts) || 'Sin definir',
            html: data.parts.length
                ? `<ul style="margin:0; padding-left:18px;">${data.parts.map((p) => `<li style="padding-bottom:2px;">${escapeHtml(ctx.partLabel(p))}</li>`).join('')}</ul>`
                : '',
        },
    ]);

    const body = `
        <tr>
          <td class="px" align="left" style="padding:36px 48px 0 48px;">
            ${eyebrow(walkIn ? 'Registrada en el local' : 'Nueva solicitud')}
            <div class="c-ink" style="font-family:${FONT}; font-size:26px; line-height:34px; color:${INK}; font-weight:normal;">${escapeHtml(fullName || 'Solicitud sin nombre')}</div>
            ${data.plate ? `<div class="c-accent" style="font-family:${LABEL}; font-size:18px; line-height:26px; letter-spacing:2px; color:${ACCENT}; padding-top:6px; font-weight:bold;">${escapeHtml(data.plate)}</div>` : ''}
          </td>
        </tr>

        <tr>
          <td class="px" style="padding:24px 48px 0 48px;">
            ${codePanel('Código de la solicitud', created.id)}
          </td>
        </tr>

        <tr>
          <td class="px" style="padding:28px 48px 0 48px;">
            ${eyebrow('Cliente')}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${contactRows}
            </table>
          </td>
        </tr>

        <tr>
          <td class="px" style="padding:28px 48px 0 48px;">
            ${eyebrow('Vehículo')}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${vehicleRows}
            </table>
          </td>
        </tr>

        <tr>
          <td class="px" style="padding:28px 48px 0 48px;">
            ${eyebrow('Trabajo')}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${workRows}
            </table>
          </td>
        </tr>
${data.notes ? `
        <tr>
          <td class="px" style="padding:28px 48px 0 48px;">
            ${eyebrow('Notas del cliente')}
            <table role="presentation" class="c-note" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${GROUND}; border-left:3px solid ${ACCENT};">
              <tr>
                <td class="c-note c-body" style="padding:16px 18px; font-family:${FONT}; font-size:15px; line-height:24px; color:${BODY};">${escapeMultiline(data.notes)}</td>
              </tr>
            </table>
          </td>
        </tr>` : ''}
${panelUrl ? `
        <tr>
          <td class="px" align="center" style="padding:32px 48px 0 48px;">
            ${button(panelUrl, 'ABRIR EL PANEL DEL TALLER')}
          </td>
        </tr>` : ''}

        <tr><td class="px" style="padding:0 48px 36px 48px;">&nbsp;</td></tr>`;

    return shell({
        title: data.plate ? `Solicitud ${created.id}, placa ${data.plate}` : `Solicitud ${created.id}`,
        // A row with no plate (only from before walk-ins required one) drops
        // out of the line instead of leaving an empty «, ,».
        preheader: [fullName || 'Cliente', data.plate, vehicle, `${data.parts.length} pieza(s)`]
            .filter(Boolean).join(', '),
        kicker: 'Aviso interno del taller',
        body,
        footerNote: walkIn
            ? 'Aviso automático del panel del taller. Responder a este correo le escribe al cliente.'
            : 'Aviso automático del asistente de cotización. Responder a este correo le escribe al cliente.',
        logoUrl: ctx.logoUrl,
        logoDarkUrl: ctx.logoDarkUrl,
    });
}

/* -----------------------------------------------------------------------------
   The two emails for a matizado order (pgs/paintings.html)

   Same layout, different content. What changes from a paint request is what
   is being confirmed: here there is no vehicle at the workshop and no quote
   to come, there is a colour, a container and a referential price.

   The colour box is the piece of its own. A matizado order is recognised by
   its colour before its code, so the swatch goes on top and large (a colour
   square with its code beside it), and it says in writing that it is
   referential: no mail client paints a metallic, and whoever approves a
   colour looking at this will complain.
-------------------------------------------------------------------------- */

/**
 * The colour's swatch with its code and name, or nothing when the order has
 * no colour (in_person). A colour the guides have no chip for still shows
 * its code and name, beside a blank box that says so.
 */
function swatchBox(hex, code, name) {
    if (!hex && !String(code || '').trim()) return '';
    const box = hex
        ? `<td height="64" bgcolor="${escapeHtml(hex)}" style="width:64px; height:64px; background-color:${escapeHtml(hex)}; border:1px solid ${LINE}; font-size:0; line-height:0;">&nbsp;</td>`
        : `<td height="64" align="center" valign="middle" bgcolor="#f3f4f7" style="width:64px; height:64px; background-color:#f3f4f7; border:1px dashed ${LINE}; font-family:${FONT}; font-size:10px; line-height:12px; color:${MUTED};">Sin<br>muestra</td>`;
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="64" valign="top" style="width:64px;">
                  <table role="presentation" width="64" cellpadding="0" cellspacing="0" border="0">
                    <tr>${box}</tr>
                  </table>
                </td>
                <td valign="middle" style="padding-left:16px;">
                  <div class="c-ink" style="font-family:${LABEL}; font-size:22px; line-height:26px; letter-spacing:2px; color:${INK}; font-weight:bold;">${escapeHtml(code)}</div>
                  <div class="c-body" style="font-family:${FONT}; font-size:15px; line-height:22px; color:${BODY}; padding-top:4px;">${escapeHtml(name)}</div>
                </td>
              </tr>
            </table>`;
}

/**
 * The large swatch, for the customer's email: a full-width band of the colour
 * with the code, the name and the finish below. It is where the colour
 * matters most (it was what came out blank when it came from the new
 * database), so it takes its own block instead of a 64 px square.
 *
 * With no hex the band is swapped for a notice, and the block builds the same.
 */
function swatchHero(hex, code, name, finish) {
    const band = hex
        ? `<td height="120" bgcolor="${escapeHtml(hex)}" style="height:120px; background-color:${escapeHtml(hex)}; font-size:0; line-height:0;">&nbsp;</td>`
        : `<td height="120" align="center" valign="middle" bgcolor="#f3f4f7" style="height:120px; background-color:#f3f4f7; font-family:${FONT}; font-size:13px; line-height:18px; color:${MUTED};">La muestra de este color se aprueba en el taller</td>`;
    const chip = finish
        ? `<td align="right" valign="middle" style="font-family:${LABEL}; font-size:11px; letter-spacing:1.5px; color:${MUTED}; text-transform:uppercase; white-space:nowrap;">${escapeHtml(finish)}</td>`
        : '';
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${LINE};">
              <tr>${band}</tr>
              <tr>
                <td style="border-top:1px solid ${LINE}; padding:16px 20px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td valign="middle">
                        <div class="c-ink" style="font-family:${LABEL}; font-size:20px; line-height:24px; letter-spacing:1.5px; color:${INK}; font-weight:bold;">${escapeHtml(code)}</div>
                        <div class="c-body" style="font-family:${FONT}; font-size:16px; line-height:22px; color:${BODY}; padding-top:3px;">${escapeHtml(name)}</div>
                      </td>
                      ${chip}
                    </tr>
                  </table>
                </td>
              </tr>
            </table>`;
}

function paintCustomerHtml(created, data, ctx) {
    const name = ctx.oneLine(data.firstName);
    const inPerson = data.method === 'in_person';
    const hex = ctx.colourHex(data);
    const headline = inPerson
        ? (name ? `${name}, te esperamos en el taller.` : 'Te esperamos en el taller.')
        : (name ? `${name}, estamos preparando tu matizado.` : 'Estamos preparando tu matizado.');

    const summary = summaryRows([
        { label: 'Nombre taller', value: ctx.oneLine(data.company) },
        { label: 'Color', value: inPerson ? 'Se mide en el taller' : ctx.colourName(data) },
        { label: 'Acabado', value: ctx.finishLabel(data.finish) },
        { label: 'Envase', value: ctx.orderLine(data) },
        { label: 'Total', value: ctx.priceLabel(data.price) },
    ]);

    const body = `
        <tr>
          <td class="px" align="left" style="padding:36px 48px 0 48px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td class="c-step-done" align="center" valign="middle" width="22" height="22" bgcolor="${INK}" style="width:22px; height:22px; background-color:${INK}; font-family:Arial,Helvetica,sans-serif; font-size:13px; line-height:22px; font-weight:bold; color:#ffffff;">&#10003;</td>
                <td class="c-accent" style="padding-left:10px; font-family:${FONT}; font-size:11px; line-height:14px; letter-spacing:3px; color:${ACCENT}; text-transform:uppercase; font-weight:bold;">${inPerson ? 'Visita agendada' : 'Pedido recibido'}</td>
              </tr>
            </table>
            <div class="c-ink" style="font-family:${DISPLAY}; font-size:32px; line-height:40px; color:${INK}; font-weight:500; padding-top:14px;">${escapeHtml(headline)}</div>
            <div class="c-body" style="font-family:${FONT}; font-size:16px; line-height:26px; color:${BODY}; padding-top:14px;">
              ${inPerson
                ? 'Trae el vehículo o una pieza suelta y medimos el color con el espectrofotómetro delante de ti. Con el color aprobado decidimos ahí mismo el envase y el precio. Te escribimos por WhatsApp dentro de las próximas 24&nbsp;horas para coordinar la cita y ver los detalles.'
                : 'Preparamos la fórmula y te avisamos en cuanto esté lista para recoger. El color se aprueba con plancha de prueba antes de entregarlo. Te escribimos por WhatsApp dentro de las próximas 24&nbsp;horas para coordinar la entrega y ver los detalles.'}
            </div>
          </td>
        </tr>
${data.colorCode ? `
        <tr>
          <td class="px" style="padding:28px 48px 0 48px;">
            ${swatchHero(hex, `${ctx.oneLine(data.brand)} ${ctx.oneLine(data.colorCode)}`.trim(), ctx.oneLine(data.colorName), ctx.finishLabel(data.finish))}
            <div class="c-muted" style="font-family:${FONT}; font-size:13px; line-height:20px; color:${MUTED}; padding-top:12px;">La muestra es referencial: una pantalla no reproduce un metálico ni un perlado.</div>
          </td>
        </tr>` : ''}

        <tr>
          <td class="px" style="padding:32px 48px 0 48px;">
            <table role="presentation" class="c-box" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${GROUND}" style="background-color:${GROUND}; border:1px solid ${LINE};">
              <tr>
                <td style="padding:22px 24px;">
                  <div class="c-muted" style="font-family:${FONT}; font-size:11px; line-height:14px; letter-spacing:2.5px; color:${MUTED}; text-transform:uppercase; padding-bottom:6px;">Código de pedido</div>
                  <div class="c-ink" style="font-family:${LABEL}; font-size:30px; line-height:34px; letter-spacing:3px; color:${INK}; font-weight:bold;">${escapeHtml(created.id)}</div>
                </td>
              </tr>
              <tr>
                <td class="c-box-rule" style="border-top:1px solid ${LINE}; padding:14px 24px 16px 24px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${summary}
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

${hairline('36px 48px 0 48px')}

        <tr>
          <td class="px" style="padding:24px 48px 36px 48px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td class="stack" valign="middle">
                  <div class="c-ink" style="font-family:${FONT}; font-size:15px; line-height:22px; color:${INK}; font-weight:bold;">${escapeHtml(SHOP_ADDRESS)}</div>
                  <div class="c-body" style="font-family:${FONT}; font-size:14px; line-height:22px; color:${BODY};">${escapeHtml(SHOP_HOURS)}</div>
                </td>
                <td class="stack stack-gap" align="right" valign="middle" style="padding-left:24px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td class="c-outline" style="border:1px solid ${INK};">
                        <a class="c-accent" href="https://wa.me/${SHOP_PHONE_TEL.replace(/\D/g, '')}" target="_blank" style="display:block; font-family:${FONT}; font-size:14px; line-height:20px; font-weight:bold; color:${ACCENT}; text-decoration:none; white-space:nowrap; padding:11px 16px;">WhatsApp ${SHOP_PHONE}</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;

    return shell({
        title: inPerson ? `Tu visita a Autocolor (${created.id})` : `Tu pedido de matizado (${created.id})`,
        preheader: inPerson
            ? `Tu código es ${created.id}. Te esperamos para medir el color.`
            : `Tu código es ${created.id}. Estamos preparando tu matizado.`,
        kicker: 'Laboratorio de matizado',
        body,
        footerNote: 'Recibiste este correo porque hiciste un pedido de matizado en Autocolor.',
        logoUrl: ctx.logoUrl,
        logoDarkUrl: ctx.logoDarkUrl,
    });
}

function paintShopHtml(created, data, ctx) {
    const fullName = [ctx.oneLine(data.firstName), ctx.oneLine(data.lastName)].filter(Boolean).join(' ');
    const phone = ctx.formatPhone(data.phone);
    const email = ctx.oneLine(data.email);
    const inPerson = data.method === 'in_person';
    const hex = ctx.colourHex(data);

    const contactRows = detailRows([
        { label: 'Nombre taller', value: ctx.oneLine(data.company) },
        { label: 'Contacto', value: fullName },
        {
            label: 'Teléfono',
            value: phone,
            html: `<a href="tel:${escapeHtml(ctx.oneLine(data.phone))}" style="color:${ACCENT}; text-decoration:none; font-weight:bold;">${escapeHtml(phone)}</a>`,
        },
        {
            label: 'Email',
            value: email,
            html: `<a href="mailto:${escapeHtml(email)}" style="color:${ACCENT}; text-decoration:none;">${escapeHtml(email)}</a>`,
        },
    ]);

    const orderRows = detailRows([
        { label: 'Identificado', value: ctx.methodLabel(data.method) },
        { label: 'Marca', value: ctx.oneLine(data.brand) },
        { label: 'Código', value: ctx.oneLine(data.colorCode), html: `<span style="font-family:${LABEL}; font-weight:bold; letter-spacing:1px;">${escapeHtml(ctx.oneLine(data.colorCode))}</span>` },
        { label: 'Color', value: ctx.oneLine(data.colorName) },
        { label: 'Acabado', value: ctx.finishLabel(data.finish) },
        { label: 'Lectura CIELAB', value: ctx.readingLabel(data.reading) },
        { label: 'Envase', value: ctx.orderLine(data) },
        { label: 'Precio en pantalla', value: ctx.priceLabel(data.price) },
    ]);

    const body = `
        <tr>
          <td class="px" align="left" style="padding:36px 48px 0 48px;">
            <div class="c-muted" style="font-family:${FONT}; font-size:11px; line-height:14px; letter-spacing:3px; color:${MUTED}; text-transform:uppercase;">Pedido ${escapeHtml(created.id)}</div>
            <div class="c-ink" style="font-family:${DISPLAY}; font-size:28px; line-height:34px; color:${INK}; font-weight:500; padding-top:10px;">${escapeHtml(ctx.oneLine(data.company))}</div>
            <div class="c-body" style="font-family:${FONT}; font-size:15px; line-height:24px; color:${BODY}; padding-top:6px;">${inPerson
                ? 'Viene al taller a que le midamos el color. No hay envase ni precio todavía.'
                : 'Pedido de matizado desde el sitio.'}</div>
          </td>
        </tr>

        <tr>
          <td class="px" style="padding:26px 48px 0 48px;">
            ${eyebrow('Cliente')}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${contactRows}
            </table>
          </td>
        </tr>

        <tr>
          <td class="px" style="padding:26px 48px 0 48px;">
            ${eyebrow('El pedido')}
            ${data.colorCode ? swatchBox(hex, ctx.oneLine(data.colorCode), ctx.oneLine(data.colorName)) + '<div style="height:16px; font-size:0; line-height:0;">&nbsp;</div>' : ''}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${orderRows}
            </table>
          </td>
        </tr>
${ctx.oneLine(data.notes) ? `
        <tr>
          <td class="px" style="padding:26px 48px 0 48px;">
            ${eyebrow('Notas del cliente')}
            <table role="presentation" class="c-note" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${GROUND}" style="background-color:${GROUND};">
              <tr><td class="c-body" style="padding:14px 16px; font-family:${FONT}; font-size:15px; line-height:23px; color:${BODY};">${escapeMultiline(data.notes)}</td></tr>
            </table>
          </td>
        </tr>` : ''}

        <tr><td style="height:36px; font-size:0; line-height:0;">&nbsp;</td></tr>`;

    return shell({
        title: `Pedido de matizado ${created.id}, ${ctx.oneLine(data.company)}`,
        preheader: [ctx.oneLine(data.company), ctx.colourName(data), ctx.orderLine(data)]
            .filter(Boolean).join(', '),
        kicker: 'Aviso interno del taller',
        body,
        footerNote: 'Aviso automático de la página de venta de matizado. Responder a este correo le escribe al cliente.',
        logoUrl: ctx.logoUrl,
        logoDarkUrl: ctx.logoDarkUrl,
    });
}

module.exports = {
    customerHtml,
    shopHtml,
    paintCustomerHtml,
    paintShopHtml,
};
