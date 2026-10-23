/**
 * T-044: the cut service, with the slicer CLI mocked (`SlicerRunner`).
 *
 * The fake CLI behaves like PrusaSlicer's `--cut`: it reads the input STL, cuts at the `--cut`
 * height (counted from the mesh's lowest point) and writes a 3MF with the upper part first and the
 * lower part second – the upper object keeps the height it had in the input, the lower one stands on
 * z = 0 (which the server undoes with the input's lowest point). A single untouched object comes
 * back when the plane misses the material. The tests pin the maths around the CLI: the plane's
 * height, the instance transform, the tilted plane, the two options, the kept side, and that no temp
 * file survives.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-cut-'));
process.env.DATA_DIR = DATA_DIR;
process.env.LIBRARY_DIR = path.join(DATA_DIR, 'library');

const { config, ensureDirs } = await import('../config.js');
const { cutMesh, cutFailureLine, cutTimeoutMs, placePart } = await import('./cut.js');
const { build3mf, parseStl, transformMesh, writeBinaryStl } = await import('./threemf/index.js');
const { HttpError } = await import('../errors.js');
const { planeFrame, soupBounds, translate } = await import('@webslicer/shared');
import type { SlicerRunner } from './cut.js';
import type { Mesh } from './threemf/index.js';

ensureDirs();
after(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

/** A closed box with outward faces. */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Mesh {
  const v = [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1];
  const f = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  return { vertices: Float32Array.from(v), indices: Uint32Array.from(f) };
}

const CUBE = (s = 20) => box(0, 0, 0, s, s, s);
const ITEM = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * A fake CLI: cuts the input's bounding box at `--cut`, writing the upper part (which keeps its
 * height) first and the lower part (standing on 0) second, or one whole object when the plane misses.
 */
function fakeCut(): SlicerRunner {
  return async (args) => {
    const out = args[args.indexOf('--output') + 1] as string;
    const input = args[args.length - 1];
    const cut = Number(args[args.indexOf('--cut') + 1]);
    const b = soupBounds(parseStl(fs.readFileSync(input)).vertices);
    const height = b.max[2] - b.min[2];
    const [x0, y0, x1, y1] = [b.min[0], b.min[1], b.max[0], b.max[1]];
    const objects =
      cut > 0 && cut < height
        ? [
            { name: 'upper', mesh: box(x0, y0, cut, x1, y1, height), transform: ITEM },
            { name: 'lower', mesh: box(x0, y0, 0, x1, y1, cut), transform: ITEM },
          ]
        : [{ name: 'all', mesh: box(x0, y0, 0, x1, y1, height), transform: ITEM }];
    fs.writeFileSync(out, await build3mf(objects));
    return { code: 0, stdout: '', stderr: '', signal: null };
  };
}

/** Everything left in the cut cache – the temp dirs the module created. */
function leftovers(): string[] {
  try {
    return fs.readdirSync(path.join(config.cacheDir, 'cut'));
  } catch {
    return [];
  }
}

/** A part back in the world: its own-coordinate mesh moved to its reported position. */
function worldMesh(part: { mesh: Mesh; position: number[] }): Mesh {
  return transformMesh(part.mesh, translate(part.position[0], part.position[1], part.position[2]));
}

/** The world bounds of a part. */
const world = (part: { mesh: Mesh; position: number[] }) => soupBounds(worldMesh(part).vertices);

test('a level cut at the middle gives an upper and a lower part where the cube was', async () => {
  const { parts } = await cutMesh({ mesh: CUBE(), transform: ITEM, point: [10, 10, 10], normal: [0, 0, 1] }, { run: fakeCut() });
  assert.equal(parts.length, 2);
  const upper = parts.find((p) => p.side === 'upper')!;
  const lower = parts.find((p) => p.side === 'lower')!;
  const ub = world(upper);
  const lb = world(lower);
  // the cut is at z = 10 and the parts stay where they were (no placement, no flip)
  assert.ok(Math.abs(ub.min[2] - 10) < 1e-6, `upper min ${ub.min[2]}`);
  assert.ok(Math.abs(ub.max[2] - 20) < 1e-6, `upper max ${ub.max[2]}`);
  assert.ok(Math.abs(lb.min[2]) < 1e-6, `lower min ${lb.min[2]}`);
  assert.ok(Math.abs(lb.max[2] - 10) < 1e-6, `lower max ${lb.max[2]}`);
  assert.deepEqual(ub.min.slice(0, 2), [0, 0]);
  assert.deepEqual(lb.max.slice(0, 2), [20, 20]);
  // stored in their own coordinates: X/Y centred, bottom at 0, and the position says where they go
  for (const [part, z] of [
    [upper, 10],
    [lower, 0],
  ] as const) {
    const b = soupBounds(part.mesh.vertices);
    assert.ok(Math.abs(b.min[0] + 10) < 1e-6 && Math.abs(b.max[0] - 10) < 1e-6, 'centred in X');
    assert.ok(Math.abs(b.min[1] + 10) < 1e-6 && Math.abs(b.max[1] - 10) < 1e-6, 'centred in Y');
    assert.ok(Math.abs(b.min[2]) < 1e-6, 'bottom at 0');
    assert.deepEqual(part.position, [10, 10, z]);
  }
  assert.deepEqual(leftovers(), [], 'the temp directory was removed');
});

