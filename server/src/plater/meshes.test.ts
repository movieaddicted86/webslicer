/**
 * Headless model import: STL plus 3MF meshes and their build-item transforms.
 * The 3MF fixtures are written by `build3mf` itself (the format the browser produces), so the
 * reader is tested against the files WebSlicer really stores.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { build3mf, parseStl, writeBinaryStl, type ThreeMfObject } from '../slicer/threemf.js';
import { loadModelBuffer } from './meshes.js';
import { IDENTITY } from './normalize.js';

/** A tetrahedron – the smallest mesh with a volume. */
const TETRA = { vertices: Float32Array.from([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 5]), indices: Uint32Array.from([0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3]) };

const translate = (x: number, y: number): number[] => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, 0, 1];

/** Minimal foreign 3MF: exactly what the spec requires, with a transform-less build item. */
async function minimal3mf(model: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('3D/3dmodel.model', model);
  return zip.generateAsync({ type: 'nodebuffer' });
}

const cubeXml = (item: string) => `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>
  <object id="1" name="cube.stl" type="model">
   <mesh>
    <vertices>
     <vertex x="0" y="0" z="0"/>
     <vertex x="20" y="0" z="0"/>
     <vertex x="20" y="20" z="0"/>
     <vertex x="0" y="20" z="0"/>
    </vertices>
    <triangles>
     <triangle v1="0" v2="1" v3="2"/>
     <triangle v1="0" v2="2" v3="3"/>
    </triangles>
   </mesh>
  </object>
 </resources>
 <build>
${item}
 </build>
</model>`;

test('loadModelBuffer reads a binary STL as one model with the identity placement', async () => {
  const stl = writeBinaryStl(TETRA);
  const models = await loadModelBuffer(stl, 'calibration_cube_20mm.stl');
  assert.equal(models.length, 1);
  assert.equal(models[0].name, 'calibration_cube_20mm');
  assert.deepEqual(models[0].instances, [IDENTITY]);
  assert.equal(models[0].mesh.indices.length, 12);
  assert.equal(models[0].mesh.vertices.length, 12);
  // round trip through the STL writer keeps the corners
  assert.deepEqual([...models[0].mesh.vertices].slice(0, 3), [...TETRA.vertices].slice(0, 3));
});

test('loadModelBuffer reads every 3MF object with its build-item instances', async () => {
  const objects: ThreeMfObject[] = [
    { name: 'cube', mesh: TETRA, transform: IDENTITY, instances: [IDENTITY, translate(40, 0)] },
    { name: 'small', mesh: TETRA, transform: translate(0, 60) },
  ];
  const buf = await build3mf(objects);
  const models = await loadModelBuffer(buf, 'plate.3mf');
  assert.equal(models.length, 2);
  assert.equal(models[0].name, 'cube');
  assert.equal(models[1].name, 'small');
  assert.equal(models[0].instances.length, 2);
  assert.deepEqual(models[0].instances[1], translate(40, 0));
  // an object with a single `<item>` keeps one instance
  assert.equal(models[1].instances.length, 1);
  assert.deepEqual(models[1].instances[0], translate(0, 60));
  // the mesh comes back in object coordinates, so the raw vertex list survives the round trip
  assert.deepEqual([...models[0].mesh.vertices], [...TETRA.vertices]);
  assert.deepEqual([...models[0].mesh.indices], [...TETRA.indices]);
});

test('loadModelBuffer places a 3MF object whose build item has no transform at the origin', async () => {
  const buf = await minimal3mf(cubeXml('  <item objectid="1" printable="1"/>'));
  const models = await loadModelBuffer(buf, 'foreign.3mf');
  assert.equal(models.length, 1);
  assert.equal(models[0].name, 'cube.stl');
  assert.deepEqual(models[0].instances, [IDENTITY]);
  assert.equal(models[0].mesh.vertices.length, 12);
  assert.equal(models[0].mesh.indices.length, 6);
});

test('loadModelBuffer reads a 3MF object with no build item at all', async () => {
  const buf = await minimal3mf(cubeXml(''));
  const models = await loadModelBuffer(buf, 'foreign.3mf');
  assert.equal(models.length, 1);
  assert.deepEqual(models[0].instances, [IDENTITY]);
});

test('loadModelBuffer skips objects without a mesh and objects without triangles', async () => {
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>
  <object id="1" type="other"/>
  <object id="2" name="empty" type="model"><mesh><vertices/><triangles/></mesh></object>
  <object id="3" name="ok" type="model">
   <mesh>
    <vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices>
    <triangles><triangle v1="0" v2="1" v3="2"/></triangles>
   </mesh>
  </object>
 </resources>
 <build/>
</model>`;
  const models = await loadModelBuffer(await minimal3mf(model), 'mixed.3mf');
  assert.equal(models.length, 1);
  assert.equal(models[0].name, 'ok');
  assert.equal(models[0].mesh.indices.length, 3);
});

test('loadModelBuffer drops triangles that point outside the vertex list', async () => {
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>
  <object id="1" name="broken" type="model">
   <mesh>
    <vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices>
    <triangles><triangle v1="0" v2="1" v3="2"/><triangle v1="0" v2="1" v3="9"/></triangles>
   </mesh>
  </object>
 </resources>
</model>`;
  const models = await loadModelBuffer(await minimal3mf(model), 'broken.3mf');
  assert.equal(models[0].mesh.indices.length, 3);
});

test('loadModelBuffer rejects an unsupported format and a broken 3MF', async () => {
  await assert.rejects(() => loadModelBuffer(Buffer.from('solid x'), 'model.obj'), /Unsupported model format/);
  await assert.rejects(() => loadModelBuffer(Buffer.from('not a zip'), 'model.3mf'), /Cannot read 3MF/);
  const empty = new JSZip();
  empty.file('dummy.txt', 'x');
  const noModel = await empty.generateAsync({ type: 'nodebuffer' });
  await assert.rejects(() => loadModelBuffer(noModel, 'model.3mf'), /no 3D\/3dmodel.model/);
  // a model file without any object is as unusable as a missing one
  const noMesh = await minimal3mf('<model><resources/></model>');
  await assert.rejects(() => loadModelBuffer(noMesh, 'model.3mf'), /contains no mesh/);
});

test('the STL reader and the plater agree on the parsed mesh', async () => {
  const models = await loadModelBuffer(writeBinaryStl(TETRA), 'tetra.stl');
  assert.deepEqual(models[0].mesh, parseStl(writeBinaryStl(TETRA)));
});
