/* =========================================================================
   carVisual.js — 3D panel-picker for step 3 of the Autocolor wizard

   One viewer, three vehicles. The camera rig, picking and overlays here are
   the ones built and hardened in the three standalone pages under
   imgs/assets/3d-visuals/ (button-only camera, front initial view,
   gimbal-lock-safe orientation), with the flights reworked into continuous
   arcs around the car — see flyToView. What those pages each hardcoded for
   their own model — the
   GLB, its paintable node names, its paint material and its axis
   convention — lives in VEHICLE_MODELS below instead, so the same viewer
   drives the furgoneta, the familiar and the SUV.

     - It owns NO selection state of its own. Every click asks the host
       page (via `onPartToggle`) to mutate its shared `state.parts`, and
       queries the host page (via `isPartSelected`) to decide how to draw
       the selected/hover overlays. This keeps repair.js's `state.parts`
       array as the single source of truth.
     - It exposes a small controller API (resize / refreshSelection /
       resetView / destroy) instead of wiring its own buttons + sidebar,
       since those now live in repair.html/repair.js so they can match the
       site's own styling.

   Import this lazily (`import('../src/carVisual.js')`) — only when a user
   actually reaches step 3 — so nobody pays for three.js or a 26–91 MB
   model download before then. Exactly one viewer is alive at a time:
   picking a different vehicle destroys the previous one (see destroy()
   here and ensureCar3D() in repair.js), since three resident models of
   this size are not free to keep on the GPU.
   ========================================================================= */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// Los tres GLB van comprimidos con EXT_meshopt_compression. El decodificador
