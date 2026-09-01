# Rebuilding the vehicle paint-panel selector for a new GLB

This is the exact process used to turn `van.glb` and `wagon.glb` into working
click-to-paint HTML viewers. It assumes a new GLB with the **same rough
authoring style**: a Blender/Sketchfab-style export with a paint-relevant
material shared across body panels, node names that are only *partially*
trustworthy, and no other documentation. Nothing here should be taken on
faith from a previous file — every phase below exists because trusting a
name, a bounding box, or an assumption carried over from the last model
produced a wrong answer at least once.

Treat this as a checklist, not a summary. Skipping a phase because "it
probably works like last time" is exactly how the bugs described inline
happened.

---

## 0. Tooling

```bash
pip install trimesh pyrender PyOpenGL PyOpenGL_accelerate numpy pillow --break-system-packages
```

Offscreen rendering needs a software/EGL backend — set this before importing
`pyrender`:

```python
import os
os.environ['PYOPENGL_PLATFORM'] = 'egl'
import trimesh, pyrender
```

You will also need **Node.js with the exact `three` version the target HTML
uses** (check the `<script type="importmap">` in the existing viewer, or
whatever version you're about to use):

```bash
npm install three@<version>
```

This is not optional tooling — Phase 7 depends on running the *real*
`GLTFLoader`, not reasoning about what it probably does. Every naming
assumption in this whole process gets a final check against it before it's
trusted.

---

## 1. Parse and inventory the GLB

Don't use a full glTF library yet — just pull the JSON chunk out of the
binary container so you can inspect it directly:

```python
import struct, json

with open('model.glb', 'rb') as f:
    data = f.read()

magic, version, length = struct.unpack('<III', data[0:12])
offset = 12
chunk_len, chunk_type = struct.unpack('<II', data[offset:offset+8])
offset += 8
gltf = json.loads(data[offset:offset+chunk_len])

print("nodes:", len(gltf['nodes']), "meshes:", len(gltf['meshes']),
      "materials:", len(gltf['materials']))
print("extensionsUsed:", gltf.get('extensionsUsed'))
print("num animations:", len(gltf.get('animations', [])))
for m in gltf['materials']:
    print(m['name'])
```

Things to note on this first pass:

- **`extensionsUsed`** — e.g. `KHR_materials_clearcoat`. Three.js's
  `GLTFLoader` resolves the common material extensions automatically into
  the corresponding `MeshPhysicalMaterial` properties; you don't need to
  handle them unless something exotic shows up. Don't add code for this
  unless a specific extension turns out to need it.
- **Animations** — if present, they will NOT autoplay unless the viewer
  code explicitly creates a `THREE.AnimationMixer` and calls `.update()` in
  the render loop. The existing viewer template doesn't do this, so
  animations sitting in the file are inert. Just confirm the template still
  doesn't create a mixer; don't add one.
- **Per-node transforms** — check whether nodes carry real `matrix` /
  `translation` / `rotation` / `scale`, or whether every node is identity
  (i.e. all geometry is pre-baked into world-space vertex positions):

  ```python
  for n in gltf['nodes']:
      if any(k in n for k in ('matrix', 'translation', 'rotation', 'scale')):
          print("HAS TRANSFORM:", n.get('name'))
  ```

  **This matters a lot and was a real bug source.** One source file had every
  node pre-baked to identity (so local geometry coordinates equal world
  coordinates directly). A different file had a single shared rotation on a
  wrapper node (common in Sketchfab exports doing a Z-up→Y-up conversion),
  meaning **local vertex coordinates are meaningless until that transform is
  applied** — a naive bounding-box check on raw local coordinates put a
  fender's Y-center at −63 (underground!) before this was caught. Always
  fetch WORLD-space geometry for analysis:

  ```python
  import trimesh
  scene = trimesh.load('model.glb', process=False)
  graph = scene.graph

  def world_mesh(name):
      transform, geom = graph.get(name)
      m = scene.geometry[geom].copy()
      m.apply_transform(transform)
      return m
  ```

---

## 2. Determine the coordinate convention — every time, never carried over

**Do not assume the new file uses the same convention as the last one.**
One model had `-X = front`; the very next one had `+X = front`, with the
left/right Z-sign flipped accordingly as a consequence. Verify fresh:

```python
merged = scene.dump(concatenate=True)
merged.visual = trimesh.visual.ColorVisuals(merged, vertex_colors=[200,200,200,255])

def look_at(eye, target, up):
    eye, target = np.array(eye, float), np.array(target, float)
    forward = target - eye; forward /= np.linalg.norm(forward)
    right = np.cross(forward, up); right /= np.linalg.norm(right)
    true_up = np.cross(right, forward)
    m = np.eye(4)
    m[:3,0], m[:3,1], m[:3,2], m[:3,3] = right, true_up, -forward, eye
    return m

center = scene.bounds.mean(axis=0)
radius = np.linalg.norm(scene.extents) * 1.2
views = {
  'plus_x':  (center + [radius,0,0], [0,1,0]),
  'minus_x': (center + [-radius,0,0], [0,1,0]),
  'plus_z':  (center + [0,0,radius], [0,1,0]),
  'minus_z': (center + [0,0,-radius], [0,1,0]),
  'top':     (center + [0,radius,0.001], [0,0,1]),
}
renderer = pyrender.OffscreenRenderer(900, 700)
for name, (eye, up) in views.items():
    pr_scene = pyrender.Scene(bg_color=[30,30,30,255], ambient_light=[0.4,0.4,0.4])
    pr_scene.add(pyrender.Mesh.from_trimesh(merged, smooth=False))
    pr_scene.add(pyrender.DirectionalLight(color=[1,1,1], intensity=4.0), pose=np.eye(4))
    cam = pyrender.PerspectiveCamera(yfov=np.radians(40))
    pr_scene.add(cam, pose=look_at(eye, center, up))
    color, _ = renderer.render(pr_scene)
    Image.fromarray(color).save(f'view_{name}.png')
```

Look at `view_plus_x.png` / `view_minus_x.png`: whichever shows headlights,
a tapering hood, and a windshield is **front**. The other is **rear**
(boxier, taillights, hatch/trunk).

Once front/rear (X-sign) is known, derive left/right by simple physical
reasoning rather than guessing: if a person sits in the vehicle facing the
front direction with world up `+Y`, their right hand points along
`cross(forward, up)`. Work this out numerically for the specific front
direction found — don't reuse the previous file's answer, since flipping
front also flips which Z-sign is "left."  Confirm with a real named part
once you have candidate node names (Phase 4) — e.g. render whatever node is
named `..._left` from your derived "left" camera position and check it
actually appears there.

Write the confirmed convention as a code comment before doing anything
else with it — every later phase (camera presets, panel left/right
assignment) depends on this being right.

---

## 3. Identify the paint material — don't trust the name, check the color

Grep the materials list for anything suggestive (`carpaint`, `body`,
`White_Body`, `paint`, etc.), then confirm by printing its actual
`baseColorFactor` — **in both prior files this was a dull mid-grey
primer color despite a name implying white/paint**, which is why the
viewer needs a runtime brightening override rather than trusting the
material as authored:

```python
for m in gltf['materials']:
    if m['name'] == '<candidate>':
        print(m['pbrMetallicRoughness'])
```

If `baseColorFactor` is something like `[0.33, 0.33, 0.33]` or
`[0.45, 0.45, 0.45]`, that confirms it — the viewer will need to override
`material.color` at load time (see Phase 10).

List every other material and sanity-check that they're clearly
non-paintable (glass, chrome, rubber, interior trim, tire, brake disk, rim,
mirror, headlight/taillight lens). **Check whether bumpers use the paint
material or a separate plastic material** — this varied between the two
prior files (one had plastic bumpers excluded from painting, the other had
bumpers on the paint material and included) and materially changes the
final panel count. Don't assume either way; check this file's own
materials list.

---

## 4. Enumerate every node using the paint material

```python
node_material = {}
node_mesh_idx = {}
for n in gltf['nodes']:
    if 'mesh' in n:
        mi = n['mesh']
        matidx = gltf['meshes'][mi]['primitives'][0].get('material')
        node_material[n['name']] = gltf['materials'][matidx]['name'] if matidx is not None else None
        node_mesh_idx[n['name']] = mi

paint_names = [n for n, m in node_material.items() if m == '<paint material name>']
```

**Careful:** this only reads `primitives[0]`'s material. A node can have
multiple primitives with different materials (see Phase 6) — that's fine
for this enumeration pass (multi-primitive paint+trim nodes still get
picked up since primitive 0 is usually the paint one), but don't assume
every node here has exactly one primitive.

For every paint-material node, compute **world-space** bounding box, face
count, and center (reusing `world_mesh()` from Phase 1). Multi-primitive
nodes may not resolve via a simple `graph.get(name)` in trimesh — trimesh
splits them into separately-named sub-geometries. Handle both cases:

```python
def paint_world_mesh(name, paint_material_name):
    if name in graph.nodes_geometry:
        transform, geom = graph.get(name)
        mesh = scene.geometry[geom]
        matname = getattr(getattr(mesh.visual, 'material', None), 'name', None)
        if matname != paint_material_name:
            return None
        m = mesh.copy(); m.apply_transform(transform)
        return m
    # multi-primitive node: trimesh split it into name_<hash> sub-geometries
    for s in [n for n in graph.nodes_geometry if n == name or n.startswith(name + '_')]:
        transform, geom = graph.get(s)
        mesh = scene.geometry[geom]
        matname = getattr(getattr(mesh.visual, 'material', None), 'name', None)
        if matname == paint_material_name:
            m = mesh.copy(); m.apply_transform(transform)
            return m
    return None
```

Sort candidates by face count. In both prior files, a clean split emerged:
a double-digit-to-low-thousands set of substantial panels, and a long tail
of sub-few-hundred-face slivers/seams/fragments. Treat that tail as
probably-junk **pending visual confirmation in Phase 5** — don't discard
by face count alone without at least spot-checking a few borderline ones.

Also check for **exact duplicate mesh references** — two different node
names pointing at literally the same mesh index:

```python
mesh_to_nodes = {}
for n in gltf['nodes']:
    if 'mesh' in n:
        mesh_to_nodes.setdefault(n['mesh'], []).append(n['name'])
dups = {mi: names for mi, names in mesh_to_nodes.items() if len(names) > 1}
```

If found, one file had exactly this (`back_door_left` and
`lower_body_left.001` were the same mesh) — the fix is to keep the
well-identified name and hide the other (`.visible = false`) in the
viewer's `onLoaded()`, not to select both. The other file had none of
these — don't assume either way, check.

---

## 5. Render-verify every substantial candidate — this is the actual work

This is the phase that catches wrong names, and it cannot be shortcut.
Bounding boxes and face counts narrow the list; only rendering confirms
what a mesh actually is.

```python
def render_highlight(name, view_name, out_path, eps=0.5):
    hi = paint_world_mesh(name, PAINT_MATERIAL)
    normals = hi.vertex_normals  # push outward to avoid z-fighting with backdrop
    hi.vertices = hi.vertices + normals * eps
    hi.visual = trimesh.visual.ColorVisuals(hi, vertex_colors=[230,30,30,255])

    pr_scene = pyrender.Scene(bg_color=[25,25,25,255], ambient_light=[0.55,0.55,0.55])
    pr_scene.add(pyrender.Mesh.from_trimesh(backdrop_mesh, smooth=False))  # full body, grey
    pr_scene.add(pyrender.Mesh.from_trimesh(hi, smooth=False))
    pr_scene.add(pyrender.DirectionalLight(color=[1,1,1], intensity=3.5), pose=np.eye(4))
    cam = pyrender.PerspectiveCamera(yfov=np.radians(45))
    pr_scene.add(cam, pose=look_at(eye_for(view_name), center, up_for(view_name)))
    color, _ = renderer.render(pr_scene)
    Image.fromarray(color).save(out_path)
```

Pick the camera angle (`left`/`right`/`front`/`back`/`top`) based on which
side the candidate's center falls on, using the coordinate convention from
Phase 2.

Actually **view every rendered image** before deciding a name is correct.
Concrete failure modes hit in the two prior files, all only caught this way:

- A node plausibly named for a door was actually a **hidden interior
  panel** (only visible looking down through the glass from above) that
  spanned both sides of the vehicle — the real, correctly-shaped exterior
  door was hiding under a numbered duplicate-looking name (`X.001`) that
  looked, from its name alone, like a throwaway fragment.
- A node named like a specific door/panel had a bounding box spanning
  60–90% of the vehicle's total length or width — this pattern (a "big
  blob") meant it was actually a broad underlying body-shell or interior
  structural surface, not the specific part its name suggested.
- A node's raw bounding box was wildly larger than what actually rendered
  visibly (e.g. spanning nearly the full vehicle length for something that
  turned out to be a normal, well-formed single door) — caused by a
  handful of stray/degenerate outlier vertices skewing the box. **The
  render, not the bounding box, is the source of truth** once there's a
  conflict between the two.
- Small fragments (a few hundred faces) were, on render, confirmed either
  genuinely invisible from every exterior angle (safe to exclude) or a
  real, clearly-visible trim strip worth its own panel entry (e.g. a roof
  trailing-edge strip above a rear hatch) — face count alone did not
  reliably predict which.
- A material's own semantic label (e.g. a node effectively meaning "rear
  window") could be describing the *area* around a feature (the quarter
  panel surrounding a window) rather than the feature itself (the glass) —
  only visible by rendering.