test('the cut follows the instance transform', async () => {
  // the cube lifted 50 mm: the user's plane at z = 60 cuts it in the middle, and the parts stay lifted
  const { parts } = await cutMesh(
    { mesh: CUBE(), transform: translate(0, 0, 50), point: [10, 10, 60], normal: [0, 0, 1] },
    { run: fakeCut() },
  );
  const ub = world(parts.find((p) => p.side === 'upper')!);
  const lb = world(parts.find((p) => p.side === 'lower')!);
  assert.ok(Math.abs(ub.min[2] - 60) < 1e-4, `upper min ${ub.min[2]}`);
  assert.ok(Math.abs(ub.max[2] - 70) < 1e-4, `upper max ${ub.max[2]}`);
  assert.ok(Math.abs(lb.min[2] - 50) < 1e-4, `lower min ${lb.min[2]}`);
  assert.ok(Math.abs(lb.max[2] - 60) < 1e-4, `lower max ${lb.max[2]}`);
});

test('a tilted plane cuts in its frame and the parts come back to the world', async () => {
  const rad = Math.PI / 6;
  const point: [number, number, number] = [10, 10, 10];
  const normal: [number, number, number] = [0, -Math.sin(rad), Math.cos(rad)];
  const frame = planeFrame({ point, normal })!;
  const { parts } = await cutMesh({ mesh: CUBE(), transform: ITEM, point, normal }, { run: fakeCut() });
  assert.deepEqual(parts.map((p) => p.side).sort(), ['lower', 'upper']);

  // framed again, each returned part must be the half the fake CLI cut from the framed cube: the
  // upper one above the plane height, the lower one below it, both over the framed cube's footprint
  const framed = soupBounds(transformMesh(CUBE(), frame.rotation).vertices);
  const cutZ = frame.planeZ - framed.min[2];
  const minZ = framed.min[2];
  for (const p of parts) {
    const b = soupBounds(transformMesh(worldMesh(p), frame.rotation).vertices);
    // the CLI exported the lower part standing on 0; the service puts the frame's floor back
    const zr = p.side === 'upper' ? [cutZ + minZ, framed.max[2]] : [minZ, cutZ + minZ];
    assert.ok(Math.abs(b.min[0] - framed.min[0]) < 1e-4 && Math.abs(b.max[0] - framed.max[0]) < 1e-4, `${p.side} X`);
    assert.ok(Math.abs(b.min[1] - framed.min[1]) < 1e-4 && Math.abs(b.max[1] - framed.max[1]) < 1e-4, `${p.side} Y`);
    assert.ok(Math.abs(b.min[2] - zr[0]) < 1e-4, `${p.side} min z ${b.min[2]} vs ${zr[0]}`);
    assert.ok(Math.abs(b.max[2] - zr[1]) < 1e-4, `${p.side} max z ${b.max[2]} vs ${zr[1]}`);
  }
});

test('keep upper and keep lower return one part only', async () => {
  const upper = await cutMesh({ mesh: CUBE(), transform: ITEM, point: [10, 10, 10], normal: [0, 0, 1], keep: 'upper' }, { run: fakeCut() });
  assert.deepEqual(
    upper.parts.map((p) => p.side),
    ['upper'],
  );
  const lower = await cutMesh({ mesh: CUBE(), transform: ITEM, point: [10, 10, 10], normal: [0, 0, 1], keep: 'lower' }, { run: fakeCut() });
  assert.deepEqual(
    lower.parts.map((p) => p.side),
    ['lower'],
  );
});

test('place on cut stands each part on the bed, flip upper turns the upper part over', async () => {
  const placed = await cutMesh(
    { mesh: CUBE(), transform: ITEM, point: [10, 10, 10], normal: [0, 0, 1], placeOnCut: true },
    { run: fakeCut() },
  );
  for (const p of placed.parts) {
    const b = world(p);
    assert.ok(Math.abs(b.min[2]) < 1e-6, `${p.side} stands on the bed (min ${b.min[2]})`);
    assert.ok(Math.abs(b.max[2] - 10) < 1e-6, `${p.side} is a 10 mm half`);
  }

  const flipped = await cutMesh(
    { mesh: CUBE(), transform: ITEM, point: [10, 10, 10], normal: [0, 0, 1], flipUpper: true },
    { run: fakeCut() },
  );
  const fu = world(flipped.parts.find((p) => p.side === 'upper')!);
  // turned about the plane: 10…20 becomes 10…0 (the cut face stays on the plane)
  assert.ok(Math.abs(fu.min[2]) < 1e-6, `flipped upper min ${fu.min[2]}`);
  assert.ok(Math.abs(fu.max[2] - 10) < 1e-6, `flipped upper max ${fu.max[2]}`);
  const fb = world(flipped.parts.find((p) => p.side === 'lower')!);
  assert.ok(Math.abs(fb.min[2]) < 1e-6 && Math.abs(fb.max[2] - 10) < 1e-6, 'the lower part is untouched');
});