// es un módulo ES de unos 25 KB que resuelve por el mismo importmap que three
// (ver pgs/repair.html), así que no hay una segunda versión que mantener.
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/* -------------------------------------------------------------------------
   Per-vehicle model configuration

   Every field below was checked against the GLB files themselves (node
   names, primitive counts and material assignments read out of each file's
   glTF JSON; axis conventions derived from where the hood/bumper/fender
   nodes actually sit in world space) — not taken on trust from the node
   names, which are misleading in several places on all three models.

   `front` / `left` are unit axes in the model's own space: `front` points
   out of the vehicle's nose, `left` out of its driver-side flank. They
   differ per model because the three GLBs come from different sources with
   different export conventions; all three are Y-up.

   `parts` are the GLB node names of the panels a customer can select. They
   are the ids stored in repair.js's `state.parts`, and their Spanish labels
   live in that file's PART_LABELS.
------------------------------------------------------------------------- */
export const VEHICLE_MODELS = {
  // Furgoneta. Its node names are NOT literal: 'back_door_left/right' are
  // the sliding cargo doors, 'rear_window_left/right' are the painted rear
  // quarter panels (not glass), and 'quarter_panel_left/right' are the
  // lower rear wheel-arch area below them. Bumpers use a separate plastic
  // material here, so they are not paintable panels on this vehicle.
  van: {
    url: new URL('../imgs/assets/3d-visuals/van/van.glb', import.meta.url).href,
    paintMaterial: 'White_Body',
    front: [-1, 0, 0],
    left: [0, 0, 1],
    // "White_Body" is authored as a mid-grey primer (baseColorFactor ~0.325
    // grey), so it is brightened at runtime to read as a real body colour
    // under the selection overlays.
    bodyColor: [0.93, 0.93, 0.94],
    maxRoughness: 0.3,
    parts: [
      'hood', 'roof',
      'front_door_left', 'front_door_right',
      'back_door_left', 'back_door_right',
      'left_fender', 'right_fender',
      'rear_window_left', 'rear_window_right',
      'quarter_panel_left', 'quarter_panel_right',
      'side_skirt_left', 'side_skirt_right',
      'rear_hatch',
    ],
    // 'back_door_left' and 'lower_body_left.001' are two nodes pointing at
    // the exact same mesh data (same glTF position accessor). Drawing both
    // paints the same triangles twice for no benefit and gives the raycast
    // a second, unlabelled hit surface, so the redundant one is hidden.
    // GLTFLoader strips '.' from node names (PropertyBinding.sanitizeNodeName
    // reserves it as an animation-path separator), hence 'lower_body_left001'.
    hiddenNodes: ['lower_body_left001'],
  },

  // Familiar (station wagon). Sketchfab-sourced, so its units are
  // centimetres — ~476 long against the SUV's ~5 — which is why every
  // camera distance and clipping plane in this file is derived from the
  // model's own bounding box rather than hardcoded.
  wagon: {
    url: new URL('../imgs/assets/3d-visuals/station-wagon/wagon.glb', import.meta.url).href,
    paintMaterial: 'carpaint',
    front: [1, 0, 0],
    left: [0, 0, -1],
    // Same story as the van: "carpaint" is authored as ~0.446 grey primer.
    // The material also carries KHR_materials_clearcoat, which GLTFLoader
    // resolves into MeshPhysicalMaterial.clearcoat on its own — left alone.
    bodyColor: [0.93, 0.93, 0.94],
    maxRoughness: 0.3,
    parts: [
      'hood', 'roof',
      // The plainly-named 'front_door_left' is a hidden interior panel
      // spanning both sides; the real exterior door is this '.001' node
      // (dot stripped by GLTFLoader, as above).
      'front_door_left001',
      'rear_door_left', 'rear_door_right',
      'fender_left', 'fender_right',
      'quarter_panel_left', 'quarter_panel_right',
      'side_skirt_left', 'side_skirt_right',
      'rear_hatch',
      // Unlike the van, this model's bumpers really do use the body-paint
      // material, so they are selectable panels here.
      'bumper', 'back_bumper',
      // Undescriptive name, but a real visible trim strip along the roof's
      // trailing edge above the hatch glass — listed so it isn't a hole in
      // the paintable surface.
      'Object_26',
    ],
    // NOTE: this GLB simply has no exterior front-RIGHT door surface — every
    // candidate mesh on that side is interior geometry, invisible from any
    // exterior angle. That panel therefore cannot be offered on this
    // vehicle until the model itself is fixed.
    hiddenNodes: [],
  },

  // Pickup (Hilux double cab). Its bed is one 'tonneau' panel, and its only
  // fenders are the front pair. It stands in for the SUVs too: de las tres
  // siluetas es la única con esa altura y ese volumen.
  pickup: {
    url: new URL('../imgs/assets/3d-visuals/pickup/pickup.glb', import.meta.url).href,
    paintMaterial: 'carpaint',
    front: [0, 0, 1],
    left: [1, 0, 0],
    bodyColor: [0.82, 0.83, 0.86],
    maxRoughness: 0.3,
    minMetalness: 0.25,
    parts: [
      'hood', 'roof', 'front_bumper',
      'front_door_left', 'front_door_right',
      'rear_door_left', 'rear_door_right',
      'fender_left', 'fender_right',
      'tonneau',
    ],
    hiddenNodes: [],
  },
};

const UP_AXIS = new THREE.Vector3(0, 1, 0);

const FOV_DEG = 45;
const CAMERA_PADDING = 1.2;

const HOVER_COLOR = 0x299fdf;   // --accent-strong, "preview" cue
const HOVER_OPACITY = 0.35;
const SELECTED_COLOR = 0xe5352b; // --paint-red — mirrors the 2D flow's is-selected fill
const SELECTED_OPACITY = 0.55;
const HOVER_THROTTLE_MS = 50;
// Flights are timed by how far the camera actually travels around the car,
// so a quarter turn and a full sweep over the roof move at the same pace.
const MS_PER_QUARTER_TURN = 620;
const MIN_FLIGHT_MS = 420;
const MAX_FLIGHT_MS = 1150;

// Extent of a bounding-box size along one of the model's own axes. Every
// axis in VEHICLE_MODELS is an axis-aligned unit vector, so picking the
// matching component out of `size` is exact.
function extentAlong(axis, size) {
  return Math.abs(axis.x) * size.x + Math.abs(axis.y) * size.y + Math.abs(axis.z) * size.z;
}

