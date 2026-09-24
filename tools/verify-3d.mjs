/* =============================================================================
   verify-3d.mjs: checks that a compressed GLB still works for picking panels.

   The viewer finds each panel by NAME: resolvePaintMesh() in src/carVisual.js
   resolves the ids in VEHICLE_MODELS[*].parts against the GLB's nodes. Nearly
   every optimisation tool merges, reorders or renames nodes, and when it does
   the file loads just as well and the panel simply stops being paintable.
   No error. That is why this is checked before committing.

   Usage:
       node tools/verify-3d.mjs                       # baseline of the models
       node tools/verify-3d.mjs base.glb new.glb      # compare before/after

   No dependencies: it reads the GLB's JSON chunk and nothing else.
   ========================================================================== */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* -----------------------------------------------------------------------------
   What the viewer expects from each model.

   Read from src/carVisual.js instead of repeated here: a hand copy drifts
   and this check would stop checking what matters.
   -------------------------------------------------------------------------- */

function loadExpectations() {
    const src = readFileSync(path.join(ROOT, 'src/carVisual.js'), 'utf8');
    const models = {};

    // The model names, as VEHICLE_MODELS declares them: the keys with two
    // spaces of indentation inside that object.
    const block = src.slice(src.indexOf('export const VEHICLE_MODELS'));
    for (const m of block.matchAll(/\n  ([a-z][a-zA-Z0-9]*): \{/g)) models[m[1]] = null;

    // Each VEHICLE_MODELS entry: van: { ... }, wagon: { ... }, and so on.
    // The keys are read from the file itself: a list here gets forgotten the
    // day a new model comes in, and what this tool does is precisely check
    // the models that exist.
    for (const key of Object.keys(models)) {
        const start = src.indexOf(`\n  ${key}: {`);
        if (start === -1) throw new Error(`No encontré el modelo '${key}' en carVisual.js`);
        // Up to the start of the next model or the end of the object.
        const rest = src.slice(start + 1);
        const end = rest.search(/\n  [a-z]+: \{|\n\};/);
        const block = rest.slice(0, end === -1 ? rest.length : end);

        models[key] = {
            url: (block.match(/3d-visuals\/([^']+\.glb)/) || [])[1],
            paintMaterial: (block.match(/paintMaterial:\s*'([^']+)'/) || [])[1],
            parts: listOf(block, 'parts'),
            hiddenNodes: listOf(block, 'hiddenNodes'),
            trimNodes: regexOf(block, 'trimNodes'),
        };
    }
    return models;
}

// A block field's regular expression, if there is one. It is for trimNodes,
// which does not name nodes one by one but by naming convention.
function regexOf(block, field) {
    const m = block.match(new RegExp(`${field}:\\s*/(.+?)/([a-z]*),`));
    return m ? new RegExp(m[1], m[2]) : null;
}

// The ids of an array in the block, ignoring whatever sits in comments.
function listOf(block, field) {
    const m = block.match(new RegExp(`${field}:\\s*\\[([\\s\\S]*?)\\]`));
    if (!m) return [];
    const withoutComments = m[1].replace(/\/\/[^\n]*/g, '');
    return [...withoutComments.matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

/* -----------------------------------------------------------------------------
   Reading the GLB
   -------------------------------------------------------------------------- */

function readGlbJson(file) {
    const buf = readFileSync(file);
    const magic = buf.toString('ascii', 0, 4);
    if (magic !== 'glTF') throw new Error(`${file} no es un GLB`);
    const chunkLength = buf.readUInt32LE(12);
    return { json: JSON.parse(buf.toString('utf8', 20, 20 + chunkLength)), size: buf.length };
}

// The same normalisation as THREE.PropertyBinding.sanitizeNodeName, which
// GLTFLoader applies on load. Comparing raw would give false matches.
function sanitize(name) {
    return (name || '').replace(/\s/g, '_').replace(/[^\w-]/g, '');
}

/* -----------------------------------------------------------------------------
   A file's portrait: the only thing the viewer needs to stay unchanged
   -------------------------------------------------------------------------- */

function describe(file, expected) {
    const { json, size } = readGlbJson(file);
    const nodes = json.nodes || [];
    const meshes = json.meshes || [];
    const materials = json.materials || [];

    const byName = new Map();
    const duplicates = [];
    nodes.forEach((node) => {
        const clean = sanitize(node.name);
        if (!clean) return;
        if (byName.has(clean)) duplicates.push(clean);
        else byName.set(clean, node);
    });

    // For each panel: how many primitives it has and with which materials, in
    // order. If two primitives merge, the material stops being the paint and
    // the panel becomes unpaintable with nothing to warn about.
    // A panel's mesh does not always hang from the named node. When
    // quantising, gltf-transform leaves the animation on the animated node and
    // moves the mesh to an unnamed child (transformMeshParents), so the named
    // node is left as an empty group. The viewer tolerates it:
    // resolvePaintMesh() calls getObjectByName() and, if that is not a mesh, a
    // traverse() downwards. This looks the same way it does (the node's mesh,
    // or its descendants') and no less: finding more than one is a change, and
    // it is reported as such.
    function meshesUnder(node) {
        const found = [];
        (function walk(n) {
            if (!n) return;
            if (n.mesh !== undefined) found.push(n.mesh);
            for (const child of n.children || []) walk(nodes[child]);
        })(node);
        return found;
    }

    const parts = {};
    for (const id of [...expected.parts, ...expected.hiddenNodes]) {
        const node = byName.get(id);
        if (!node) { parts[id] = null; continue; }
        const found = meshesUnder(node);
        if (found.length === 0) { parts[id] = []; continue; }
        if (found.length > 1) { parts[id] = ['<varias mallas bajo el nodo>']; continue; }
        const mesh = meshes[found[0]];
        parts[id] = (mesh.primitives || []).map((p) => (p.material !== undefined ? materials[p.material]?.name : null));
    }

    // The nodes the export marks as black trim by their name. If the model is
    // re-exported without that convention, the rule stops matching anything
    // and those panels come out body colour without warning.
    const trimNodes = expected.trimNodes
        ? [...byName.keys()].filter((n) => expected.trimNodes.test(n)).sort()
        : null;

    const paint = materials.find((m) => m.name === expected.paintMaterial);

    return {
        size,
        nodeNames: [...byName.keys()].sort(),
        duplicates,
        parts,
        trimNodes,
        paintMaterial: paint ? { name: paint.name, extensions: Object.keys(paint.extensions || {}).sort() } : null,
        extensionsRequired: (json.extensionsRequired || []).slice().sort(),
        counts: { nodes: nodes.length, meshes: meshes.length, materials: materials.length, images: (json.images || []).length },
    };
}

/* -----------------------------------------------------------------------------
   Comparar
   -------------------------------------------------------------------------- */

function compare(before, after, expected) {
    const problems = [];

    // 1. No name may disappear. Extra ones are odd but break nothing.
    const gone = before.nodeNames.filter((n) => !after.nodeNames.includes(n));
    if (gone.length) problems.push(`desaparecieron ${gone.length} nombres de nodo: ${gone.slice(0, 8).join(', ')}${gone.length > 8 ? '…' : ''}`);

    // 2. Duplicates: GLTFLoader would rename the second to 'hood_1' and
    //    resolvePaintMesh('hood') would land on the wrong node.
    if (after.duplicates.length) problems.push(`nombres duplicados tras normalizar: ${after.duplicates.join(', ')}`);

    // 3. Each configured panel, with its primitives and materials intact.
    for (const id of Object.keys(before.parts)) {
        const b = before.parts[id], a = after.parts[id];
        if (a === null) { problems.push(`la pieza '${id}' ya no existe`); continue; }
        if (b === null) continue;
        if (a.length !== b.length) { problems.push(`'${id}': ${b.length} primitivas -> ${a.length}`); continue; }
        if (JSON.stringify(a) !== JSON.stringify(b)) problems.push(`'${id}': materiales ${JSON.stringify(b)} -> ${JSON.stringify(a)}`);
    }

    // 4. The black trim nodes, if the model uses that convention.
    if (before.trimNodes && after.trimNodes.length !== before.trimNodes.length) {
        problems.push(`nodos de tapa negra: ${before.trimNodes.length} -> ${after.trimNodes.length}`);
    }

    // 5. The paint material and its extensions.
    if (!after.paintMaterial) problems.push(`falta el material de pintura '${expected.paintMaterial}'`);
    else if (before.paintMaterial &&
             JSON.stringify(after.paintMaterial.extensions) !== JSON.stringify(before.paintMaterial.extensions)) {
        problems.push(`extensiones de '${expected.paintMaterial}': ${JSON.stringify(before.paintMaterial.extensions)} -> ${JSON.stringify(after.paintMaterial.extensions)}`);
    }

    // 6. If `instance` ran, named nodes were swapped for instances.
    if (after.extensionsRequired.includes('EXT_mesh_gpu_instancing')) {
        problems.push('apareció EXT_mesh_gpu_instancing: corrió `instance` y los nodos con nombre ya no son de fiar');
    }

    return problems;
}

/* -------------------------------------------------------------------------- */

const models = loadExpectations();
const args = process.argv.slice(2);

if (args.length === 2) {
    // Comparison mode: the model is inferred from the file name.
    const [beforeFile, afterFile] = args;
    const key = Object.keys(models).find((k) => afterFile.includes(path.basename(models[k].url, '.glb')))
             || Object.keys(models).find((k) => afterFile.includes(k));
    if (!key) { console.error('No pude deducir de qué modelo son estos archivos.'); process.exit(2); }

    const expected = models[key];
    const before = describe(beforeFile, expected);
    const after = describe(afterFile, expected);
    const problems = compare(before, after, expected);

    console.log(`\n${key}:  ${(before.size / 1e6).toFixed(1)} MB -> ${(after.size / 1e6).toFixed(1)} MB  (${(100 - 100 * after.size / before.size).toFixed(0)}% menos)`);
    console.log(`  nodos ${before.counts.nodes} -> ${after.counts.nodes}   mallas ${before.counts.meshes} -> ${after.counts.meshes}   materiales ${before.counts.materials} -> ${after.counts.materials}   imágenes ${before.counts.images} -> ${after.counts.images}`);
    console.log(`  extensionsRequired: ${after.extensionsRequired.join(', ') || 'ninguna'}`);

    if (problems.length) {
        console.log(`\n  ✗ ${problems.length} problema(s):`);
        problems.forEach((p) => console.log(`      - ${p}`));
        process.exit(1);
    }
    console.log(`  ✓ las ${expected.parts.length} piezas siguen resolviendo, con sus primitivas y materiales`);
    process.exit(0);
}

// Modo línea base.
let bad = 0;

// src/parts.js keeps its own copy of every model's part list for the wizard's
// no-3D checklist. It has to match VEHICLE_MODELS exactly, or the checklist
// offers panels the viewer does not (or misses ones it does).
const partsModule = createRequire(import.meta.url)(path.join(ROOT, 'src/parts.js'));
for (const [key, expected] of Object.entries(models)) {
    const copy = (partsModule.BY_VEHICLE || {})[key] || [];
    if (copy.join(',') !== expected.parts.join(',')) {
        console.log(`\n${key}: ✗ src/parts.js BY_VEHICLE does not match VEHICLE_MODELS in src/carVisual.js`);
        console.log(`  carVisual.js: ${expected.parts.join(', ')}`);
        console.log(`  parts.js:     ${copy.join(', ')}`);
        bad++;
    }
    // Every part the viewer offers needs a price, or the wizard's estimate
    // leaves it out of the total.
    const unpriced = expected.parts.filter((id) => partsModule.price(id, 'standard') === null);
    if (unpriced.length) {
        console.log(`\n${key}: ✗ src/parts.js PRICE_GROUP_OF has no price for ${unpriced.join(', ')}`);
        bad++;
    }
}
for (const [key, expected] of Object.entries(models)) {
    const file = path.join(ROOT, 'imgs/assets/3d-visuals', expected.url);
    let d;
    try { d = describe(file, expected); }
    catch (err) { console.log(`\n${key}: no se pudo leer (${err.message})`); bad++; continue; }

    const missing = Object.entries(d.parts).filter(([, v]) => v === null).map(([k]) => k);
    console.log(`\n${key}  (${path.basename(file)}, ${(d.size / 1e6).toFixed(1)} MB)`);
    console.log(`  ${d.counts.nodes} nodos, ${d.counts.meshes} mallas, ${d.counts.materials} materiales, ${d.counts.images} imágenes`);
    console.log(`  piezas configuradas: ${expected.parts.length}   sin resolver: ${missing.length ? missing.join(', ') : 'ninguna'}`);
    console.log(`  nombres duplicados: ${d.duplicates.length ? d.duplicates.join(', ') : 'ninguno'}`);
    console.log(`  material de pintura '${expected.paintMaterial}': ${d.paintMaterial ? 'presente [' + (d.paintMaterial.extensions.join(', ') || 'sin extensiones') + ']' : 'NO ENCONTRADO'}`);
    if (d.trimNodes) console.log(`  nodos de tapa negra (${expected.trimNodes}): ${d.trimNodes.length ? d.trimNodes.join(', ') : 'NINGUNO'}`);
    console.log(`  extensionsRequired: ${d.extensionsRequired.join(', ') || 'ninguna'}`);
    if (missing.length || d.duplicates.length || !d.paintMaterial) bad++;
    else if (d.trimNodes && d.trimNodes.length === 0) { console.log('  ✗ la convención de tapa negra no casa con ningún nodo'); bad++; }
}
console.log(bad ? `\n✗ ${bad} modelo(s) con problemas` : `\n✓ los ${Object.keys(models).length} modelos están sanos`);
process.exit(bad ? 1 : 0);
