/* =========================================================================
   car3d.js — 3D panel-picker for step 3 of the Autocolor wizard (SUV only)

   This is the same viewer built and hardened in suv-3d.html (button-only
   camera, front initial view, top-relayed turns, gimbal-lock-safe
   orientation via precomputed quaternions), adapted to run as a widget
   inside repair.html instead of a standalone page:

     - It owns NO selection state of its own. Every click asks the host
       page (via `onPartToggle`) to mutate its shared `state.parts`, and
       queries the host page (via `isPartSelected`) to decide how to draw
       the selected/hover overlays. This keeps repair.js's `state.parts`
       array as the single source of truth, shared with the 2D flow.
     - It exposes a small controller API (resize / refreshSelection /
       resetView / destroy) instead of wiring its own buttons + sidebar,
       since those now live in repair.html/repair.js so they can sit next
       to the 2D flow's markup and match the site's own styling.

   Import this lazily (`import('../src/car3d.js')`) — only when a user
   actually reaches step 3 with "suv" selected — so van/wagon users never
   pay for three.js or the model download.
   ========================================================================= */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const PAINT_MATERIAL_NAME = 'carpaint';

// Node names confirmed (by rendering, not by trusting the name) to be real,
// visible, individually-clickable body panels on the Hilux model. Labels
// for these ids live in repair.js's PART_LABELS, shared with the 2D flow.
const PAINTABLE_NAMES = [
  'hood', 'roof', 'front_bumper',
  'front_door_left', 'front_door_right',
  'rear_door_left', 'rear_door_right',
  'fender_left', 'fender_right',
  'tonneau',
];

// Coordinate convention for this model: +Z = front, -Z = back, X = lateral,
// Y = up. Facing +Z with up +Y, cross(forward, up) = -X, so -X = the
// vehicle's own right side and +X = its left side.
const FRONT_AXIS = new THREE.Vector3(0, 0, 1);
const UP_AXIS = new THREE.Vector3(0, 1, 0);
const LEFT_AXIS = new THREE.Vector3(1, 0, 0);

const FOV_DEG = 45;
const CAMERA_PADDING = 1.2;

const HOVER_COLOR = 0x299fdf;   // --accent-strong, "preview" cue
const HOVER_OPACITY = 0.35;
const SELECTED_COLOR = 0xe5352b; // --paint-red — mirrors the 2D flow's is-selected fill
const SELECTED_OPACITY = 0.55;
const HOVER_THROTTLE_MS = 50;
const LEG_DURATION_MS = 650; // duration of one flight leg; a routed path (via top) chains two