For every "big blob" or ambiguous candidate, also check whether it might
represent **two adjacent things merged into one mesh** by looking at the
distribution of face centroids along the vehicle's length, not just the
overall min/max:

```python
centroids = mesh.triangles_center
xs = centroids[:, 0]
for p in [0, 5, 25, 50, 75, 95, 100]:
    print(p, np.percentile(xs, p))
# or a full histogram if the percentiles suggest two separate clusters
hist, edges = np.histogram(xs, bins=10)
```

A contiguous, narrow spread means one real panel (an inflated raw min/max
was just outliers). A genuinely bimodal spread — a dense cluster plus an
isolated, separated cluster far away — means the mesh actually contains
two unrelated chunks of geometry (e.g. a real door plus a small unrelated
hidden interior fragment merged into the same object by the export
pipeline). Isolate and render the smaller cluster on its own
(`mesh.faces[mask]` → new `trimesh.Trimesh`) to find out what it is before
deciding whether it changes your panel list.

**If a "sensible" panel name you'd expect (e.g. a mirrored counterpart of
one you've confirmed) genuinely doesn't exist anywhere in the candidate
list after this checking** — don't force-fit a stand-in. One file was
missing an entire exterior door surface on one side (confirmed absent, not
just unnamed, after checking every remaining candidate and every hidden
fragment near where it should have been). Document the gap; don't paper
over it with a mislabeled substitute.

