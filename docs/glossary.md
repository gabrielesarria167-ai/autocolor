# Glossary

The UI, the database values and some identifiers use Spanish words. This is
what they mean in this codebase.

## Business terms

| Term | Meaning here |
| --- | --- |
| **taller** | The workshop, i.e. the body shop. `pgs/taller.html` is the staff panel. |
| **matizado** | Paint mixed to match a specific colour. The shop sells it to other shops (`pgs/paintings.html`, table `paint_orders`). |
| **solicitud** | A quote request from the wizard (a row in `requests`). |
| **pedido** | An order, here a matizado order (a row in `paint_orders`). |
| **jefe (del taller)** | The boss. One worker code in `AUTOCOLOR_BOSS_ID`. |
| **trabajador** | A worker. Codes in `AUTOCOLOR_WORKER_IDS`. |
| **placa** | Licence plate. Peruvian format `ABC-123` (three alphanumerics, dash, three more). |
| **pieza** | A body panel (hood, door, bumper…). Stored by GLB node id, labelled by `src/parts.js`. |
| **acabado** | Finish. For the wizard it is the quality tier (`quality`); for paint it is the paint type (`finish`). |
| **envase** | Container, the tin size of a paint order. |
| **espectrofotómetro** | Spectrophotometer, the device that measures a colour in CIELAB. |
| **plancha de prueba** | Test panel sprayed to approve a mixed colour before delivery. |
| **ocupado / ocupar** | "Held" / to take a vehicle. A worker holds a vehicle while working on it (`occupied_by`). |
| **liberar** | To release a held vehicle. |
| **acompañar** | To join a vehicle someone else already holds (the second of two holders). |
| **local** | The shop's premises. A "walk-in" is a vehicle registered at the counter ("registrado en el local"). |
| **RUC** | Peru's tax id. The paint form no longer asks for it; the column stays for old orders. |
| **departamento / provincia** | Peru's first and second administrative levels (`src/cities.js`). |
| **soles (S/)** | Peruvian currency. Prices are whole soles. |
| **referencial** | "Indicative". Every price the site shows is indicative; the shop confirms it. |

## Quality tiers (`requests.quality`)

| Value | Label on screen |
| --- | --- |
| `standard` | Económico |
| `premium` | Profesional |
| `custom` | Alta gama |

## Request statuses (`requests.status`)

In order. The customer sees the label from `src/statuses.js`.

| Value | Label | Meaning |
| --- | --- | --- |
| `recibido` | Recibida | Received, not yet in the shop |
| `planchado` | Planchado (PL) | Panel beating |
| `desmontaje_montaje` | Desmontaje y montaje (D/M) | Disassembly and reassembly |
| `pintura` | Pintura (PI) | Painting |
| `preparacion` | Preparación (PRE) | Surface preparation |
| `cuadrada` | Cuadrada (CU) | Alignment / fitting check |
| `cristales` | Cristales (CRI) | Glass |
| `finitura` | Finitura (FI) | Finishing |
| `listo` | Lista para recoger | Ready for pickup |
| `entregado` | Entregada | Delivered (finished, releases the holders) |
| `cancelado` | Cancelada | Cancelled (finished, releases the holders) |

## Paint order statuses (`paint_orders.status`)

`recibido` (Recibido) → `preparacion` (En preparación) → `listo` (Listo para
recoger) → `entregado` (Entregado), or `cancelado` (Cancelado).

## Paint order methods (`paint_orders.method`)

| Value | How the colour was identified |
| --- | --- |
| `code` | The customer typed the factory code from the car's label. |
| `model` | The customer picked it from the finder by make, model and year, without reading the label. The shop should confirm it. |
| `reading` | The customer sent their own CIELAB reading. The server still accepts it; the page no longer offers it. |
| `in_person` | The customer will bring the vehicle to be measured. No colour, tin or price yet; the boss fills them in later. |

## Paint finishes (`finish`)

| Value | Label | Price factor |
| --- | --- | --- |
| `solido` | Sólido | 1.00 |
| `metalico` | Metálico | 1.15 |
| `perlado` | Perlado | 1.35 |
| `tricapa` | Tricapa | 1.60 |

## Tin sizes (`size`)

Fractions of a US gallon (3,785.41 ml): `1_32`, `1_16`, `1_8`, `1_4`, `1_2`,
`1_1`. Base prices and volumes are in `SIZES` in `src/paints.js`.

## 3D silhouettes (`requests.vehicle`)

There are four 3D models and eight body types. `BODY_TYPES` in
`src/carModels.js` maps each body to a model.

| `vehicle` | Label | Bodies drawn on it |
| --- | --- | --- |
| `wagon` | Familiar | sedan, hatchback, coupe, wagon |
| `suv` | SUV | suv |
| `pickup` | Pickup | pickup |
| `van` | Furgoneta | minivan, van |