export function mountCar3D(options) {
  const {
    vehicle,         // key into VEHICLE_MODELS
    canvasEl,
    canvasWrapEl,
    overlayEl,
    progressBarEl,
    loadingLabelEl,
    errorEl,
    buttonsEl,       // container holding buttons with [data-view]
    isPartSelected,  // fn(id) => bool — reads the host's shared state
    onPartToggle,    // fn(id) => void — mutates the host's shared state
  } = options;

  const model = VEHICLE_MODELS[vehicle];
  if (!model) throw new Error('[car3d] Unknown vehicle: ' + vehicle);

  const FRONT_AXIS = new THREE.Vector3().fromArray(model.front);
  const LEFT_AXIS = new THREE.Vector3().fromArray(model.left);

  const scene = new THREE.Scene();
  // No scene.background: the canvas stays transparent so the car appears
  // to float directly on the page background instead of sitting in a box.

  // near/far are placeholders until the model's own size is known — see the
  // load handler, which resets both from its bounding sphere. They have to
  // be model-relative because the three GLBs differ by ~100x in scale.
  const camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.05, 500);
  camera.position.set(6, 3, 8);

  const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  // No OrbitControls: the camera is driven entirely by the view-preset
  // buttons (see flyToView below). Nothing here responds to drag/scroll/touch.

  // Directional lights carry a direction, not a position, so this rig needs
  // no scaling to suit a model authored in centimetres.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8672, 0.95));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
  keyLight.position.set(5, 8, 6);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0xffffff, 1.1);
  rimLight.position.set(-6, 4, -7);
  scene.add(rimLight);

  // Set by destroy(). The GLB fetch can't be aborted (GLTFLoader exposes no
  // cancel), so every loader callback checks this before touching anything:
  // a switch to another vehicle mid-download must not have the outgoing
  // viewer write to the incoming one's shared loading UI.
  let destroyed = false;

  function resizeRenderer() {
    const w = canvasWrapEl.clientWidth;
    const h = canvasWrapEl.clientHeight;
    if (!w || !h) return; // container is hidden/zero-sized — nothing to size yet
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resizeRenderer();

  // Returns the actual Mesh to paint for a node name, handling both plain
  // single-primitive nodes (already a Mesh) and multi-primitive ones, which
  // GLTFLoader turns into a Group of child meshes — a door node that bundles
  // its chrome window trim, for example. The paint-material child is the one
  // wanted in that case.
  function resolvePaintMesh(root, name) {
    const obj = root.getObjectByName(name);
    if (!obj) return null;
    if (obj.isMesh) return obj;
    let found = null;
    obj.traverse((child) => {
      if (!found && child.isMesh && child.material && child.material.name === model.paintMaterial) {
        found = child;
      }
    });
    return found;
  }

  function makeOverlay(mesh, color, opacity) {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const overlayMesh = new THREE.Mesh(mesh.geometry, mat);
    overlayMesh.visible = false;
    overlayMesh.renderOrder = 999;
    overlayMesh.raycast = () => {}; // overlays must never themselves be pickable
    mesh.add(overlayMesh); // parenting inherits the mesh's exact world transform
    return overlayMesh;
  }

  function fitDistance(horiz, vert, fovDeg, aspect, padding) {
    const fov = THREE.MathUtils.degToRad(fovDeg);
    const dVert = (vert / 2) / Math.tan(fov / 2);
    const dHoriz = (horiz / 2) / (Math.tan(fov / 2) * aspect);
    return Math.max(dVert, dHoriz) * padding;
  }

  let center = new THREE.Vector3();
  // Model extents measured along the vehicle's own axes rather than along
  // world X/Y/Z, so the camera math below reads the same for all three
  // models however each one happens to be oriented in its file.
  let lengthFB = 0, widthLR = 0, heightUD = 0;
  let presets = {};
  let introPos = new THREE.Vector3();

  // Interpolates a unit direction along the great circle between two others.
  // Callers never pass a pair further apart than a quarter turn or so — any
  // wider turn is split at the roof first — so the antipodal case, where the
  // arc would be ambiguous, cannot arise here; the guard covers exact
  // coincidence only.
  function slerpDirection(from, to, t, out) {
    const theta = Math.acos(THREE.MathUtils.clamp(from.dot(to), -1, 1));
    const sinTheta = Math.sin(theta);
    if (sinTheta < 1e-6) return out.copy(to);
    return out.copy(from)
      .multiplyScalar(Math.sin((1 - t) * theta) / sinTheta)
      .addScaledVector(to, Math.sin(t * theta) / sinTheta);
  }

  // Up vector for a camera looking along `forward`: world-up for the
  // horizontal views, the car's own front axis once the view is steep enough
  // that world-up stops being meaningful (it is parallel to the view
  // direction straight down, and that degeneracy is what makes a camera
  // visibly flip), and a smooth blend in between. At either extreme it
  // returns exactly the convention the static views use.
  function upHintFor(forward) {
    const projUp = UP_AXIS.clone().addScaledVector(forward, -forward.dot(UP_AXIS));
    const projFront = FRONT_AXIS.clone().addScaledVector(forward, -forward.dot(FRONT_AXIS));
    if (projUp.lengthSq() < 1e-10) return projFront.normalize();
    if (projFront.lengthSq() < 1e-10) return projUp.normalize();
    const blend = THREE.MathUtils.smoothstep(Math.abs(forward.dot(UP_AXIS)), 0.6, 0.97);
    return projUp.normalize().lerp(projFront.normalize(), blend).normalize();
  }

  // Positions the camera and points it at the car in one step, so every
  // frame of a flight is framed exactly the way its destination will be.
  const forwardTmp = new THREE.Vector3();
  function placeCamera(position) {
    forwardTmp.copy(center).sub(position).normalize();
    camera.up.copy(upHintFor(forwardTmp));
    camera.position.copy(position);
    camera.lookAt(center);
  }

  function computePresets() {
    const aspect = camera.aspect;
    // Each view frames the two extents across the screen and then backs off
    // by half the extent along its own viewing axis, so the padding ratio
    // holds at the vehicle's nearest surface, not just at its centre.
    const distFB  = fitDistance(widthLR, heightUD, FOV_DEG, aspect, CAMERA_PADDING) + lengthFB / 2;
    const distLR  = fitDistance(lengthFB, heightUD, FOV_DEG, aspect, CAMERA_PADDING) + widthLR / 2;
    const distTop = fitDistance(widthLR, lengthFB, FOV_DEG, aspect, CAMERA_PADDING) + heightUD / 2;

    presets = {
      front: center.clone().addScaledVector(FRONT_AXIS, distFB),
      back:  center.clone().addScaledVector(FRONT_AXIS, -distFB),
      left:  center.clone().addScaledVector(LEFT_AXIS, distLR),
      right: center.clone().addScaledVector(LEFT_AXIS, -distLR),
      top:   center.clone().addScaledVector(UP_AXIS, distTop),
    };

    const introDist = Math.max(distFB, distLR) * 1.05;
    introPos = center.clone().addScaledVector(
      LEFT_AXIS.clone().multiplyScalar(0.55)
        .addScaledVector(UP_AXIS, 0.42)
        .addScaledVector(FRONT_AXIS, 0.72)
        .normalize(),
      introDist
    );
  }

  /* -----------------------------------------------------------------------
     Camera flights

     The camera orbits: it follows a great-circle arc around the car at a
     radius eased from the one view's framing distance to the other's, and
     is re-aimed at the car every frame. So the car never leaves the middle
     of the frame, the motion has no corner in it, and every flight lands on
     exactly the framing the destination button would give on its own.
  ----------------------------------------------------------------------- */
  let flying = false;
  let flightId = 0;
  let currentView = 'front';

  const viewButtons = buttonsEl ? Array.prototype.slice.call(buttonsEl.querySelectorAll('[data-view]')) : [];
  function syncViewButtons() {
    viewButtons.forEach((btn) => {
      const active = btn.dataset.view === currentView;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  // Sine easing: it leaves and arrives with zero speed like the quad it
  // replaces, but without the abrupt change in acceleration at the halfway
  // point, which is what a slow orbit shows up most.
  function easeInOutSine(t) {
    return -(Math.cos(Math.PI * t) - 1) / 2;
  }

  function positionForView(view) {
    return view === 'intro' ? introPos : presets[view];
  }

  function prefersReducedMotion() {
    return typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  const flightDir = new THREE.Vector3();
  const flightPos = new THREE.Vector3();

  function flyToView(view) {
    if (destroyed || view === currentView) return;
    const target = positionForView(view);
    if (!target) return;

    // Claiming the view (and the button state) up front is what lets a
    // flight be redirected in mid-air: a second click supersedes this one
    // from wherever the camera has got to, instead of being swallowed
    // while the first flight plays out.
    const id = ++flightId;
    currentView = view;
    syncViewButtons();

    const fromDir = camera.position.clone().sub(center);
    const fromRadius = fromDir.length() || 1;
    fromDir.divideScalar(fromRadius);
    const toDir = target.clone().sub(center);
    const toRadius = toDir.length() || 1;
    toDir.divideScalar(toRadius);

    // Opposite views (front/back, left/right) have no one arc between them:
    // every great circle through both is equally valid and a straight line
    // would pass through the car. Only those turns are routed over the roof
    // — everything else sweeps directly, which is shorter and easier to
    // follow than relaying every turn through the top view.
    const waypoints = fromDir.dot(toDir) < -0.9
      ? [fromDir, UP_AXIS.clone(), toDir]
      : [fromDir, toDir];

    const angles = [];
    let totalAngle = 0;
    for (let i = 0; i < waypoints.length - 1; i++) {
      const angle = Math.acos(THREE.MathUtils.clamp(waypoints[i].dot(waypoints[i + 1]), -1, 1));
      angles.push(angle);
      totalAngle += angle;
    }

    if (totalAngle < 1e-4 || prefersReducedMotion()) {
      placeCamera(target);
      flying = false;
      return;
    }

    const duration = THREE.MathUtils.clamp(
      MS_PER_QUARTER_TURN * (totalAngle / (Math.PI / 2)), MIN_FLIGHT_MS, MAX_FLIGHT_MS);
    const startTime = performance.now();
    flying = true;

    function step(now) {
      if (destroyed || id !== flightId) return; // superseded by a newer flight
      const t = Math.min(1, (now - startTime) / duration);
      const eased = easeInOutSine(t);

      // Walk the waypoints by angle travelled rather than by leg, so a
      // routed turn keeps one continuous rate the whole way round instead
      // of easing into and out of the roof.
      let travelled = eased * totalAngle;
      let leg = 0;
      while (leg < angles.length - 1 && travelled > angles[leg]) {
        travelled -= angles[leg];
        leg++;
      }
      slerpDirection(waypoints[leg], waypoints[leg + 1],
        angles[leg] > 1e-6 ? travelled / angles[leg] : 1, flightDir);
      flightPos.copy(center).addScaledVector(flightDir,
        THREE.MathUtils.lerp(fromRadius, toRadius, eased));
      placeCamera(flightPos);

      if (t < 1) requestAnimationFrame(step);
      else {
        placeCamera(target); // land on the preset exactly, not on the last lerp
        flying = false;
      }
    }
    requestAnimationFrame(step);
  }

  // Kept so destroy() can unbind them: the buttons outlive this viewer (they
  // are the host page's, reused by whichever vehicle is mounted next), and a
  // dead viewer must not keep re-styling them from its own stale state.
  const viewButtonBindings = viewButtons.map((btn) => {
    const handler = () => flyToView(btn.dataset.view);
    btn.addEventListener('click', handler);
    return { btn, handler };
  });

  /* -----------------------------------------------------------------------
     Loading
  ----------------------------------------------------------------------- */
  function formatBytes(n) {
    if (n > 1e6) return (n / 1e6).toFixed(1) + ' MB';
    if (n > 1e3) return (n / 1e3).toFixed(0) + ' KB';
    return n + ' B';
  }

  function showError(message) {
    if (!errorEl) return;
    if (overlayEl) overlayEl.classList.remove('hidden');
    if (progressBarEl && progressBarEl.parentElement) progressBarEl.parentElement.style.display = 'none';
    if (loadingLabelEl) loadingLabelEl.hidden = true;
    errorEl.hidden = false;
    errorEl.textContent = message;
  }

  const pickable = [];
  const overlayFor = new Map(); // mesh -> { hoverOverlay, selectedOverlay, id }
  let hoveredMesh = null;

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.load(
    model.url,
    (gltf) => {
      if (destroyed) return;
      const root = gltf.scene;
      scene.add(root);

      for (const name of model.hiddenNodes) {
        const stray = root.getObjectByName(name);
        if (stray) stray.visible = false;
      }

      root.updateMatrixWorld(true);

      const box = new THREE.Box3().setFromObject(root);
      box.getCenter(center);
      const size = box.getSize(new THREE.Vector3());
      lengthFB = extentAlong(FRONT_AXIS, size);
      widthLR = extentAlong(LEFT_AXIS, size);
      heightUD = extentAlong(UP_AXIS, size);

      // Clipping planes from the model's own bounding sphere. The wagon is
      // authored in centimetres and is ~475 units long, so the fixed planes
      // that suited the SUV would clip it away entirely.
      const radius = size.length() / 2;
      camera.near = Math.max(radius * 0.01, 0.01);
      camera.far = radius * 20;
      camera.updateProjectionMatrix();

      // Every model's paint material is authored as a dull primer grey with
      // no colour texture, so it's overridden at runtime. Walk every material
      // once (dedup via a Set) so a shared material is corrected exactly once.
      const paintMaterials = new Set();
      root.traverse((obj) => {
        if (obj.isMesh && obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const mat of mats) {
            if (mat && mat.name === model.paintMaterial) paintMaterials.add(mat);
          }
        }
        if (obj.isMesh && obj.geometry && !obj.geometry.attributes.normal) {
          obj.geometry.computeVertexNormals();
        }
      });
      for (const mat of paintMaterials) {
        mat.color.setRGB(model.bodyColor[0], model.bodyColor[1], model.bodyColor[2]);
        if (typeof model.maxRoughness === 'number') {
          mat.roughness = Math.min(mat.roughness ?? model.maxRoughness, model.maxRoughness);
        }
        if (typeof model.minMetalness === 'number') {
          mat.metalness = Math.max(mat.metalness ?? 0, model.minMetalness);
        }
        mat.needsUpdate = true;
      }

      // Collect raycast targets from the ORIGINAL meshes only, before any
      // overlay is attached, so overlays can never be picked and occlusion
      // (wheels, mirrors, glass, trim) still works for hover and click.
      root.traverse((obj) => { if (obj.isMesh && obj.visible) pickable.push(obj); });

      for (const id of model.parts) {
        const mesh = resolvePaintMesh(root, id);
        if (!mesh) {
          console.warn('[car3d] Could not resolve paintable panel:', vehicle, id);
          continue;
        }
        const hoverOverlay = makeOverlay(mesh, HOVER_COLOR, HOVER_OPACITY);
        const selectedOverlay = makeOverlay(mesh, SELECTED_COLOR, SELECTED_OPACITY);
        overlayFor.set(mesh, { hoverOverlay, selectedOverlay, id });
        selectedOverlay.visible = isPartSelected(id);
      }

      computePresets();
      placeCamera(presets.front);
      currentView = 'front';
      syncViewButtons();

      if (overlayEl) overlayEl.classList.add('hidden');
    },
    (xhr) => {
      if (destroyed || !loadingLabelEl) return;
      if (xhr.total) {
        const pct = Math.min(100, Math.round((xhr.loaded / xhr.total) * 100));
        if (progressBarEl) progressBarEl.style.width = pct + '%';
        loadingLabelEl.textContent = `Cargando modelo 3D… ${pct}%`;
      } else {
        loadingLabelEl.textContent = `Cargando modelo 3D… ${formatBytes(xhr.loaded)}`;
      }
    },
    (err) => {
      if (destroyed) return;
      console.error('[car3d] GLTFLoader error:', err);
      showError('No se pudo cargar el visor 3D. Verifica tu conexión e inténtalo nuevamente.');
    }
  );

  /* -----------------------------------------------------------------------
     Pointer interaction: hover (throttled) + click-to-toggle. Selection
     state itself always comes from/goes through the host page.
  ----------------------------------------------------------------------- */
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function setPointerFromEvent(event) {
    const rect = canvasEl.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function closestPick(event) {
    setPointerFromEvent(event);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickable, false);
    return hits.length ? hits[0] : null;
  }

  let lastHoverTime = 0;
  function onPointerMove(event) {
    if (pickable.length === 0) return;
    const now = performance.now();
    if (now - lastHoverTime < HOVER_THROTTLE_MS) return;
    lastHoverTime = now;

    const hit = closestPick(event);
    const newHovered = (hit && overlayFor.has(hit.object)) ? hit.object : null;

    if (newHovered !== hoveredMesh) {
      if (hoveredMesh) {
        const info = overlayFor.get(hoveredMesh);
        if (!isPartSelected(info.id)) info.hoverOverlay.visible = false;
      }
      if (newHovered) {
        const info = overlayFor.get(newHovered);
        if (!isPartSelected(info.id)) info.hoverOverlay.visible = true;
      }
      hoveredMesh = newHovered;
      canvasEl.classList.toggle('hoverable', !!newHovered);
    }
  }

  function onPointerClick(event) {
    if (pickable.length === 0) return;
    const hit = closestPick(event);
    if (!hit || !overlayFor.has(hit.object)) return;
    const mesh = hit.object;
    const info = overlayFor.get(mesh);

    onPartToggle(info.id);

    const nowSelected = isPartSelected(info.id);
    info.selectedOverlay.visible = nowSelected;
    info.hoverOverlay.visible = !nowSelected && mesh === hoveredMesh;
  }

  canvasEl.addEventListener('pointermove', onPointerMove);
  canvasEl.addEventListener('click', onPointerClick);

  /* -----------------------------------------------------------------------
     Render loop
  ----------------------------------------------------------------------- */
  let rafId = null;
  function animate() {
    rafId = requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }
  animate();

  function onWindowResize() {
    resizeRenderer();
    if (!(lengthFB || widthLR || heightUD)) return;
    // Framing distance depends on the aspect ratio, so the current view has
    // to be re-placed at the recomputed distance — otherwise the car stays
    // framed for the old container size until the next button press.
    computePresets();
    const here = positionForView(currentView);
    if (here && !flying) placeCamera(here);
  }
  window.addEventListener('resize', onWindowResize);

  /* -----------------------------------------------------------------------
     Controller returned to the host page
  ----------------------------------------------------------------------- */
  return {
    vehicle,
    // Call after un-hiding the container — its dimensions are 0 while
    // hidden, so sizing (and the framing that depends on it) has to happen
    // once it's actually visible again.
    resize() {
      onWindowResize();
    },
    // Call after state.parts changes from *outside* a canvas click (e.g.
    // the resume list's remove button, or a "clear all" action) so every
    // panel's overlay reflects the current selection.
    refreshSelection() {
      overlayFor.forEach((info, mesh) => {
        const sel = isPartSelected(info.id);
        info.selectedOverlay.visible = sel;
        info.hoverOverlay.visible = !sel && mesh === hoveredMesh;
      });
    },
    resetView() {
      flyToView('front');
    },
    // Called when the customer picks a different vehicle: this viewer's
    // model can weigh tens of MB on the GPU, so everything it allocated is
    // released rather than left for the collector. The canvas is single-use
    // afterwards (its WebGL context is deliberately dropped) — repair.js
    // swaps in a fresh one before mounting the next vehicle.
    destroy() {
      destroyed = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onWindowResize);
      canvasEl.removeEventListener('pointermove', onPointerMove);
      canvasEl.removeEventListener('click', onPointerClick);
      viewButtonBindings.forEach(({ btn, handler }) => btn.removeEventListener('click', handler));

      scene.traverse((obj) => {
        if (!obj.isMesh) return;
        // Overlays share their panel's geometry, so a geometry can be
        // disposed twice here; three treats the second call as a no-op.
        if (obj.geometry) obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of mats) {
          if (!mat) continue;
          for (const key of Object.keys(mat)) {
            const value = mat[key];
            if (value && value.isTexture) value.dispose();
          }
          mat.dispose();
        }
      });
      scene.clear();
      pickable.length = 0;
      overlayFor.clear();

      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
