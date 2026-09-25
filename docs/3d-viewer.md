# The 3D panel picker (`src/carVisual.js`)

A three.js viewer that shows one of four vehicle models, lets the user tap
body panels to select them, and highlights the selection. Three places mount
it:

| Host | Mode | Selection lives in |
| --- | --- | --- |
| Wizard step 3 (`src/repair.js`) | interactive, camera buttons | `state.parts` |
| Walk-in form (`src/staff.js`) | interactive, camera buttons | `intakeParts` |
| Panel's «Piezas» viewer (`src/staff.js`) | read-only, turntable | the request's `parts` |

It is an **ES module** (the only one in `src/`) because three.js is. Hosts load
it with a dynamic `import()` only when needed, so nobody downloads three.js or
a 7–13 MB model before reaching the step that uses them. The page's import map
resolves `three` and `three/addons/` to `vendor/three@0.169.0/`.

## Design principles

- **It owns no selection state.** Every click calls the host's
  `onPartToggle(id)`, and every redraw asks the host's `isPartSelected(id)`.
  The host's array is the single source of truth, shared with the checklist.
- **It draws on demand.** No permanent render loop, except for the read-only
  turntable. Every change calls `requestRender()`.
- **One viewer at a time.** Hosts destroy the old viewer (and swap its
  canvas) before mounting another. Resident models of this size are not free
  on the GPU.
- **Everything model-specific is data** in `VEHICLE_MODELS`, checked against
  the GLB files themselves rather than trusted from node names.

## `VEHICLE_MODELS` (`:59`)

One entry per silhouette:

| Field | Meaning |
| --- | --- |
| `url` | The GLB, resolved relative to the module (`new URL(…, import.meta.url)`). |
| `paintMaterial` | Name of the material used for body paint in that file. |
| `front`, `left` | Unit axes in the model's own space. The GLBs come from different sources with different export conventions (all Y-up). |
| `bodyColor` | RGB the paint material is set to at load. Every model's paint is authored as a dull primer or a dark colour, so it is brightened to read well under the red selection overlay. |
| `trimColor` | SUV only: the black for panels that are cladding, not paint. |
| `maxRoughness`, `minMetalness`, `maxMetalness` | Material clamps per model. The SUV's paint is very metallic and took its colour from reflections, so it gets a metalness ceiling. |
| `parts` | The GLB node names a user can select. These are the ids stored in the database. `src/parts.js` has a copy (`BY_VEHICLE`) and the labels. |
| `hiddenNodes` | Nodes to hide. The van has a duplicate node pointing at the same mesh as a door, which would double-draw and add an unlabelled click target. |
| `partOverrides` | SUV only: which material a panel is authored in when it is not the paint material, and `finish: 'trim'` for panels that stay black. |
| `trimNodes` | SUV only: a regex for exported offcuts (`…_black_part`) that must be repainted black after the bulk recolour. |

Model notes kept in the comments:

- **Van**: node names are misleading. `back_door_*` are the sliding doors,
  `rear_window_*` are painted rear quarter panels (not glass). Bumpers are a
  plastic material, so they are not offered.
- **Wagon**: authored in centimetres (about 476 units long against the SUV's
  5), which is why every camera distance and clipping plane is derived from
  the model's bounding box. Its bumpers do use the paint material.
- **Pickup**: a double-cab Hilux; the bed is one `tonneau` panel.
- **SUV**: a Hummer EV. Bumpers and side skirts are black cladding but still
  selectable (scraped bumpers are a common job). The roof is authored in the
  black material but is sheet metal, so it is painted body colour.

`GLTFLoader` strips `.` from node names, so `lower_body_left.001` becomes
`lower_body_left001`.

## `mountCar3D(options)` (`:260`)

Options:

| Option | Required | Meaning |
| --- | --- | --- |
| `vehicle` | yes | Key into `VEHICLE_MODELS`. An unknown key throws. |
| `canvasEl`, `canvasWrapEl` | yes | The canvas and the element whose size it follows. |
| `overlayEl`, `progressBarEl`, `loadingLabelEl`, `errorEl` | no | The loading overlay. |
| `buttonsEl` | no | A container of `[data-view]` buttons (front, back, left, right, top). |
| `isPartSelected(id)`, `onPartToggle(id)` | yes | The host's selection. |
| `onLoadError()` | no | Called if the model cannot be loaded, so the host can offer its checklist. |
| `interactive` | default `true` | `false` binds no pointer handlers at all. |
| `spin` | default `false` | Turntable mode. |
| `loadErrorText` | default wizard wording | What the overlay says on failure. |

