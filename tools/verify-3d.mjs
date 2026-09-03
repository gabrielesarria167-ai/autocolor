/* =============================================================================
   verify-3d.mjs — que un GLB comprimido siga sirviendo para elegir piezas.

   El visor busca cada panel por NOMBRE: resolvePaintMesh() en src/carVisual.js
   resuelve los ids de VEHICLE_MODELS[*].parts contra los nodos del GLB. Casi
   toda herramienta de optimización fusiona, reordena o renombra nodos, y cuando
   lo hace el archivo carga igual de bien y la pieza simplemente deja de poder
   pintarse. Sin error. Por eso esto se comprueba antes de commitear.

   Uso:
       node tools/verify-3d.mjs                       # línea base de los tres
       node tools/verify-3d.mjs base.glb nuevo.glb    # comparar antes/después

   Sin dependencias: lee el chunk JSON del GLB y nada más.
   ========================================================================== */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* -----------------------------------------------------------------------------
   Lo que el visor espera de cada modelo.

   Se lee de src/carVisual.js en vez de repetirlo aquí: una copia a mano se
   desincroniza y esta comprobación dejaría de comprobar lo que importa.
   -------------------------------------------------------------------------- */

function loadExpectations() {
    const src = readFileSync(path.join(ROOT, 'src/carVisual.js'), 'utf8');
    const models = {};

    // Cada entrada de VEHICLE_MODELS: van: { ... }, wagon: { ... }, pickup: {...}
    for (const key of ['van', 'wagon', 'pickup']) {
        const start = src.indexOf(`\n  ${key}: {`);
        if (start === -1) throw new Error(`No encontré el modelo '${key}' en carVisual.js`);
        // Hasta el comienzo del siguiente modelo o el fin del objeto.
        const rest = src.slice(start + 1);
        const end = rest.search(/\n  [a-z]+: \{|\n\};/);
        const block = rest.slice(0, end === -1 ? rest.length : end);

        models[key] = {
            url: (block.match(/3d-visuals\/([^']+\.glb)/) || [])[1],
            paintMaterial: (block.match(/paintMaterial:\s*'([^']+)'/) || [])[1],
            parts: listOf(block, 'parts'),
            hiddenNodes: listOf(block, 'hiddenNodes'),
        };
    }
    return models;
}

// Los ids de un array del bloque, ignorando lo que haya en comentarios.
function listOf(block, field) {
    const m = block.match(new RegExp(`${field}:\\s*\\[([\\s\\S]*?)\\]`));
    if (!m) return [];
    const withoutComments = m[1].replace(/\/\/[^\n]*/g, '');
    return [...withoutComments.matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

/* -----------------------------------------------------------------------------
   Leer el GLB
   -------------------------------------------------------------------------- */

function readGlbJson(file) {
    const buf = readFileSync(file);
    const magic = buf.toString('ascii', 0, 4);
    if (magic !== 'glTF') throw new Error(`${file} no es un GLB`);
    const chunkLength = buf.readUInt32LE(12);
    return { json: JSON.parse(buf.toString('utf8', 20, 20 + chunkLength)), size: buf.length };
}

// La misma normalización que THREE.PropertyBinding.sanitizeNodeName, que es la
// que aplica GLTFLoader al cargar. Comparar en crudo daría falsos iguales.
function sanitize(name) {
    return (name || '').replace(/\s/g, '_').replace(/[^\w-]/g, '');
}

/* -----------------------------------------------------------------------------
   El retrato de un archivo: lo único que el visor necesita que no cambie
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

    // Por cada pieza: cuántas primitivas tiene y con qué materiales, en orden.
    // Si dos primitivas se fusionan, el material deja de ser el de la pintura y
    // la pieza se vuelve no pintable sin que nada avise.
    // La malla de una pieza no siempre cuelga del nodo con nombre. Al cuantizar,
    // gltf-transform deja la animación en el nodo animado y le mueve la malla a
    // un hijo sin nombre (transformMeshParents), así que el nodo con nombre
    // queda como un grupo vacío. El visor lo tolera: resolvePaintMesh() hace
    // getObjectByName() y, si eso no es una malla, un traverse() hacia abajo.
    // Esto mira igual que él —la malla del nodo, o la de su descendencia— y no
    // menos: encontrar más de una sí es un cambio, y se reporta como tal.
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

    const paint = materials.find((m) => m.name === expected.paintMaterial);

    return {
        size,
        nodeNames: [...byName.keys()].sort(),
        duplicates,
        parts,
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

    // 1. Ningún nombre puede desaparecer. Sobrar es raro pero no rompe nada.
    const gone = before.nodeNames.filter((n) => !after.nodeNames.includes(n));
    if (gone.length) problems.push(`desaparecieron ${gone.length} nombres de nodo: ${gone.slice(0, 8).join(', ')}${gone.length > 8 ? '…' : ''}`);

    // 2. Duplicados: GLTFLoader renombraría el segundo a 'hood_1' y
    //    resolvePaintMesh('hood') caería en el nodo equivocado.
    if (after.duplicates.length) problems.push(`nombres duplicados tras normalizar: ${after.duplicates.join(', ')}`);

    // 3. Cada pieza configurada, con sus primitivas y materiales intactos.
    for (const id of Object.keys(before.parts)) {
        const b = before.parts[id], a = after.parts[id];
        if (a === null) { problems.push(`la pieza '${id}' ya no existe`); continue; }
        if (b === null) continue;
        if (a.length !== b.length) { problems.push(`'${id}': ${b.length} primitivas -> ${a.length}`); continue; }
        if (JSON.stringify(a) !== JSON.stringify(b)) problems.push(`'${id}': materiales ${JSON.stringify(b)} -> ${JSON.stringify(a)}`);
    }

    // 4. El material de pintura y sus extensiones.
    if (!after.paintMaterial) problems.push(`falta el material de pintura '${expected.paintMaterial}'`);
    else if (before.paintMaterial &&
             JSON.stringify(after.paintMaterial.extensions) !== JSON.stringify(before.paintMaterial.extensions)) {
        problems.push(`extensiones de '${expected.paintMaterial}': ${JSON.stringify(before.paintMaterial.extensions)} -> ${JSON.stringify(after.paintMaterial.extensions)}`);
    }

    // 5. Si corrió `instance`, los nodos con nombre se cambiaron por instancias.
    if (after.extensionsRequired.includes('EXT_mesh_gpu_instancing')) {
        problems.push('apareció EXT_mesh_gpu_instancing: corrió `instance` y los nodos con nombre ya no son de fiar');
    }

    return problems;
}

/* -------------------------------------------------------------------------- */

const models = loadExpectations();
const args = process.argv.slice(2);

if (args.length === 2) {
    // Modo comparación: se deduce el modelo por el nombre del archivo.
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
for (const [key, expected] of Object.entries(models)) {
    const file = path.join(ROOT, 'imgs/assets/3d-visuals', expected.url);
    let d;
    try { d = describe(file, expected); }
    catch (err) { console.log(`\n${key}: no se pudo leer (${err.message})`); bad++; continue; }

    const missing = Object.entries(d.parts).filter(([, v]) => v === null).map(([k]) => k);
    console.log(`\n${key}  (${path.basename(file)}, ${(d.size / 1e6).toFixed(1)} MB)`);
    console.log(`  ${d.counts.nodes} nodos · ${d.counts.meshes} mallas · ${d.counts.materials} materiales · ${d.counts.images} imágenes`);
    console.log(`  piezas configuradas: ${expected.parts.length}   sin resolver: ${missing.length ? missing.join(', ') : 'ninguna'}`);
    console.log(`  nombres duplicados: ${d.duplicates.length ? d.duplicates.join(', ') : 'ninguno'}`);
    console.log(`  material de pintura '${expected.paintMaterial}': ${d.paintMaterial ? 'presente [' + (d.paintMaterial.extensions.join(', ') || 'sin extensiones') + ']' : 'NO ENCONTRADO'}`);
    console.log(`  extensionsRequired: ${d.extensionsRequired.join(', ') || 'ninguna'}`);
    if (missing.length || d.duplicates.length || !d.paintMaterial) bad++;
}
console.log(bad ? `\n✗ ${bad} modelo(s) con problemas` : '\n✓ los tres modelos están sanos');
process.exit(bad ? 1 : 0);
