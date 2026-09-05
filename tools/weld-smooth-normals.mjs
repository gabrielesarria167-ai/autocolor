/* =============================================================================
   weld-smooth-normals.mjs — soldar los vértices de un modelo y rehacer sus
   normales.

   Para qué. El export de Blender del van daba a cada esquina de triángulo su
   propio vértice: 2 574 420 vértices para 953 000 triángulos, 2.70 por
   triángulo, donde los otros tres modelos andan por 0.8–1.0. No es más detalle
   —el familiar tiene MÁS triángulos y pesa la mitad—, son copias del mismo
   punto que no se comparten. Eso hacía 20.5 MB de los que 19 eran geometría.

   Por qué no basta `gltf-transform weld`. Ese suelda vértices bitwise
   idénticos, y estos no lo son: cada copia trae una normal distinta, así que
   no hay dos iguales que unir. Sobre 2.5 millones de vértices unió mil. Por lo
   mismo `simplify` tampoco puede hacer nada —cada vértice es una costura y no
   hay aristas que colapsar—: bajaba de 20.5 MB a 19.5.

   Qué hace entonces. Quita las normales, suelda por posición y UV, y las vuelve
   a calcular sobre la malla ya indexada, suavizadas y ponderadas por el área de
   cada triángulo, que es lo mismo que hace THREE.computeVertexNormals. En el
   van: 2 574 420 vértices -> 550 046, y 20.5 MB -> 6.9 MB.

   Se puede hacer porque las normales del van ya eran suaves. Comprobado, no
   supuesto: recalcularlas y comparar el render contra el original da una
   diferencia media de 0.3–0.6 sobre 255, y menos del 0.33 % de los píxeles del
   vehículo se apartan lo bastante como para verse. En un modelo con aristas
   duras de verdad —una arista marcada en Blender, no un simple borde entre
   paneles— esto las redondearía, y ahí no sirve.

   Uso. No es dependencia del proyecto; se instala al vuelo, como el CLI. Node
   resuelve los import desde la carpeta del SCRIPT, no desde donde se le llama,
   así que el script se copia junto a la instalación y se corre desde ahí:

       mkdir -p /tmp/gltf && cd /tmp/gltf
       npm i @gltf-transform/core @gltf-transform/extensions \
             @gltf-transform/functions meshoptimizer
       cp ~/autocolor/tools/weld-smooth-normals.mjs .
       node weld-smooth-normals.mjs entrada.glb salida.glb

   Va DESPUÉS de `prune` y ANTES de `reorder`: soldar reordena los vértices, y
   reorder es justamente lo que los deja en el orden que le conviene a la caché.
   La tubería entera y el porqué de cada paso están en el README, en «Cómo se
   comprime un modelo».

   Después, siempre:  node tools/verify-3d.mjs original.glb salida.glb
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

// Las normales por esquina son lo único que impide compartir vértices. Se
// quitan para que weld pueda unir por posición y UV.
for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) prim.setAttribute('NORMAL', null);
}
await doc.transform(weld());
console.log(`tras soldar:         ${vertices().toLocaleString('es')}`);

// Normales suaves sobre la malla ya indexada. El producto vectorial NO se
// normaliza antes de acumularlo: su longitud es el doble del área del
// triángulo, así que los triángulos grandes pesan más en la media. Es lo que
// hace THREE.computeVertexNormals, y por eso el resultado coincide con lo que
// el visor dibujaría si el archivo llegara sin normales.
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

// Sin comprimir: la compresión la pone `meshopt` al final de la tubería, con el
// nivel que decide el README.
await io.write(dst, doc);
console.log(`escrito ${dst}`);
