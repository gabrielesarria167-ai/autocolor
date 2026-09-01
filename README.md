# Autocolor

Sitio y asistente de cotización de pintura automotriz. El asistente
(`pgs/repair.html`) toma cuatro pasos —vehículo, acabado, piezas sobre un
visor 3D y datos de contacto—, guarda la solicitud en Postgres y le entrega
al cliente un código de 10 dígitos con el que puede consultar su estado.

## Puesta en marcha

Hace falta Node 18 o más nuevo y un Postgres corriendo en la máquina.

```bash
npm install                          # única dependencia: pg
createdb autocolor                   # crea la base
npm run db:setup                     # crea la tabla requests
npm start                            # http://localhost:3000
```

`PORT` cambia el puerto. El host, usuario y contraseña de Postgres salen de
las variables `PG*` de libpq (`PGHOST`, `PGUSER`, `PGPASSWORD`, `PGPORT`); en
desarrollo normalmente basta con el Postgres local del propio usuario.
`PGDATABASE` permite apuntar a otra base que no se llame `autocolor`.

## Cómo está organizado

| Ruta | Qué es |
| --- | --- |
| `index.html`, `src/home.js` | Portada |
| `pgs/repair.html`, `src/repair.js` | Asistente de cotización |
| `src/carVisual.js` | Visor 3D del paso 3 (three.js, un modelo por vehículo) |
| `src/lookup.js` | Consulta de una solicitud por su código |
| `src/cities.js` | Departamentos y provincias del Perú |
| `styles.css` | Todos los estilos del sitio |
| `server/server.js` | Sirve el sitio y la API |
| `server/db.js` | Acceso a Postgres |
| `server/schema.sql` | Tabla `requests` + consultas útiles para el taller |
| `imgs/assets/3d-visuals/` | Modelos `.glb` y las páginas donde se prepararon |

## API

| Ruta | Qué hace |
| --- | --- |
| `POST /api/requests` | Guarda una solicitud y devuelve `{ id, status, createdAt }` |
| `GET /api/requests/:id` | Devuelve `{ id, vehicle, firstName, lastName, status }` |

La consulta solo devuelve esos cinco campos: el código circula en mensajes y
papeles, así que no debería alcanzar para sacar el teléfono, el correo ni las
notas de un cliente.

## El día a día del taller

Las solicitudes llegan a la tabla `requests` de la base `autocolor`. Para
verlas y para mover una de estado:

```sql
SELECT id, created_at::date, first_name || ' ' || last_name AS cliente,
       vehicle, quality, cardinality(parts) AS piezas, phone, status
  FROM requests
 WHERE status NOT IN ('entregado', 'cancelado')
 ORDER BY created_at DESC;

UPDATE requests SET status = 'presupuestado' WHERE id = '1234567890';
```

Estados posibles: `recibido`, `presupuestado`, `en_taller`, `listo`,
`entregado`, `cancelado`. Es lo que ve el cliente al consultar su código.
Hay más consultas de ejemplo al final de `server/schema.sql`.
