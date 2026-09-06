'use strict';

/* =============================================================================
   mailhtml.js — el cuerpo en HTML de los dos correos

   server/mail.js arma el texto plano y manda; aquí se arma la versión con
   formato. Los dos viajan en el mismo mensaje (multipart/alternative): el
   cliente de correo enseña el HTML si puede y cae al texto si no, así que el
   texto no es un resto de antes, es la otra mitad y hay que mantenerla.

   El diseño sale de la maqueta que dio el taller: fondo #f3f2f2, tarjeta
   blanca de 600 px con borde fino, rojo #c8102e como único color de acento,
   antetítulos en versalitas muy espaciadas y filas separadas por hairlines.

   POR QUÉ TABLAS Y ESTILOS EN LÍNEA. No es descuido: Outlook compone con el
   motor de Word, que no sabe de flexbox, grid ni float, y Gmail borra el
   <style> del <head> cuando reenvía un mensaje. Lo único que sobrevive en
   todas partes son tablas anidadas con el estilo pegado a cada etiqueta. Las
   media queries del <head> son la excepción a propósito: donde no se
   entienden, la maqueta de 600 px sigue siendo legible.

   TODO LO QUE ESCRIBE UNA PERSONA PASA POR escapeHtml(). Un apellido con «&»
   o unas notas con «<» romperían la maqueta, y notes admite 2000 caracteres
   de texto libre: es la vía por la que alguien podría colar etiquetas en un
   correo que lee el taller.
   ========================================================================== */

// La paleta de la maqueta. Se repiten en cada etiqueta porque en correo no hay
// hoja de estilos que valga (ver la cabecera), así que viven aquí una vez.
const GROUND = '#f3f2f2';   // el fondo de la ventana
const CARD = '#ffffff';     // la tarjeta
const LINE = '#e3e1de';     // bordes y hairlines
const RED = '#c8102e';      // el acento, el del logotipo
const INK = '#1a1a1a';      // titulares y datos
const BODY = '#4a4844';     // texto corrido
const MUTED = '#8a8681';    // etiquetas y letra pequeña

// Poppins solo la verán los clientes que carguen la hoja de Google (pocos:
// Gmail la quita). Arial es lo que va a ver de verdad casi todo el mundo, y la
// maqueta está pensada para aguantarlo.
const FONT = "'Poppins',Arial,Helvetica,sans-serif";
const MONO = "'Courier New',Courier,monospace";

// El logotipo viaja pegado al mensaje y se referencia por este identificador
// (ver LOGO en server/mail.js). No es una URL: una imagen remota depende de
// que el cliente quiera bajarla —muchos no lo hacen sin permiso— y un
// data: URI Gmail lo borra directamente.
const LOGO_CID = 'autocolor-logo';

const SHOP_ADDRESS = 'Jr. San Juan Masías, Ayacucho 05002, Perú';
const SHOP_PHONE = '+51 935 646 304';
const SHOP_PHONE_TEL = '+51935646304';
const SHOP_HOURS = 'Lunes a Sábado · 07:30 – 20:00';

