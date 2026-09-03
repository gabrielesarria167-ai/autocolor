# Autocolor

Sitio y asistente de cotización de pintura automotriz. El asistente
(`pgs/repair.html`) toma cuatro pasos —vehículo, acabado, piezas sobre un
visor 3D y datos de contacto—, guarda la solicitud en Postgres y le entrega
al cliente un código de 10 dígitos con el que puede consultar su estado.

## Puesta en marcha

Hace falta Node 18 o más nuevo y los binarios de Postgres instalados
(Postgres.app o Homebrew).

```bash
npm install                          # única dependencia: pg
cp .env.example .env                 # y escribe ahí la contraseña del taller
npm run db:init                      # crea y levanta el servidor propio
npm start                            # http://localhost:3000
```

El `.env` es opcional para el sitio público, pero **sin él el panel del taller
queda apagado** (ver «El día a día del taller»). No se versiona: está en
`.gitignore`, y lo que ya venga en el entorno le gana.

`db:init` es solo la primera vez. Después, cada vez que se trabaja en el
proyecto:

```bash
npm run db:start                     # levanta el Postgres de Autocolor
npm start
```

## El servidor Postgres de Autocolor

Autocolor **no comparte clúster con los demás proyectos de la máquina**:
corre su propio servidor, con su propio directorio de datos y su propio
puerto. Apagar, respaldar, actualizar o borrar la base de otro proyecto no
toca la de Autocolor, y al revés.

Está dado de alta en Postgres.app, así que aparece en su lista —junto a
sarTech (5432) y coursepostgreSQL (5433)— y se puede arrancar y parar con el
botón Start de siempre. Los comandos de abajo hacen lo mismo desde la
terminal; ambos caminos actúan sobre el mismo servidor, así que da igual cuál
se use.

| | |
| --- | --- |
| Puerto | `5434` |
| Datos | `~/Library/Application Support/Postgres/autocolor` |
| Log | `~/Library/Application Support/Postgres/autocolor/postgresql.log` |
| Base | `autocolor`, tabla `requests` |

```bash
npm run db:start     npm run db:stop      npm run db:status
npm run db:psql      # psql sobre la base autocolor
npm run db:schema    # vuelve a aplicar server/schema.sql
```

El directorio de datos vive fuera del repositorio a propósito: un
`git clean -xfd` no debe poder borrar las solicitudes de los clientes.

Todo se puede reubicar con variables de entorno —`AUTOCOLOR_PGDATA`,
`AUTOCOLOR_PGPORT`, `AUTOCOLOR_PG_BIN`, `AUTOCOLOR_PGDATABASE`— y la
aplicación acepta las `PG*` de libpq (`PGHOST`, `PGPORT`, `PGUSER`,
`PGPASSWORD`, `PGDATABASE`) por si en producción la base está en otro lado.
`PORT` cambia el puerto del sitio. El servidor escucha solo en `127.0.0.1`,
porque detrás de la API hay teléfonos de clientes y no corresponde que
aparezcan en la red del local por tener el servidor encendido; `HOST=0.0.0.0`
lo abre a propósito, por ejemplo para probar el sitio desde el móvil.

## Cómo está organizado

| Ruta | Qué es |
| --- | --- |
| `index.html`, `src/home.js` | Portada |
| `pgs/repair.html`, `src/repair.js` | Asistente de cotización |
| `src/carVisual.js` | Visor 3D del paso 3 (three.js, un modelo por vehículo) |
| `src/lookup.js` | Consulta de una solicitud por su código |
| `pgs/taller.html`, `src/staff.js` | Panel del taller: la cola de trabajo y el cambio de estado |
| `src/cities.js` | Departamentos y provincias del Perú |
| `styles.css` | Todos los estilos del sitio |
| `server/server.js` | Sirve el sitio y la API |
| `src/config.js` | A qué servidor le habla el sitio |
| `server/db.js` | Acceso a Postgres |
| `server/auth.js` | La contraseña y las sesiones del panel del taller |
| `server/env.js` | Lee el `.env` de la raíz al arrancar |
| `_config.yml` | Qué no se publica en GitHub Pages |
| `server/pgserver.sh` | Crea y controla el servidor Postgres propio |
| `server/schema.sql` | Tabla `requests` + consultas útiles para el taller |
| `imgs/assets/3d-visuals/` | Modelos `.glb` servidos y las páginas donde se prepararon |