export function mountCar3D(options) {
  const {
    canvasEl,
    canvasWrapEl,
    overlayEl,
    progressBarEl,
    loadingLabelEl,
    errorEl,
    buttonsEl,       // container holding buttons with [data-view]
    modelUrl,
    isPartSelected,  // fn(id) => bool — reads the host's shared state
    onPartToggle,    // fn(id) => void — mutates the host's shared state
  } = options;

  const scene = new THREE.Scene();
  // No scene.background: the canvas stays transparent so the car appears
  // to float directly on the page background instead of sitting in a box.

  const camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.05, 500);
  camera.position.set(6, 3, 8);

  const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  // No OrbitControls: the camera is driven entirely by the view-preset
  // buttons (see flyToView below). Nothing here responds to drag/scroll/touch.

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8672, 0.95));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
  keyLight.position.set(5, 8, 6);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0xffffff, 1.1);
  rimLight.position.set(-6, 4, -7);
  scene.add(rimLight);

  function resizeRenderer() {
    const w = canvasWrapEl.clientWidth;
    const h = canvasWrapEl.clientHeight;
    if (!w || !h) return; // container is hidden/zero-sized — nothing to size yet
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resizeRenderer();

  function resolvePaintMesh(root, name) {
    const obj = root.getObjectByName(name);
    if (!obj) return null;
    if (obj.isMesh) return obj;
    let found = null;
    obj.traverse((child) => {
      if (!found && child.isMesh && child.material && child.material.name === PAINT_MATERIAL_NAME) {
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
  let sizeX = 0, sizeY = 0, sizeZ = 0;
  let presets = {};
  let introPos = new THREE.Vector3();
  let viewOrientation = {};

  // The quaternion a camera at `position` would end up with after
  // camera.lookAt(target), for the given `up` — computed on a throwaway
  // matrix so it can be precomputed and slerped between without ever calling
  // lookAt() on the real camera mid-flight. The top view gets a horizontal
  // up vector (the car's own front axis) instead of world-up, since
  // world-up is parallel to the view direction there and that degeneracy
  // is what causes a camera to visibly "flip".
  function computeOrientationQuaternion(position, target, up) {
    const m = new THREE.Matrix4().lookAt(position, target, up);
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }

  function computePresets() {
    const aspect = camera.aspect;
    const distFB  = fitDistance(sizeX, sizeY, FOV_DEG, aspect, CAMERA_PADDING) + sizeZ / 2;
    const distLR  = fitDistance(sizeZ, sizeY, FOV_DEG, aspect, CAMERA_PADDING) + sizeX / 2;
    const distTop = fitDistance(sizeX, sizeZ, FOV_DEG, aspect, CAMERA_PADDING) + sizeY / 2;

    presets = {
      front: center.clone().addScaledVector(FRONT_AXIS, distFB),
      back:  center.clone().addScaledVector(FRONT_AXIS, -distFB),
      left:  center.clone().addScaledVector(LEFT_AXIS, distLR),
      right: center.clone().addScaledVector(LEFT_AXIS, -distLR),
      top:   center.clone().add(new THREE.Vector3(0, distTop, 0.001)),
    };

    const introDist = Math.max(distFB, distLR) * 1.05;
    introPos = center.clone().add(
      new THREE.Vector3(0.55, 0.42, 0.72).normalize().multiplyScalar(introDist)
    );

    viewOrientation = {
      front: computeOrientationQuaternion(presets.front, center, UP_AXIS),
      back:  computeOrientationQuaternion(presets.back,  center, UP_AXIS),
      left:  computeOrientationQuaternion(presets.left,  center, UP_AXIS),
      right: computeOrientationQuaternion(presets.right, center, UP_AXIS),
      top:   computeOrientationQuaternion(presets.top,   center, FRONT_AXIS),
      intro: computeOrientationQuaternion(introPos,       center, UP_AXIS),
    };
  }

  /* -----------------------------------------------------------------------
     Camera flights — position lerp + orientation slerp between precomputed
     waypoints, routed through the top view for any turn not already
     starting or ending there. See suv-3d.html for the full rationale.
  ----------------------------------------------------------------------- */
  let flightActive = false;
  let currentView = 'front';

  const viewButtons = buttonsEl ? Array.prototype.slice.call(buttonsEl.querySelectorAll('[data-view]')) : [];
  function syncViewButtons() {
    viewButtons.forEach((btn) => {
      const active = btn.dataset.view === currentView;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  function runLeg(fromPos, fromQuat, toPos, toQuat, duration) {
    return new Promise((resolve) => {
      const startTime = performance.now();
      function step(now) {
        const t = Math.min(1, (now - startTime) / duration);
        const eased = easeInOutQuad(t);
        camera.position.lerpVectors(fromPos, toPos, eased);
        camera.quaternion.slerpQuaternions(fromQuat, toQuat, eased);
        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          resolve();
        }
      }
      requestAnimationFrame(step);
    });
  }

  async function flyToView(view) {
    if (flightActive || view === currentView) return;
    const targetPos = view === 'intro' ? introPos : presets[view];
    const targetQuat = viewOrientation[view];
    if (!targetPos || !targetQuat) return;

    flightActive = true;
    const startPos = camera.position.clone();
    const startQuat = camera.quaternion.clone();
    const viaTop = currentView !== 'top' && view !== 'top';

    if (viaTop) {
      await runLeg(startPos, startQuat, presets.top, viewOrientation.top, LEG_DURATION_MS);
      await runLeg(presets.top, viewOrientation.top, targetPos, targetQuat, LEG_DURATION_MS);
    } else {
      await runLeg(startPos, startQuat, targetPos, targetQuat, LEG_DURATION_MS);
    }

    currentView = view;
    flightActive = false;
    syncViewButtons();
  }

  viewButtons.forEach((btn) => {
    btn.addEventListener('click', () => flyToView(btn.dataset.view));
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
  loader.load(
    modelUrl,
    (gltf) => {
      const root = gltf.scene;
      scene.add(root);
      root.updateMatrixWorld(true);

      const box = new THREE.Box3().setFromObject(root);
      box.getCenter(center);
      const size = box.getSize(new THREE.Vector3());
      sizeX = size.x; sizeY = size.y; sizeZ = size.z;

      // Paint material's base color is near-black with no color texture as
      // authored, so it's overridden at runtime. Walk every material once
      // (dedup via a Set) so a shared material is corrected exactly once.
      const paintMaterials = new Set();
      root.traverse((obj) => {
        if (obj.isMesh && obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const mat of mats) {
            if (mat.name === PAINT_MATERIAL_NAME) paintMaterials.add(mat);
          }
        }
        if (obj.isMesh && obj.geometry && !obj.geometry.attributes.normal) {
          obj.geometry.computeVertexNormals();
        }
      });
      for (const mat of paintMaterials) {
        mat.color.setRGB(0.82, 0.83, 0.86);
        mat.roughness = Math.min(mat.roughness ?? 0.3, 0.3);
        mat.metalness = Math.max(mat.metalness ?? 0, 0.25);
        mat.needsUpdate = true;
      }

      root.traverse((obj) => { if (obj.isMesh) pickable.push(obj); });

      for (const id of PAINTABLE_NAMES) {
        const mesh = resolvePaintMesh(root, id);
        if (!mesh) {
          console.warn('[car3d] Could not resolve paintable panel:', id);
          continue;
        }
        const hoverOverlay = makeOverlay(mesh, HOVER_COLOR, HOVER_OPACITY);
        const selectedOverlay = makeOverlay(mesh, SELECTED_COLOR, SELECTED_OPACITY);
        overlayFor.set(mesh, { hoverOverlay, selectedOverlay, id });
        selectedOverlay.visible = isPartSelected(id);
      }

      computePresets();
      camera.position.copy(presets.front);
      camera.quaternion.copy(viewOrientation.front);
      currentView = 'front';
      syncViewButtons();

      if (overlayEl) overlayEl.classList.add('hidden');
    },
    (xhr) => {
      if (!loadingLabelEl) return;
      if (xhr.total) {
        const pct = Math.min(100, Math.round((xhr.loaded / xhr.total) * 100));
        if (progressBarEl) progressBarEl.style.width = pct + '%';
        loadingLabelEl.textContent = `Cargando modelo 3D… ${pct}%`;
      } else {
        loadingLabelEl.textContent = `Cargando modelo 3D… ${formatBytes(xhr.loaded)}`;
      }
    },
    (err) => {
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
    if (sizeX || sizeY || sizeZ) computePresets();
  }
  window.addEventListener('resize', onWindowResize);

  /* -----------------------------------------------------------------------
     Controller returned to the host page
  ----------------------------------------------------------------------- */
  return {
    // Call after un-hiding the container — its dimensions are 0 while
    // hidden, so sizing has to happen once it's actually visible again.
    resize() {
      resizeRenderer();
      if (sizeX || sizeY || sizeZ) computePresets();
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
    // Not currently called by the wizard (the viewer is mounted once and
    // just shown/hidden for the rest of the page's life), provided for
    // completeness/future use.
    destroy() {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onWindowResize);
      canvasEl.removeEventListener('pointermove', onPointerMove);
      canvasEl.removeEventListener('click', onPointerClick);
      renderer.dispose();
    },
  };
}