test('a plane outside the material leaves the object whole, named by the side', async () => {
  const above = await cutMesh({ mesh: CUBE(), transform: ITEM, point: [10, 10, 50], normal: [0, 0, 1] }, { run: fakeCut() });
  assert.deepEqual(
    above.parts.map((p) => p.side),
    ['lower'],
    'nothing above the plane, so the material is the lower part',
  );
  assert.ok(Math.abs(world(above.parts[0]).max[2] - 20) < 1e-6);
  const below = await cutMesh({ mesh: CUBE(), transform: ITEM, point: [10, 10, -5], normal: [0, 0, 1] }, { run: fakeCut() });
  assert.deepEqual(
    below.parts.map((p) => p.side),
    ['upper'],
  );
});

test('a failing CLI run is a 400 naming the first relevant log line', async () => {
  const run: SlicerRunner = async () => ({
    code: 1,
    stdout: '',
    stderr: '\u001b[31;1m**** ERR Cut : the mesh is not manifold ****\u001b[0m\n',
    signal: null,
  });
  const err = await cutMesh({ mesh: CUBE(), transform: ITEM, point: [10, 10, 10], normal: [0, 0, 1] }, { run }).then(
    () => undefined,
    (e: unknown) => e,
  );
  assert.ok(err instanceof HttpError);
  assert.equal(err.status, 400);
  assert.equal(err.message, 'cannot cut: ERR Cut : the mesh is not manifold');
  assert.ok(!err.message.includes(String.fromCharCode(27)), 'the colour escapes are stripped');
  assert.deepEqual(leftovers(), [], 'nothing is left behind after a failed cut');
});

test('a run that writes no 3MF is a 400 too', async () => {
  const run: SlicerRunner = async () => ({ code: 0, stdout: 'File exported', stderr: '', signal: null });
  await assert.rejects(
    cutMesh({ mesh: CUBE(), transform: ITEM, point: [10, 10, 10], normal: [0, 0, 1] }, { run }),
    (e: Error) => e instanceof HttpError && e.status === 400 && /File exported/.test(e.message),
  );
  assert.deepEqual(leftovers(), []);
});

test('a plane without direction is refused before the CLI runs', async () => {
  let ran = false;
  const run: SlicerRunner = async () => {
    ran = true;
    return { code: 0, stdout: '', stderr: '', signal: null };
  };
  await assert.rejects(
    cutMesh({ mesh: CUBE(), transform: ITEM, point: [0, 0, 0], normal: [0, 0, 0] }, { run }),
    (e: Error) => e instanceof HttpError && e.status === 400 && /no direction/.test(e.message),
  );
  assert.equal(ran, false);
});

test('the timeout message and placePart keep their contract', () => {
  assert.equal(cutFailureLine({ code: null, stdout: '', stderr: '', signal: 'SIGKILL' }, 2000), 'the cut timed out after 2 s');
  assert.ok(cutTimeoutMs() > 0);
  // a part that already stands on the plane, without options: the mesh comes back unchanged
  const mesh = box(0, 0, 10, 20, 20, 20);
  const frame = { rotation: ITEM as typeof ITEM & number[], planeZ: 10 };
  const out = placePart({ side: 'upper', mesh }, frame);
  assert.deepEqual([...out.vertices], [...mesh.vertices]);
  // turned about the plane, the cut face stays at z = 10 and the material goes down to 0
  const flipped = placePart({ side: 'upper', mesh }, frame, { flipUpper: true });
  const b = soupBounds(flipped.vertices);
  assert.ok(Math.abs(b.min[2]) < 1e-6 && Math.abs(b.max[2] - 10) < 1e-6, `flipped ${b.min[2]}…${b.max[2]}`);
});

test('the binary STL of a part is readable again (round trip to the model store)', async () => {
  const { parts } = await cutMesh({ mesh: CUBE(), transform: ITEM, point: [10, 10, 10], normal: [0, 0, 1] }, { run: fakeCut() });
  const file = path.join(DATA_DIR, 'part.stl');
  fs.writeFileSync(file, writeBinaryStl(parts[0].mesh));
  const again = parseStl(fs.readFileSync(file));
  assert.equal(again.indices.length, parts[0].mesh.indices.length);
});
