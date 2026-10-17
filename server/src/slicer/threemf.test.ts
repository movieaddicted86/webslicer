import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build3mf, read3mfProject, transformMesh, transformTo3mf, type Mesh } from './threemf.js';

function cube(size: number): Mesh {
  const s = size;
  const v = [0, 0, 0, s, 0, 0, s, s, 0, 0, s, 0, 0, 0, s, s, 0, s, s, s, s, 0, s, s];
  const f = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  return { vertices: Float32Array.from(v), indices: Uint32Array.from(f) };
}

const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

test('transformMesh applies translation and keeps winding', () => {
  const m = transformMesh(cube(1), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1]);
  assert.equal(m.vertices[0], 5);
  assert.equal(m.vertices[1], 6);
  assert.equal(m.vertices[2], 7);
  assert.deepEqual([...m.indices.slice(0, 3)], [0, 2, 1]);
  // mirrored transform flips winding
  const mirrored = transformMesh(cube(1), [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  assert.deepEqual([...mirrored.indices.slice(0, 3)], [0, 1, 2]);
});

test('3MF transform string is row-major with translation last', () => {
  assert.equal(transformTo3mf([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1]), '1 0 0 0 1 0 0 0 1 10 20 30');
});

test('3MF writer and reader roundtrip volumes', async () => {
  const buf = await build3mf(
    [
      {
        name: 'cube',
        mesh: cube(20),
        transform: I,
        config: { perimeters: '4' },
        extruder: 2,
        volumes: [
          { name: 'mod', mesh: cube(5), type: 'ParameterModifier', config: { fill_density: '100%' } },
          { name: 'blocker', mesh: cube(3), type: 'SupportBlocker' },
        ],
      },
    ],
    { projectConfig: { layer_height: '0.2' } },
  );
  const proj = await read3mfProject(buf);
  assert.equal(proj.config.layer_height, '0.2');
  assert.equal(proj.objects.length, 1);
  const o = proj.objects[0];
  assert.equal(o.name, 'cube');
  assert.equal(o.extruder, 2);
  assert.equal(o.config.perimeters, '4');
  assert.equal(o.volumes.length, 3);
  assert.deepEqual(
    o.volumes.map((v) => [v.type, v.first, v.last]),
    [
      ['ModelPart', 0, 11],
      ['ParameterModifier', 12, 23],
      ['SupportBlocker', 24, 35],
    ],
  );
  assert.equal(o.volumes[1].config.fill_density, '100%');
  // triangle indices of the second volume must be offset by the first volume's vertex count
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buf);
  const model = await zip.file('3D/3dmodel.model')!.async('string');
  assert.ok(model.includes('<triangle v1="8" v2="10" v3="9"/>'));
  assert.equal((model.match(/<vertex /g) || []).length, 24);
});

test('3MF roundtrip of height ranges and MMU paint', async () => {
  const buf = await build3mf([
    {
      name: 'c',
      mesh: cube(10),
      transform: I,
      ranges: [{ minZ: 0, maxZ: 4, config: { layer_height: '0.1' } }, { minZ: 4, maxZ: 10, config: { layer_height: '0.3', perimeters: '3' } }],
      supportPaint: '400000000000',
      mmuPaint: '000000000023',
    },
  ]);
  const proj = await read3mfProject(buf);
  const o = proj.objects[0];
  assert.deepEqual(o.ranges, [
    { minZ: 0, maxZ: 4, config: { layer_height: '0.1' } },
    { minZ: 4, maxZ: 10, config: { layer_height: '0.3', perimeters: '3' } },
  ]);
  assert.equal(o.supportPaint, '400000000000');
  assert.equal(o.mmuPaint, '000000000023');
  const JSZip = (await import('jszip')).default;
  const model = await (await JSZip.loadAsync(buf)).file('3D/3dmodel.model')!.async('string');
  assert.ok(model.includes('slic3rpe:custom_supports="4"'));
  // extruder 3 → extended state: bits 0,0,1,1 then 1,1,0,0 → "c3"
  assert.ok(model.includes('slic3rpe:mmu_segmentation="c3"'), model.match(/mmu_segmentation="[^"]*"/g)?.join(','));
  assert.ok(model.includes('slic3rpe:mmu_segmentation="8"'));
});