## Publicar el sitio

El asistente necesita el servidor de `server/` para funcionar: guarda las
solicitudes y las consulta por código. Un alojamiento **estático** (GitHub
Pages, Netlify sin funciones, S3) sirve el HTML pero no puede correr ese
servidor — ahí el formulario responde `405` al enviar, porque no hay nada
que atienda el `POST`.

Hay dos formas de publicarlo:

1. **Todo junto.** Un servicio que corra Node (Render, Railway, Fly.io, un
   VPS) sirve el sitio y la API desde el mismo dominio, con una base
   Postgres al lado. No hay nada que configurar: `AUTOCOLOR_API_BASE` se
   queda vacío y el sitio le habla a su propio origen.

2. **Separados.** El sitio en GitHub Pages y la API en otro servicio. Ahí
   hacen falta dos cosas:

   - En `src/config.js`, el origen de la API:

     ```js
     window.AUTOCOLOR_API_BASE = "https://api-de-autocolor.example";
     ```

   - En el servidor, el origen del sitio, o el navegador bloqueará las
     peticiones por CORS:

     ```bash
     ALLOWED_ORIGINS=https://gabrielesarria167-ai.github.io npm start
     ```

Mientras no haya API detrás, el sitio publicado lo dice con todas sus
letras en vez de pedir que se reintente: el formulario avisa que el envío no
está disponible en esa versión del sitio, y la consulta por código, lo mismo.

Ojo: GitHub Pages publica **todo** el repositorio salvo lo que liste
`_config.yml`. Ahí no debe haber contraseñas ni claves; las que haga falta van
en variables de entorno del servicio que corra la API, o en el `.env` local,
que no se versiona.

Lo que queda fuera de la publicación:

| Excluido | Por qué |
|---|---|
| `pgs/taller.html`, `src/staff.js` | Es la herramienta interna del taller; no tiene por qué existir en la web pública |
| `server/` | El servidor y el esquema de la base, que no se sirven como sitio |

Excluir la página la **esconde, no la cierra**: lo que protege los datos sigue
siendo la contraseña de la API (`server/auth.js`).

## Fuentes de los modelos 3D

Los `.glb` que están versionados son los que sirve el sitio. Sus fuentes —los
`.blend` de Blender y los `.glb` sin comprimir— **se quedan en la máquina y no
en el repositorio**:

| Qué | Dónde | En git |
|---|---|---|
| Modelo servido | `imgs/assets/3d-visuals/<modelo>/<modelo>.glb` | sí |
| `.glb` sin comprimir | `imgs/assets/3d-visuals/<modelo>/src/` | no |
| Archivo de Blender | junto al modelo, `*.blend` | no |

No están fuera por capricho: pesan cientos de MB, no se sirven nunca, y GitHub
Pages publica todo lo que esté versionado. Quien clone el repositorio puede
correr el sitio sin ellos; para volver a exportar un modelo hacen falta los
originales, que son tuyos y no viajan.

Sacarlos de git detiene el crecimiento, pero **no encoge la historia**: lo que
ya se subió sigue ahí. Vaciarla del todo necesita `git filter-repo` y un push
forzado, que es una decisión aparte.

## El catálogo de vehículos

En el paso 1 el cliente escribe qué vehículo tiene —marca, modelo, año y
placa— y el asistente deduce el resto. Las marcas y modelos viven en
`src/carModels.js`, un archivo que se edita a mano:

```js
{ id: "corolla", name: "Corolla", type: "sedan", family: "corolla" }
```

`type` es la carrocería, y de ella sale sola la silueta 3D sobre la que se
eligen las piezas en el paso 3: hay tres modelos (`van`, `wagon`, `pickup`),
así que un sedán o un hatchback se pintan sobre la de auto, y una SUV sobre
la de la pickup. Cuando no coinciden, la ficha del paso 1 lo avisa. La
equivalencia está en `BODY_TYPES`, al principio del mismo archivo.

### Las fotos de los vehículos

La ficha muestra el vehículo elegido, y el sitio trae su propia foto de cada
modelo en `imgs/assets/stock-models/`. El archivo se llama
`<marca>-<modelo>.jpg` con los ids del catálogo, así que no hay nada que
declarar: un modelo nuevo solo necesita que se deje ahí su foto con ese
nombre.