---

## 6. Handle multi-primitive nodes

Check which meshes have more than one primitive:

```python
for m in gltf['meshes']:
    if len(m['primitives']) > 1:
        print(m.get('name'), len(m['primitives']))
```

A node whose mesh has multiple primitives (typically: paint surface +
chrome trim/handle baked into the same object) does **not** load into
Three.js as a single `Mesh`. `GLTFLoader` creates a `Group` (named after the
node) containing one child `Mesh` per primitive. This means:

- `modelRoot.getObjectByName(name)` returns a `Group`, not a `Mesh` — code
  that assumes `.geometry` exists on the result will throw or silently do
  nothing.
- The child meshes get **auto-generated names** derived from the
  mesh/primitive data, not the node name — don't try to hardcode or guess
  these; they're not stable/meaningful to hand-write.

The fix is a small resolver used uniformly for every panel (see Phase 10
for the full version), plus tagging the resolved mesh so picking logic
doesn't need to know about this distinction later:

```js
function resolvePaintMesh(root, name) {
  const obj = root.getObjectByName(name);
  if (!obj) return null;
  if (obj.isMesh) return obj;
  let found = null;
  obj.traverse((c) => {
    if (!found && c.isMesh && c.material && c.material.name === PAINT_MATERIAL_NAME) found = c;
  });
  return found;
}
```

