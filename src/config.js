/* =========================================================================
   config.js — a qué servidor le habla el sitio

   El asistente necesita un servidor (el de server/) para guardar las
   solicitudes y para consultarlas por código. Un alojamiento estático como
   GitHub Pages sirve el HTML pero no puede correr ese servidor: ahí el
   formulario responde 405 porque no hay nadie que atienda el POST.

   Con AUTOCOLOR_API_BASE vacío, el sitio le habla al mismo origen desde el
   que se sirvió — que es lo correcto cuando `npm start` sirve las dos cosas.
   Si el sitio vive en un sitio estático y la API en otro lado, aquí va el
   origen de la API, sin barra final:

       window.AUTOCOLOR_API_BASE = "https://api.autocolor.pe";

   Ese origen tiene que incluir al del sitio en su ALLOWED_ORIGINS (ver
   server/server.js), o el navegador bloqueará las peticiones.
   ========================================================================= */

window.AUTOCOLOR_API_BASE = "";