/**
 * Escapa lo que vaya a ir dentro del HTML. Se aplica a TODO lo que venga del
 * formulario, sin excepción: es más fácil de revisar que ir decidiendo caso
 * por caso cuál de los campos es de fiar.
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

/** Igual que escapeHtml, pero conservando los saltos de línea. Para las notas. */
function escapeMultiline(value) {
    return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

/* -----------------------------------------------------------------------------
   Piezas de la maqueta
-------------------------------------------------------------------------- */

/** El antetítulo rojo en versalitas espaciadas que abre cada sección. */
function eyebrow(text, color) {
    return `<div style="font-family:${FONT}; font-size:11px; line-height:14px; letter-spacing:3px; color:${color || RED}; text-transform:uppercase; padding-bottom:12px;">${escapeHtml(text)}</div>`;
}

/** La línea fina que separa secciones. Es una tabla porque un <hr> se pinta
 *  distinto en cada cliente. */
function hairline(padding) {
    return `<tr><td class="px" style="padding:${padding};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid ${LINE}; font-size:0; line-height:0;">&nbsp;</td></tr></table></td></tr>`;
}

/**
 * Las filas de «etiqueta / valor». Las que no traen valor se caen solas, para
 * que una solicitud sin kilometraje no deje un renglón vacío.
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

/** El panel negro con el código, que es lo que la gente vuelve a buscar. */
function codePanel(label, code) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${INK};">
              <tr>
                <td align="center" bgcolor="${INK}" style="padding:22px 24px; background-color:${INK};">
                  <div style="font-family:${FONT}; font-size:11px; line-height:14px; letter-spacing:3px; color:#b9b6b1; text-transform:uppercase; padding-bottom:10px;">${escapeHtml(label)}</div>
                  <div style="font-family:${MONO}; font-size:28px; line-height:32px; letter-spacing:4px; color:#ffffff; font-weight:bold;">${escapeHtml(code)}</div>
                </td>
              </tr>
            </table>`;
}

/** El botón. Va en su propia tabla con bgcolor para que Outlook lo pinte. */
function button(href, text) {
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" bgcolor="${RED}" style="border-radius:4px;">
                  <a href="${escapeHtml(href)}" target="_blank" style="display:block; font-family:${FONT}; font-size:15px; line-height:20px; font-weight:bold; letter-spacing:1px; color:#ffffff; text-decoration:none; padding:16px 40px; border-radius:4px;">${escapeHtml(text)}</a>
                </td>
              </tr>
            </table>`;
}

/**
 * El armazón: fondo, tarjeta centrada de 600 px y el logotipo arriba.
 *
 * `preheader` es la línea que la bandeja de entrada enseña junto al asunto.
 * Va escondida en el cuerpo: sin ella, lo que se lee en la lista es el
 * principio del texto del correo, que casi nunca es lo que uno resumiría.
 */