It returns a controller:

| Method | Use |
| --- | --- |
| `loadFailed()` | `true` once the GLB could not be loaded. Hosts remount in that case instead of reusing the viewer. |
| `resize()` | Call after showing a container that was hidden (it measured zero). |
| `refreshSelection()` | Call after the selection changed outside a canvas click (checklist, remove button, "clear all"). |
| `resetView()` | Fly back to the front view. |
| `destroy()` | Release everything, including the WebGL context. The canvas cannot be reused. |

### Scene setup

- `PerspectiveCamera` with a 45° field of view; near and far are placeholders
  until the model's size is known.
- `WebGLRenderer` with `alpha: true` (no background: the car floats on the
  page), pixel ratio capped at 2, sRGB output, ACES filmic tone mapping.
- A hemisphere light and two directional lights. Directional lights have a
  direction rather than a position, so the rig does not need scaling for the
  centimetre-scale wagon.
- No `OrbitControls`. The camera moves only through the view buttons.

### Rendering on demand: `requestRender()` (`:332`)

```js
function requestRender() {
    if (renderQueued !== null || destroyed) return;
    renderQueued = requestAnimationFrame(() => {
        renderQueued = null;
        if (!destroyed) renderer.render(scene, camera);
    });
}
```

At most one frame is queued. A permanent loop used to redraw about a million
triangles every frame for as long as the page was open, even on steps where the
viewer was hidden.

### Loading the model, with a retry

Large downloads fail in a quiet way: the transfer stalls and never errors,
because three's `FileLoader` has no timeout. The overlay would say «Cargando
modelo 3D…» forever and step 3 could not be completed.

- `startLoad()` (`:830`) starts attempt `n`. Attempt 2 uses
  `url?reintento=2`, a URL the browser and `FileLoader` have not seen, so it
  is a genuinely new request. The server routes on the path and ignores the
  query.
- `armStallTimer()` (`:803`) is a 15 s watchdog, **re-armed on every progress
  event**. What trips it is bytes that stop arriving, not a slow transfer. The
  last progress event (`loaded >= total`) disarms it, because meshopt decoding
  and parsing can take seconds without any progress.
- `retryOrFail(err)` (`:813`): if fewer than two attempts were made, start
  another; otherwise set `loadFailed`, show the error text, and call
  `onLoadError()`.
- The first model to arrive wins, whichever attempt it belonged to
  (`modelReady` guards `onModelLoaded`).
- Every callback checks `destroyed` first: `GLTFLoader` cannot be cancelled,
  and an outgoing viewer must not write to the loading UI of the next one.

Progress text uses `xhr.total` when known (the server's `X-File-Size` header
makes it the uncompressed size) and falls back to a byte count.

See the [review](review-2026-09-25.md) for an edge case where a late error
from the first attempt marks the viewer as failed while the second is still
downloading.

### When the model arrives: `onModelLoaded(gltf)` (`:868`)

1. Add the scene; hide `hiddenNodes`.
2. Compute the bounding box, its center, and the extents **along the model's
   own axes** (`extentAlong()`, `:256`), so the camera maths is the same for
   every file.
3. Set near and far from the bounding sphere (1 % and 20× the radius).
4. **Recolour the paint material once**: collect every material named
   `paintMaterial` into a `Set` (a shared material is fixed once), set its
   colour to `bodyColor`, apply the clamps. Compute missing vertex normals.
5. `applyTrimNodes()` (`:431`): repaint the SUV's `_black_part` offcuts black.
6. Collect every visible mesh as a raycast target (`pickable`), **before**
   overlays exist, so overlays can never be picked and wheels, glass and trim
   still block clicks.
7. For each id in `parts`:
   - `resolvePaintMesh(root, id)` (`:371`): the node itself if it is a mesh,
     otherwise the child mesh carrying the panel's material (a door node can
     bundle its chrome trim);
   - `applyFinish(mesh, id)` (`:415`): a body panel carrying the cladding, or
     a trim panel carrying the paint, gets a cloned material recoloured to
     match. Cloning matters: those materials are shared by dozens of other
     meshes;
   - `makeOverlay()` (`:446`) twice: a blue hover overlay and a red selection
     overlay. Each is a transparent `MeshBasicMaterial` that shares the
     panel's geometry, is parented to the panel (so it follows its transform),
     uses a negative polygon offset to sit just in front of it, draws last
     (`renderOrder = 999`), and has an empty `raycast` so it is never hit.