Son fotos de Wikimedia Commons, a 900 px de ancho y sin marcas de agua. Casi
todas son **CC BY-SA o CC BY, que obligan a dar crédito**: el autor, la
licencia y el enlace de cada una están en
[`imgs/assets/stock-models/CREDITS.md`](imgs/assets/stock-models/CREDITS.md).
Si las fotos se usan fuera del asistente, el crédito tiene que ir con ellas.

Si el taller prefiere fotos recortadas sin fondo y por año del modelo,
[imagin.studio](https://imagin.studio) las entrega —es de pago— y basta con
poner la clave en `src/config.js` para que la ficha las use en lugar de las
del sitio:

```js
window.AUTOCOLOR_CAR_IMAGE_CUSTOMER = "la-clave-del-taller";
```

Cuando una foto no carga, venga de donde venga, la ficha muestra el logo de
la marca (`imgs/brands/`) recortado con máscara y pintado en su color, así
que el paso 1 nunca se queda con un hueco.

## API

| Ruta | Qué hace |
| --- | --- |
| `POST /api/requests` | Guarda una solicitud y devuelve `{ id, status, createdAt }` |
| `GET /api/requests/:id` | Devuelve `{ id, brand, model, vehicle, firstName, lastName, status }` |

La consulta devuelve solo eso: el código circula en mensajes y papeles, así
que no debería alcanzar para sacar el teléfono, el correo ni las notas de un
cliente.

Las del panel del taller, todas detrás de la contraseña compartida:

| Ruta | Qué hace |
| --- | --- |
| `POST /api/staff/login` | Abre sesión con la contraseña del taller |
| `POST /api/staff/logout` | La cierra |
| `GET /api/staff/requests?status=` | La cola de trabajo, opcionalmente por estado |
| `PATCH /api/staff/requests/:id` | Cambia el estado de una solicitud |

## El día a día del taller

Las solicitudes llegan a la tabla `requests` de la base `autocolor`, y el
taller las trabaja desde **`/pgs/taller.html`**: la lista completa —código,
placa, cliente, teléfono, vehículo, ingreso, piezas y acabado— con un
buscador, filtros por estado y una píldora de color por fila que despliega los
seis estados para mover la solicitud.

El buscador filtra en el navegador sobre lo que ya se trajo (placa, cliente,
código, marca y teléfono); los filtros de estado, en cambio, se le piden al
servidor, porque la consulta trae como mucho 200 filas y recortarlas en el
navegador dejaría fuera las viejas.

El panel solo existe si el servidor encuentra la contraseña del taller. Lo
normal es dejarla en el `.env` de la raíz:

```bash
# .env
AUTOCOLOR_STAFF_PASSWORD=la-del-taller
```

y arrancar con `npm start` a secas. Ponerla delante del comando sigue
funcionando y tiene prioridad sobre el archivo:

```bash
AUTOCOLOR_STAFF_PASSWORD='la-del-taller' npm start
```

Sin ella las rutas `/api/staff/*` responden `503` y el panel queda apagado,
que es lo que debe pasar si alguien se olvida de configurarlo. La contraseña
se comprueba en el servidor, no en el navegador: `pgs/taller.html` es un
archivo estático como cualquier otro y su código lo lee todo el mundo, así
que lo que está cerrado es la API. La sesión es una cookie `HttpOnly` de ocho
horas que vive en la memoria del proceso, de modo que reiniciar el servidor
obliga a entrar de nuevo. Detrás de https hay que añadir
`AUTOCOLOR_STAFF_COOKIE_SECURE=1`.

El panel **no está en GitHub Pages**: `_config.yml` lo excluye de la
publicación, y aunque estuviera no tendría API que consultar.

Todo esto también se puede hacer a mano desde psql:

```sql
SELECT id, created_at::date, first_name || ' ' || last_name AS cliente,
       brand || ' ' || model AS vehiculo, model_year, plate,
       quality, cardinality(parts) AS piezas, phone, status
  FROM requests
 WHERE status NOT IN ('entregado', 'cancelado')
 ORDER BY created_at DESC;

UPDATE requests SET status = 'presupuestado' WHERE id = '1234567890';
```

Estados posibles: `recibido`, `presupuestado`, `en_taller`, `listo`,
`entregado`, `cancelado`. Es lo que ve el cliente al consultar su código.
Hay más consultas de ejemplo al final de `server/schema.sql`.