function shell({ title, preheader, kicker, body, footerNote }) {
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
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  body { margin:0; padding:0; width:100%; background-color:${GROUND}; }
  table { border-collapse:collapse; }
  img { border:0; line-height:100%; outline:none; text-decoration:none; }
  a { color:${RED}; }
  @media only screen and (max-width:600px) {
    .container { width:100% !important; }
    .px { padding-left:24px !important; padding-right:24px !important; }
    .detail-label { width:100% !important; display:block !important; padding-bottom:2px !important; border-bottom:0 !important; }
    .detail-value { width:100% !important; display:block !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; width:100%; background-color:${GROUND};">

<span style="display:none !important; visibility:hidden; opacity:0; color:${GROUND}; height:0; width:0; font-size:1px; line-height:1px; mso-hide:all; overflow:hidden;">${escapeHtml(preheader)}</span>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${GROUND};">
  <tr>
    <td align="center" style="padding:32px 12px;">

      <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px; background-color:${CARD}; border:1px solid ${LINE};">

        <tr>
          <td class="px" align="center" style="padding:36px 48px 24px 48px;">
            <img src="cid:${LOGO_CID}" width="240" alt="Autocolor" style="display:block; width:240px; max-width:70%; height:auto; margin:0 auto;">
            <div style="font-family:${FONT}; font-size:12px; line-height:16px; letter-spacing:3px; color:${MUTED}; padding-top:14px; text-transform:uppercase;">${escapeHtml(kicker)}</div>
          </td>
        </tr>

${hairline('0 48px')}

${body}

      </table>

      <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px;">
        <tr>
          <td class="px" align="center" style="padding:24px 48px 32px 48px;">
            <div style="font-family:${FONT}; font-size:12px; line-height:19px; color:${MUTED};">
              ${footerNote}<br>
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

   Confirma y tranquiliza: el código bien grande, cuatro datos para que
   reconozca su solicitud, y el enlace para consultarla. Nada operativo.
-------------------------------------------------------------------------- */

function customerHtml(created, data, ctx) {
    const name = ctx.oneLine(data.firstName);
    const vehicle = [ctx.oneLine(data.brand), ctx.oneLine(data.model), data.year].filter(Boolean).join(' ');
    const zone = [ctx.oneLine(data.department), ctx.oneLine(data.province)].filter(Boolean).join(' / ');
    const lookupUrl = ctx.siteUrl ? `${ctx.siteUrl}/pgs/repair.html#consulta` : '';

    const rows = detailRows([
        { label: 'Vehículo', value: vehicle },
        { label: 'Placa', value: ctx.oneLine(data.plate) },
        { label: 'Acabado', value: ctx.qualityLabel(data.quality) },
        { label: 'Piezas a pintar', value: ctx.partsLabel(data.parts) },
        { label: 'Zona', value: zone },
    ]);

    const body = `
        <tr>
          <td class="px" align="left" style="padding:36px 48px 0 48px;">
            ${eyebrow('Solicitud recibida')}
            <div style="font-family:${FONT}; font-size:30px; line-height:38px; color:${INK}; font-weight:normal;">${name ? `Gracias, ${escapeHtml(name)}` : 'Gracias'}</div>
            <div style="font-family:${FONT}; font-size:16px; line-height:26px; color:${BODY}; padding-top:16px;">
              Recibimos tu solicitud de pintura y ya está registrada. Te contactaremos
              en 24 horas con tu presupuesto personalizado.
            </div>
          </td>
        </tr>

        <tr>
          <td class="px" style="padding:28px 48px 0 48px;">
            ${codePanel('Código de seguimiento', created.id)}
            <div style="font-family:${FONT}; font-size:13px; line-height:20px; color:${MUTED}; padding-top:10px;">Guárdalo: con este código puedes ver el estado de tu solicitud cuando quieras.</div>
          </td>
        </tr>

        <tr>
          <td class="px" style="padding:28px 48px 0 48px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${rows}
            </table>
          </td>
        </tr>
${lookupUrl ? `
        <tr>
          <td class="px" align="center" style="padding:32px 48px 0 48px;">
            ${button(lookupUrl, 'CONSULTAR MI SOLICITUD')}
          </td>
        </tr>` : ''}

${hairline('36px 48px 0 48px')}

        <tr>
          <td class="px" align="left" style="padding:24px 48px 32px 48px;">
            ${eyebrow('Contacto')}
            <div style="font-family:${FONT}; font-size:14px; line-height:24px; color:${BODY};">
              ${escapeHtml(SHOP_ADDRESS)}<br>
              Tel. / WhatsApp: <a href="tel:${SHOP_PHONE_TEL}" style="color:${RED}; text-decoration:none;">${SHOP_PHONE}</a><br>
              ${escapeHtml(SHOP_HOURS)}
            </div>
          </td>
        </tr>`;

    return shell({
        title: `Tu solicitud en Autocolor — ${created.id}`,
        preheader: `Tu código de seguimiento es ${created.id}. Te contactaremos en 24 horas con tu presupuesto.`,
        kicker: 'Taller de pintura automotriz',
        body,
        footerNote: 'Recibiste este correo porque enviaste una solicitud en Autocolor.',
    });
}

/* -----------------------------------------------------------------------------
   El correo del taller

   Mismo lenguaje visual y otro trabajo: esto no confirma nada, es la ficha con
   la que se prepara un presupuesto. Cambia lo que hace falta que cambie:

     - Manda el contacto, no el saludo. El teléfono y el correo van arriba y
       como enlaces, porque lo primero que se hace con esto es llamar, y
       muchas veces desde el móvil.
     - El titular es cliente y placa, que es como se reconoce un trabajo de un
       vistazo en una bandeja con varios.
     - Las piezas van con su nombre («Capó»), no con el identificador del
       modelo 3D, y enumeradas: son las que hay que presupuestar.
     - Sin botón de marca ni promesas: el enlace lleva al panel.
-------------------------------------------------------------------------- */

function shopHtml(created, data, ctx) {
    const fullName = [ctx.oneLine(data.firstName), ctx.oneLine(data.lastName)].filter(Boolean).join(' ');
    const vehicle = [ctx.oneLine(data.brand), ctx.oneLine(data.model)].filter(Boolean).join(' ');
    const zone = [ctx.oneLine(data.department), ctx.oneLine(data.province)].filter(Boolean).join(' / ');
    const panelUrl = ctx.siteUrl ? `${ctx.siteUrl}/pgs/taller.html` : '';
    const phone = ctx.formatPhone(data.phone);
    const email = ctx.oneLine(data.email);

    // Teléfono y correo como enlaces: llamar o escribir es lo primero que se
    // hace al abrir esto, y en el móvil un número que no se pulsa se acaba
    // copiando a mano.
    const contactRows = detailRows([
        {
            label: 'Teléfono',
            value: phone,
            html: phone ? `<a href="tel:${escapeHtml(phone.replace(/[^+\d]/g, ''))}" style="color:${RED}; text-decoration:none; font-weight:bold;">${escapeHtml(phone)}</a>` : '',
        },
        {
            label: 'Email',
            value: email,
            html: email ? `<a href="mailto:${escapeHtml(email)}" style="color:${RED}; text-decoration:none;">${escapeHtml(email)}</a>` : '',
        },
        { label: 'Zona', value: zone },
    ]);

    const vehicleRows = detailRows([
        { label: 'Marca y modelo', value: vehicle },
        { label: 'Carrocería', value: ctx.bodyTypeLabel(data.bodyType) },
        { label: 'Año', value: data.year },
        { label: 'Kilometraje', value: data.mileage === null || data.mileage === undefined ? '' : `${data.mileage.toLocaleString('es-PE')} km` },
        { label: 'Código de color', value: ctx.oneLine(data.colorCode) },
        // La silueta del visor 3D no siempre coincide con la carrocería real
        // (cuatro siluetas para ocho carrocerías), así que va aparte.
        { label: 'Silueta 3D', value: ctx.vehicleLabel(data.vehicle) },
    ]);

    const workRows = detailRows([
        { label: 'Acabado', value: ctx.qualityLabel(data.quality) },
        {
            label: `Piezas (${data.parts.length})`,
            value: ctx.partsLabel(data.parts),
            html: `<ul style="margin:0; padding-left:18px;">${data.parts.map((p) => `<li style="padding-bottom:2px;">${escapeHtml(ctx.partLabel(p))}</li>`).join('')}</ul>`,
        },
    ]);

    const body = `
        <tr>
          <td class="px" align="left" style="padding:36px 48px 0 48px;">
            ${eyebrow('Nueva solicitud')}
            <div style="font-family:${FONT}; font-size:26px; line-height:34px; color:${INK}; font-weight:normal;">${escapeHtml(fullName || 'Solicitud sin nombre')}</div>
            <div style="font-family:${MONO}; font-size:18px; line-height:26px; letter-spacing:2px; color:${RED}; padding-top:6px; font-weight:bold;">${escapeHtml(data.plate)}</div>
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
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${GROUND}; border-left:3px solid ${RED};">
              <tr>
                <td style="padding:16px 18px; font-family:${FONT}; font-size:15px; line-height:24px; color:${BODY};">${escapeMultiline(data.notes)}</td>
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
        title: `Solicitud ${created.id} — ${data.plate}`,
        preheader: `${fullName || 'Cliente'} · ${data.plate} · ${vehicle} · ${data.parts.length} pieza(s)`,
        kicker: 'Aviso interno del taller',
        body,
        footerNote: 'Aviso automático del asistente de cotización. Responder a este correo le escribe al cliente.',
    });
}

module.exports = {
    customerHtml,
    shopHtml,
    escapeHtml,
    LOGO_CID,
};
