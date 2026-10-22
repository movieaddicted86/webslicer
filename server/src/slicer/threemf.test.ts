import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build3mf, read3mfProject, transformMesh, type Mesh } from './threemf/index.js';
import { IDENTITY, translate } from '@webslicer/shared';

function cube(size: number): Mesh {
  const s = size;
  const v = [0, 0, 0, s, 0, 0, s, s, 0, 0, s, 0, 0, 0, s, s, 0, s, s, s, s, 0, s, s];
  const f = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  return { vertices: Float32Array.from(v), indices: Uint32Array.from(f) };
}

const I = IDENTITY;

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
      ranges: [
        { minZ: 0, maxZ: 4, config: { layer_height: '0.1' } },
        { minZ: 4, maxZ: 10, config: { layer_height: '0.3', perimeters: '3' } },
      ],
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

test('custom G-codes per print Z roundtrip', async () => {
  const { customGcodeXml, parseCustomGcodeXml } = await import('./threemf/index.js');
  const xml = customGcodeXml(
    [
      { printZ: 5.2, type: 'pause', extra: 'Insert magnets' },
      { printZ: 2.4, type: 'color_change', extruder: 1, color: '#FF0000' },
      { printZ: 8, type: 'custom', extra: 'M117 Hello\nG4 S1' },
    ],
    'SingleExtruder',
    { color_change_gcode: 'M600', pause_print_gcode: 'M601' },
  );
  assert.ok(xml.indexOf('print_z="2.4"') < xml.indexOf('print_z="5.2"'), 'sorted by height');
  assert.ok(xml.includes('type="0"') && xml.includes('type="1"') && xml.includes('type="4"'));
  assert.ok(xml.includes('<mode value="SingleExtruder"/>'));
  const codes = parseCustomGcodeXml(xml);
  assert.deepEqual(
    codes.map((c) => [c.printZ, c.type, c.color, c.extra]),
    [
      [2.4, 'color_change', '#FF0000', undefined],
      [5.2, 'pause', undefined, 'Insert magnets'],
      [8, 'custom', undefined, 'M117 Hello\nG4 S1'],
    ],
  );
  const buf = await build3mf([{ name: 'c', mesh: cube(10), transform: I }], { customGcodes: codes });
  const proj = await read3mfProject(buf);
  assert.equal(proj.customGcodes.length, 3);
});

/** 3MF transform string of a column-major matrix, parsed back into numbers. */
async function readItems(buf: Buffer): Promise<Array<{ objectId: string; transform: number[] }>> {
  const JSZip = (await import('jszip')).default;
  const model = await (await JSZip.loadAsync(buf)).file('3D/3dmodel.model')!.async('string');
  const build = /<build\b[^>]*>([\s\S]*?)<\/build>/.exec(model)![1];
  const out: Array<{ objectId: string; transform: number[] }> = [];
  const re = /<item\b([^>]*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(build))) {
    out.push({
      objectId: /\bobjectid="([^"]+)"/.exec(m[1])![1],
      transform: (/\btransform="([^"]+)"/.exec(m[1])?.[1] || '').split(' ').map(Number),
    });
  }
  return out;
}

const closeTo = (a: number[], b: number[], tol = 1e-6) => {
  assert.equal(a.length, b.length);
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= tol, `${i}: ${v} != ${b[i]}`));
};

