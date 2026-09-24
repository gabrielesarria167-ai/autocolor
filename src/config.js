/* =========================================================================
   config.js: which server the site talks to

   The wizard needs a server (the one in server/) to store requests and to
   look them up by code. A static host such as GitHub Pages serves the HTML
   but cannot run that server, so there the form answers 405: nobody is
   listening for the POST.

   With AUTOCOLOR_API_BASE empty, the site talks to the origin it was served
   from, which is right when `npm start` serves both. If the site lives on a
   static host and the API somewhere else, put the API origin here, with no
   trailing slash:

       window.AUTOCOLOR_API_BASE = "https://api.autocolor.pe";

   That origin has to list the site's origin in its ALLOWED_ORIGINS (see
   server/server.js), or the browser will block the requests.
   ========================================================================= */

window.AUTOCOLOR_API_BASE = "";


/* -------------------------------------------------------------------------
   Vehicle photos (step 1)

   The step 1 card shows the vehicle the customer just picked. Out of the box
   it uses the site's own photos: one per model, in imgs/assets/stock-models/,
   with no outside service involved.

   imagin.studio instead serves cut-out photos, with no background and by
   model year. It is paid and each customer gets a key; set it here and the
   card prefers those photos over the site's:

       window.AUTOCOLOR_CAR_IMAGE_CUSTOMER = "autocolor-pe";

   If the photo it needs does not load, from the site or from the service,
   the card shows the brand logo (imgs/brands/) and is never left blank.
   ------------------------------------------------------------------------- */

window.AUTOCOLOR_CAR_IMAGE_CUSTOMER = "";