---

## 7. Verify every chosen name against the REAL GLTFLoader

Do this **before** writing the final `PAINTABLE_NAMES` list into the HTML,
not after, and re-run it if the list changes. Reasoning about what
`GLTFLoader` "should" do is not a substitute — a subtle, easy-to-miss
behavior bit both prior files:

> **`GLTFLoader` sanitizes every node name.** It strips the characters
> `. [ ] : /` (`PropertyBinding.sanitizeNodeName`, since these are reserved
> for animation-path syntax) before assigning the object's `.name`. A glTF
> node literally named `front_door_left.001` loads into the Three.js scene
> as an object named `front_door_left001` — **no dot**. Any
> `PAINTABLE_NAMES` entry or `getObjectByName()` call using the *original*
> dotted glTF name will silently fail to find anything.

Verify with a real, minimal Node script (Python/trimesh has no opinion on
this — it's Three.js-specific behavior, so Python-side analysis alone
cannot catch it):

```js
// check.mjs
globalThis.self = globalThis; // GLTFLoader's texture path expects a Worker/Window global
import fs from 'fs';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const buf = fs.readFileSync('model.glb');
const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const PAINTABLE_NAMES = [ /* your candidate list, using sanitized names for anything with a dot */ ];

function resolvePaintMesh(root, name) { /* same as Phase 6 */ }

new GLTFLoader().parse(arrayBuffer, '', (gltf) => {
  const root = gltf.scene;
  for (const name of PAINTABLE_NAMES) {
    const mesh = resolvePaintMesh(root, name);
    console.log(name, '->', mesh ? `OK (${mesh.type}, hasGeom=${!!mesh.geometry})` : 'NOT FOUND');
  }
}, (e) => { console.error(e); process.exit(1); });
```