/** three.js Matrix4.elements of a rotation of `deg` about Z plus the translation (x, y, z). */
function rotZ(deg: number, x = 0, y = 0, z = 0): number[] {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  // column-major: [m00,m10,m20,m30, m01,m11,m21,m31, m02,m12,m22,m32, m03,m13,m23,m33]
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

test('3MF transform round trip keeps a rotation (not its transpose)', async () => {
  // a 90 deg rotation about Z is the case that distinguishes R from R^T: the translation-only
  // tests above cannot see the difference
  const m = rotZ(90, 5, 0, 1);
  const buf = await build3mf([{ name: 'cube', mesh: cube(20), transform: m, instances: [m] }]);
  const view = await readItems(buf);
  // the string is the 4x3 row-major form: the first 9 numbers are the rows of R
  closeTo([...view[0].transform.slice(0, 3), ...view[0].transform.slice(3, 6)], [0, 1, 0, -1, 0, 0], 1e-3);
  closeTo(view[0].transform.slice(9), [5, 0, 1], 1e-3);
  const proj = await read3mfProject(buf);
  closeTo(proj.objects[0].instances[0], m, 1e-3);
  // and applying the parsed matrix to the +X axis really gives +Y (three.js' reading of the file)
  const e = proj.objects[0].instances[0];
  closeTo([e[0], e[1], e[2]], [0, 1, 0], 1e-3);
});

test('3MF roundtrip keeps a mirrored instance transform (rotation + mirror + non-uniform scale)', async () => {
  // PrusaSlicer's "Mirror X" through the instance position: M' = T(p)·S(axis=-1)·T(-p)·M. The
  // column-major elements below are that product for a 30 mm object placed at (10, 20) and rotated
  // 90° about Z with a non-uniform scale; the sign ends up in the scale, so the determinant stays
  // negative.  (Computed with three.js, rounded to the values the 3MF writer prints.)
  const mirrored = [0, 1.5, 0, 0, 1, 0, 0, 0, 0, 0, 2, 0, 10, 20, 0, 1];
  const det = (m: number[]) =>
    m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
  assert.ok(det(mirrored) < 0);
  const buf = await build3mf([{ name: 'cube', mesh: cube(30), transform: mirrored, instances: [mirrored] }]);
  const proj = await read3mfProject(buf);
  assert.equal(proj.objects[0].instances.length, 1);
  closeTo(proj.objects[0].instances[0], mirrored, 1e-3);
  // the written item transform is the same matrix, and it is not transposed on the way out
  const items = await readItems(buf);
  closeTo(items[0].transform, [0, 1.5, 0, 1, 0, 0, 0, 0, 2, 10, 20, 0], 1e-3);
  // the object mesh stays in object coordinates (the mirror is a build item, not baked in)
  const JSZip = (await import('jszip')).default;
  const model = await (await JSZip.loadAsync(buf)).file('3D/3dmodel.model')!.async('string');
  assert.ok(/<vertex x="0" y="0" z="0"\/>/.test(model), model.slice(0, 1200));
});

test('3MF writer emits one item per instance and instances_count', async () => {
  const instances = [translate(10, 0, 0), translate(0, 20, 0), translate(30, 30, 0)];
  const buf = await build3mf([{ name: 'cube', mesh: cube(20), transform: instances[0], instances }]);
  const items = await readItems(buf);
  assert.equal(items.length, 3);
  assert.deepEqual(
    items.map((i) => i.objectId),
    ['1', '1', '1'],
  );
  // 3MF item transform: 9 matrix values then the translation
  assert.deepEqual(
    items.map((i) => i.transform.slice(9)),
    [
      [10, 0, 0],
      [0, 20, 0],
      [30, 30, 0],
    ],
  );
  const JSZip = (await import('jszip')).default;
  const mc = await (await JSZip.loadAsync(buf)).file('Metadata/Slic3r_PE_model.config')!.async('string');
  assert.ok(mc.includes('instances_count="3"'), mc);
});

test('3MF writer keeps the object mesh in object coordinates with instances', async () => {
  const buf = await build3mf([
    { name: 'cube', mesh: cube(20), transform: translate(10, 0, 0), instances: [translate(10, 0, 0), translate(40, 0, 0)] },
  ]);
  const JSZip = (await import('jszip')).default;
  const model = await (await JSZip.loadAsync(buf)).file('3D/3dmodel.model')!.async('string');
  // the resource mesh is untouched: a 20 mm cube starting at the origin
  assert.ok(/<vertex x="0" y="0" z="0"\/>/.test(model), model.slice(0, 1200));
  assert.ok(/<vertex x="20" y="20" z="20"\/>/.test(model));
  const items = await readItems(buf);
  assert.deepEqual(
    items.map((i) => i.transform[9]),
    [10, 40],
  );
});

test('3MF reader returns instance transforms and build order', async () => {
  const instances = [translate(10, 0, 0), translate(0, 20, 0), translate(30, 30, 0)];
  const buf = await build3mf([{ name: 'cube', mesh: cube(20), transform: instances[0], instances }]);
  const proj = await read3mfProject(buf);
  assert.equal(proj.objects.length, 1);
  assert.equal(proj.objects[0].instances.length, 3);
  proj.objects[0].instances.forEach((m, i) => closeTo(m, instances[i]));
  assert.deepEqual(proj.buildOrder, [0, 0, 0]);
});

test('3MF reader without instances returns a single identity transform in build order', async () => {
  const buf = await build3mf([{ name: 'cube', mesh: cube(20), transform: I }]);
  const proj = await read3mfProject(buf);
  assert.equal(proj.objects[0].instances.length, 1);
  closeTo(proj.objects[0].instances[0], I);
  assert.deepEqual(proj.buildOrder, [0]);
});

test('3MF reader maps mixed objects (A with 2 instances, B with 1) in build order', async () => {
  const a = [translate(10, 10, 0), translate(40, 10, 0)];
  const b = translate(10, 60, 0);
  const buf = await build3mf([
    { name: 'A', mesh: cube(20), transform: a[0], instances: a },
    { name: 'B', mesh: cube(15), transform: b },
  ]);
  const items = await readItems(buf);
  assert.deepEqual(
    items.map((i) => i.objectId),
    ['1', '1', '2'],
  );
  const proj = await read3mfProject(buf);
  assert.equal(proj.objects.length, 2);
  assert.equal(proj.objects[0].instances.length, 2);
  assert.equal(proj.objects[1].instances.length, 1);
  proj.objects[0].instances.forEach((m, i) => closeTo(m, a[i]));
  closeTo(proj.objects[1].instances[0], b);
  assert.deepEqual(proj.buildOrder, [0, 0, 1]);
});

test('3MF reader treats an item without transform as identity', async () => {
  const JSZip = (await import('jszip')).default;
  const buf = await build3mf([{ name: 'cube', mesh: cube(20), transform: translate(10, 10, 0) }]);
  const zip = await JSZip.loadAsync(buf);
  const model = await zip.file('3D/3dmodel.model')!.async('string');
  zip.file('3D/3dmodel.model', model.replace(/\s+transform="[^"]*"/, ''));
  const stripped = await zip.generateAsync({ type: 'nodebuffer' });
  const proj = await read3mfProject(stripped);
  assert.equal(proj.objects[0].instances.length, 1);
  closeTo(proj.objects[0].instances[0], I);
});

test('3MF reader keeps identity instances for an object without build items', async () => {
  const buf = await build3mf([{ name: 'cube', mesh: cube(20), transform: I }]);
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buf);
  const model = await zip.file('3D/3dmodel.model')!.async('string');
  zip.file('3D/3dmodel.model', model.replace(/<build>[\s\S]*?<\/build>/, '<build></build>'));
  const proj = await read3mfProject(await zip.generateAsync({ type: 'nodebuffer' }));
  assert.deepEqual(proj.objects[0].instances, []);
  assert.deepEqual(proj.buildOrder, []);
});
