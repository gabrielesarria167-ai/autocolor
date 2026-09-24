/* =============================================================================
   weld-smooth-normals.mjs: welds a model's vertices and rebuilds its normals.

   Why. Blender's export of the van gave every triangle corner its own
   vertex: 2,574,420 vertices for 953,000 triangles, 2.70 per triangle, where
   the other three models sit around 0.8 to 1.0. It is not more detail (the
   wagon has MORE triangles and weighs half), they are copies of the same
   point that are not shared. That made 20.5 MB, 19 of them geometry.

   Why `gltf-transform weld` is not enough. It welds bitwise-identical
   vertices, and these are not: each copy carries a different normal, so
   there are no two equal ones to join. Out of 2.5 million vertices it joined
   a thousand. For the same reason `simplify` cannot do anything either
   (every vertex is a seam and there are no edges to collapse): it went from
   20.5 MB to 19.5.

   So what it does. It drops the normals, welds by position and UV, and
   recomputes them on the now-indexed mesh, smoothed and weighted by each
   triangle's area, which is what THREE.computeVertexNormals does. On the
   van: 2,574,420 vertices -> 550,046, and 20.5 MB -> 6.9 MB.

   It can be done because the van's normals were already smooth. Checked, not
   assumed: recomputing them and comparing the render against the original
   gives a mean difference of 0.3 to 0.6 out of 255, and under 0.33% of the
   vehicle's pixels differ enough to be seen. On a model with genuinely hard
   edges (an edge marked sharp in Blender, not a mere border between panels)
   this would round them off, and there it is no good.

   Usage. It is not a project dependency; it is installed on the fly, like the
   CLI. Node resolves imports from the SCRIPT's folder, not from where it is
   called, so the script is copied next to the install and run from there:

       mkdir -p /tmp/gltf && cd /tmp/gltf
       npm i @gltf-transform/core @gltf-transform/extensions \
             @gltf-transform/functions meshoptimizer
       cp ~/autocolor/tools/weld-smooth-normals.mjs .
       node weld-smooth-normals.mjs input.glb output.glb

   It goes AFTER `prune` and BEFORE `reorder`: welding reorders the vertices,
   and reorder is precisely what leaves them in the order the cache likes.
   The whole pipeline and the reason for each step are in the README, under
   «Cómo se comprime un modelo».

   Afterwards, always:  node tools/verify-3d.mjs original.glb output.glb
   ========================================================================== */

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, getSceneVertexCount, VertexCountMethod } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const [src, dst] = process.argv.slice(2);
if (!src || !dst) {
    console.error('Uso: node tools/weld-smooth-normals.mjs <entrada.glb> <salida.glb>');
    process.exit(2);
}

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;

const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const doc = await io.read(src);
const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
const vertices = () => getSceneVertexCount(scene, VertexCountMethod.UPLOAD);

console.log(`vértices de partida: ${vertices().toLocaleString('es')}`);

// Per-corner normals are the only thing stopping vertices from being shared.
// They are dropped so weld can join by position and UV.
for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) prim.setAttribute('NORMAL', null);
}
await doc.transform(weld());
console.log(`tras soldar:         ${vertices().toLocaleString('es')}`);

// Smooth normals on the indexed mesh. The cross product is NOT normalised
// before accumulating it: its length is twice the triangle's area, so large
// triangles weigh more in the average. It is what THREE.computeVertexNormals
// does, and why the result matches what the viewer would draw if the file
// arrived with no normals.
for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
        const position = prim.getAttribute('POSITION');
        const indices = prim.getIndices();
        if (!position || !indices) continue;

        const count = position.getCount();
        const normals = new Float32Array(count * 3);
        const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];

        for (let i = 0; i < indices.getCount(); i += 3) {
            const i0 = indices.getScalar(i), i1 = indices.getScalar(i + 1), i2 = indices.getScalar(i + 2);
            position.getElement(i0, a); position.getElement(i1, b); position.getElement(i2, c);
            const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
            const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
            const nx = e1y * e2z - e1z * e2y;
            const ny = e1z * e2x - e1x * e2z;
            const nz = e1x * e2y - e1y * e2x;
            for (const k of [i0, i1, i2]) {
                normals[k * 3] += nx; normals[k * 3 + 1] += ny; normals[k * 3 + 2] += nz;
            }
        }
        for (let k = 0; k < count; k++) {
            const x = normals[k * 3], y = normals[k * 3 + 1], z = normals[k * 3 + 2];
            const length = Math.hypot(x, y, z) || 1;
            normals[k * 3] = x / length; normals[k * 3 + 1] = y / length; normals[k * 3 + 2] = z / length;
        }

        prim.setAttribute('NORMAL', doc.createAccessor()
            .setType('VEC3').setArray(normals).setBuffer(position.getBuffer()));
    }
}
console.log('normales suaves recalculadas');

// Uncompressed: `meshopt` adds compression at the end of the pipeline, at the
// level the README decides.
await io.write(dst, doc);
console.log(`escrito ${dst}`);