```bash
node check.mjs
```

Every entry must print `OK`. Anything else means either the name needs
sanitizing, or the Phase 4/5 identification was wrong.

If a duplicate-hide step from Phase 4 is needed, verify **that** name the
same way — it's exactly as susceptible to the sanitization gotcha as any
`PAINTABLE_NAMES` entry.

Also worth confirming here (cheap, same script): that every resolved paint
mesh is actually reachable via `root.traverse()` in the same object
identity that `getObjectByName`/`resolvePaintMesh` returned — this is what
the viewer's `pickable[]` list is built from, so a mismatch here means
clicks silently won't register even though the panel looks selectable.

---

## 8. Full coverage check

Render every chosen panel simultaneously, each a distinct flat color,
backdrop-free, from all 5 camera angles (front/back/left/right/top):

```python
palette = [[230,30,30],[30,180,60],[40,110,220], /* ... one per panel */]
for i, name in enumerate(FINAL_PANELS):
    m = paint_world_mesh(name, PAINT_MATERIAL)
    m.vertices += m.vertex_normals * small_eps
    m.visual = trimesh.visual.ColorVisuals(m, vertex_colors=palette[i % len(palette)] + [255])
    pr_scene.add(pyrender.Mesh.from_trimesh(m, smooth=False))
```

Look for:

