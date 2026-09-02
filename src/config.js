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


/* -------------------------------------------------------------------------
   Fotos de los vehículos (paso 1)

   La ficha del paso 1 muestra el vehículo que el cliente acaba de elegir.
   Sin tocar nada usa las fotos del propio sitio: una por modelo, en
   imgs/assets/stock-models/, que no dependen de ningún servicio.

   imagin.studio entrega en cambio fotos recortadas, sin fondo y por año del
   modelo. Es de pago y cada cliente tiene su clave; poniéndola aquí, la
   ficha las prefiere a las del sitio:

       window.AUTOCOLOR_CAR_IMAGE_CUSTOMER = "autocolor-pe";

   Si la foto que toque no carga —sea del sitio o del servicio—, la ficha
   muestra el logo de la marca (imgs/brands/) y nunca se queda en blanco.
   ------------------------------------------------------------------------- */

window.AUTOCOLOR_CAR_IMAGE_CUSTOMER = "";