8. Compute the camera presets, place the camera at the front view, sync the
   buttons, start the turntable if `spin`, and hide the overlay.

### Camera presets: `computePresets()` (`:523`)

`fitDistance(horiz, vert, fov, aspect, padding)` (`:466`) is the distance at
which a box of that width and height fills the frame with 20 % padding. Each
view frames the two extents it sees, then backs off by half the extent along
its own axis, so the padding holds at the car's nearest surface, not only its
center. The five presets are the center plus or minus the front, left and up
axes at those distances.

### Camera flights: `flyToView(view)` (`:589`)

The camera orbits instead of moving in a straight line, so the car stays
centred and nothing passes through it:

1. Claim the view immediately (`currentView`, button state). A second click
   during a flight redirects it from wherever the camera is.
2. Direction from center to camera now (`fromDir`) and at the target
   (`toDir`), and their radii.
3. Opposite views (dot product < −0.9) have no unique arc, so they are routed
   over the roof: waypoints `[from, up, to]`.
4. Duration is proportional to the angle travelled (620 ms per quarter turn,
   clamped to 420–1150 ms). With `prefers-reduced-motion`, the camera jumps.
5. Each frame: ease with a sine curve, walk the waypoints by angle travelled,
   interpolate the direction on the great circle (`slerpDirection()`, `:488`),
   interpolate the radius, and `placeCamera()`.
6. On the last frame it lands on the preset as it is **now** (a resize during
   the flight recomputes presets).

`upHintFor(forward)` (`:503`) avoids the camera flipping when looking straight
down: it blends world-up into the car's front axis as the view gets steep.

### The turntable: `startSpin()` (`:698`)

For the read-only viewer. One lap every 20 seconds at the larger of the front
and side framing distances (so the car never grows out of frame as it turns),
tilted 16° above the horizon. The angle comes from the clock, not a frame
counter, so the speed is the same on slow screens. With reduced motion it shows
the front view, still.

### Pointer handling

Bound only when `interactive`:

- `onPointerMove` (`:977`): **mouse only**, throttled to one raycast per
  50 ms. Toggles the hover overlay and a `hoverable` cursor class.
- `onPointerClick` (`:1005`): raycast, and if the nearest hit is a panel, call
  `onPartToggle(id)`, then read `isPartSelected(id)` back and update both
  overlays.
- `onPointerUp` / `pointercancel` / `pointerleave` → `clearHover()`
  (`:1029`). On touch screens a tap fires `pointermove` before `click`, which
  made the tapped panel the hovered one; deselecting it then re-lit the hover
  overlay, and the panel the customer just removed stayed highlighted.
  `pointerup` comes before `click`, so clearing there fixes it.

### Resizing

A `ResizeObserver` on the canvas wrapper (falling back to `window` `resize`)
calls `onResize()` (`:1061`): resize the renderer, recompute presets, and
re-place the camera on the current view (unless flying or spinning). The
wrapper is observed rather than the window because its size also changes when a
scrollbar appears or the step is shown again.

A `webglcontextrestored` listener requests a frame, because a restored context
is blank until something draws.

### `destroy()` (`:1120`)

Stops the turntable and the watchdog, cancels a queued frame, disconnects the
observer, unbinds every listener (including the host's view buttons, which
outlive the viewer), disposes every geometry, texture and material, clears the
scene, and calls `renderer.dispose()` and `forceContextLoss()`. The host then
replaces the canvas.

## Changing a model

1. Export and compress the GLB (the README's «Cómo se comprime un modelo»
   section describes the meshopt pipeline).
2. Run `node tools/verify-3d.mjs base.glb new.glb`. It reads only the GLB's
   JSON chunk and checks that every id in `VEHICLE_MODELS[*].parts` still
   resolves to a mesh with the paint material, and that `src/parts.js` agrees.
   Optimisers often rename or merge nodes, and when they do the panel just
   stops being selectable, with no error.
3. If node names changed, update `parts` here, `BY_VEHICLE`, `LABELS` and
   `PRICE_GROUP_OF` in `src/parts.js`.