- **Unexplained black gaps** on the visible body surface — either a real
  missing panel (document it, per Phase 5's last point) or a
  Phase-5-excluded fragment that turns out to be visible after all (go
  back and include it).
- **Large color-on-color overlaps** — didn't occur in either prior file,
  but if found, it means two chosen panels cover overlapping geometry and
  a raycast pick-priority tie-break is needed (not covered in this guide
  since it wasn't needed in practice — if you hit it, the old prior-model
  code base had a `LOW_PRIORITY_NAMES`-style mechanism worth reviving).
- Glass/window openings showing through as black are expected and fine —
  that's correctly-excluded non-paint material, not a gap.

---

## 9. Determine scale, then fix the camera math for it

**Never assume the new file uses the same unit scale as the last one.**
Compare the model's overall bounding-box extents to the real vehicle's
known real-world dimensions (roughly — length/height/width in meters) to
figure out whether the file is authored in meters, centimeters, or
something else. A factor-of-~100 mismatch between two prior files
(meters vs. centimeters) meant every hardcoded absolute scene constant
tuned for one was wrong by two orders of magnitude for the other — enough
to make the model invisible (camera far-plane clipping, fog fully opaque
before reaching the vehicle).

**Fix: make every scale-dependent scene constant proportional to the
model's own bounding-sphere radius, computed after load, not hardcoded.**
Create placeholders before the model loads, then set real values in
`onLoaded()`:

```js
// at scene setup time — placeholders only
scene.fog = new THREE.Fog(0xf5f6f7, 1, 2);
const camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.1, 10000);
const ground = new THREE.Mesh(new THREE.CircleGeometry(1, 64), groundMaterial);

// in onLoaded(), once the box/bsphereRadius are known:
scene.fog.near = bsphereRadius * 6;
scene.fog.far  = bsphereRadius * 14;
camera.near = Math.max(bsphereRadius * 0.01, 0.01);
camera.far  = bsphereRadius * 20;
camera.updateProjectionMatrix();
ground.geometry.dispose();
ground.geometry = new THREE.CircleGeometry(bsphereRadius * 3.2, 64);
ground.position.y = box.min.y - bsphereRadius * 0.005;
```

(Directional light *positions* do NOT need scaling — `THREE.DirectionalLight`
only uses position to derive a direction toward the origin; the magnitude
is irrelevant to a parallel-ray light. Leave those as-is.)

### The camera framing formula also has a real, separate bug — fix it too

The existing `fitDistance(horiz, vert, fov, aspect, padding)` helper computes
a camera distance by treating the vehicle as an infinitely thin flat plane
sitting exactly at the model's center. **This understates how close the
near face of the vehicle actually is** whenever the vehicle has significant
depth along the viewing axis relative to its cross-section — which is
mild and easy to miss for a boxy vehicle, but severe for a low, long one.
Caught by literally measuring rendered pixel coverage against the
theoretical prediction: an uncorrected front-view render nearly clipped
the frame (~95% width fill against a ~44% theoretical prediction) for a
long, low wagon, while the same formula looked fine for a boxier van.

**Fix:** add half the vehicle's extent along each view's own viewing axis
to the computed distance, so the near face — not the center — ends up at
the intended padded distance:

```js
function computePresets(box, aspect) {
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const { x: X, y: Y, z: Z } = size;
  const distFB  = fitDistance(Z, Y, FOV_DEG, aspect, CAMERA_PADDING) + X / 2;
  const distLR  = fitDistance(X, Y, FOV_DEG, aspect, CAMERA_PADDING) + Z / 2;
  const distTop = fitDistance(X, Z, FOV_DEG, aspect, CAMERA_PADDING) + Y / 2;
  // ...build the 5 preset positions from these, using the Phase-2 convention
}
```

Verify this — don't just trust the algebra — by rendering the actual
computed camera positions and measuring pixel coverage the same way the
bug was originally found:

```python
img = np.array(Image.open('preset_front.png').convert('L'))
mask = img > 60
rows = np.where(mask.any(axis=1))[0]; cols = np.where(mask.any(axis=0))[0]
print("height fill:", (rows.max()-rows.min())/img.shape[0])
print("width fill:", (cols.max()-cols.min())/img.shape[1])
```

Comfortable margins looked like roughly 55–75% height fill and well under
~50% width fill in the working versions — treat anything pushing past
~85–90% on either axis as too tight and re-check.

Finally, re-verify the bezier fly-between-presets transition apex still
clears the vehicle's bounding sphere for the new (larger) distances — the
apex height (`bsphereRadius * APEX_MULTIPLIER`) doesn't automatically scale
with the fitDistance fix, so check numerically:

```python
def min_clearance(p1, p2, apex, center, bsphere_radius, steps=400):
    worst = 1e9
    for t in np.linspace(0, 1, steps):
        inv = 1 - t
        p = inv*inv*np.array(p1) + 2*inv*t*np.array(apex) + t*t*np.array(p2)
        worst = min(worst, np.linalg.norm(p - center))
    return worst - bsphere_radius  # must stay positive for every preset pair
```

---

## 10. Assemble the HTML

Full feature set the viewer needs (verify each is present and working, not
just copy-pasted):

- **Loading screen** with a progress bar (`onProgress` callback from
  `loader.load`) and a distinct, actionable error state (`onError`) — the
  error message should reference the actual runtime filename
  (`location.pathname.split('/').pop()`), not a hardcoded guess, since the
  file will get renamed.
- **5 camera preset buttons** (front / back / left / right / top) with a
  smooth quadratic-bezier fly-between transition (arcing up through an
  apex point above the vehicle, not cutting straight through it) rather
  than an instant jump.
- **Hover highlight**: on `pointermove` (throttled — see below), raycast
  against the pickable list, resolve to a logical panel name via
  `userData.paintPanel` (Phase 6), and fade in a low-opacity highlight
  overlay on the hovered panel if it isn't already selected.
- **Click to select/deselect**: same resolution path, toggles a
  `selected` boolean per panel and updates the overlay opacity to a
  stronger, persistent value.
- **Highlighting is done via a separate overlay mesh, not by mutating the
  panel's own material.** For every paintable panel: build a
  `THREE.BufferGeometry` that reuses the resolved mesh's own `position`
  (and `index`, if present) attributes, give it a transparent
  `MeshBasicMaterial` with `depthWrite: false` and `polygonOffset` set
  (`polygonOffsetFactor`/`Units` around `-4`) so it renders cleanly on top
  of the coincident surface without z-fighting, set `overlay.raycast = ()
  => {}` so the overlay itself can never intercept a pick, and
  `mesh.add(overlay)` so it inherits the mesh's transform automatically.
- **Build the raycast `pickable[]` list from the original meshes only,
  before adding any overlay children** — otherwise overlays end up in the
  pickable list too.
- **Selection list panel** in the UI: enumerate `PAINTABLE_NAMES`, show
  only the ones currently selected with their friendly display name (a
  separate `FRIENDLY_NAMES` map — see Phases 4–5 for how those names were
  derived), each with a remove button that clears selection + updates the
  overlay.
- **Material color correction**: on load, walk every material once
  (dedup via a `Set`, since many meshes share the same material instance)
  and override the paint material's `color` to a proper light/near-white
  RGB (Phase 3 established the source is a dull grey) and cap its
  roughness for a glossier look. Leave `clearcoat`/`clearcoatRoughness`
  alone if the extension check in Phase 1 found `KHR_materials_clearcoat`
  — `GLTFLoader` already resolved those correctly.
- **Vertex normals**: check (Phase 1 style) whether the file's primitives
  actually ship a `NORMAL` accessor. If they do, only compute normals
  defensively for any mesh that's missing them
  (`if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();`)
  — don't unconditionally overwrite authored normals.
- **Responsive resize**: recompute the bounding box and presets on
  window resize (aspect ratio changes what `fitDistance` needs), and
  re-snap the camera to the current preset rather than leaving it at a
  now-stale position.
- **Hover raycast throttling**: cheap insurance against raycast cost on a
  large scene — a `HOVER_THROTTLE_MS` (~50ms) minimum gap between raycasts
  on `pointermove` is enough; note the actual total triangle count in a
  comment (pulled directly from summing `accessors[...].count / 3` across
  every primitive) rather than asserting a number you haven't checked for
  this specific file.

Values to fill in for the new file specifically: `GLB_URL`, the page
`<title>`/branding text (use the vehicle's real make/model if it's
identifiable from the source hierarchy — e.g. a Sketchfab-style parent
node name — otherwise use a generic descriptor rather than guessing a
specific make/model), the loading card's file-size text (check the actual
`.glb` size on disk), `PAINTABLE_NAMES`/`FRIENDLY_NAMES`, the coordinate
convention comment and direction vectors in `computePresets`, and the
`PAINT_MATERIAL_NAME` used throughout.

---

## 11. Pre-ship checklist

- [ ] `node --check` on the extracted `<script type="module">` contents —
      catches syntax errors before they reach a browser.
- [ ] Every `PAINTABLE_NAMES` entry (and any hide-duplicate name) verified
      against the real `GLTFLoader` per Phase 7, re-run after any list
      change.
- [ ] Coverage check (Phase 8) re-rendered if the panel list changed after
      it was first run.
- [ ] Camera preset renders (Phase 9) checked by actual pixel-coverage
      measurement, not just "looks about right."
- [ ] Transition apex clearance re-verified numerically for the final
      distances.
- [ ] Grep the finished HTML for leftover references to the previous
      model — old part names, old material name, old title/branding, old
      file size text, any literal old `.glb` filename:

  ```bash
  grep -niE "suzuki|eeco|mazda|white_body|carpaint|van\.glb|wagon\.glb" new-file.html
  ```

  (swap in whatever the *previous* file's identifiers were — the point is
  confirming none of them survived the copy/edit pass).
- [ ] Any genuine gap in panel coverage (Phase 5's last point) is
      documented for whoever receives the file — don't ship a silent gap.

---

## Summary of the recurring failure pattern

Every real bug caught in this whole process had the same shape: **trusting
something without checking it against the actual data or the actual
runtime behavior.** A node's name, a bounding box's min/max, a formula
that worked on the last file, an assumption about how a loader library
behaves — every one of these was wrong at least once, in ways that were
only obvious after rendering, measuring, or running the real loader. There
isn't a shortcut around Phases 5, 7, and 9's verification steps; they're
where the actual correctness of the final file comes from.†
