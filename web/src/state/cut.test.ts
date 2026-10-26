/**
 * The cut tool's races (N5): a cut request runs on the server while the plater stays editable, so
 * the store has to refuse a second cut, discard a result for an object that changed meanwhile, and
 * still keep the successful cut at one undo step.
 *
 * The store is the real one; only `fetch` is faked (`/api/cut` and the stored part meshes), and the
 * plater starts from a hand-built object, so the test needs neither presets nor a schema.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { instanceBounds, useStore } from './store';
import type { PlaterObject } from './types';

/** The cut requests the fake server received, and a gate the test opens when they may answer. */
const cutCalls: Array<Record<string, unknown>> = [];
let gate: Promise<void> = Promise.resolve();
let release: () => void = () => undefined;

/** Corners of a box standing on its own bed (X/Y centred, bottom at z = 0). */
function boxCorners(width: number, depth: number, height: number): Array<[number, number, number]> {
  const hx = width / 2;
  const hy = depth / 2;
  return [
    [-hx, -hy, 0],
    [hx, -hy, 0],
    [hx, hy, 0],
    [-hx, hy, 0],
    [-hx, -hy, height],
    [hx, -hy, height],
    [hx, hy, height],
    [-hx, hy, height],
  ];
}

/** The twelve triangles of a box over its eight corners. */
const BOX_FACES = [
  [0, 2, 1],
  [0, 3, 2],
  [4, 5, 6],
  [4, 6, 7],
  [0, 1, 5],
  [0, 5, 4],
  [1, 2, 6],
  [1, 6, 5],
  [2, 3, 7],
  [2, 7, 6],
  [3, 0, 4],
  [3, 4, 7],
];

/** A binary STL of a box, as `POST /api/cut` leaves the parts in the model directory. */
function boxStl(width: number, depth: number, height: number): ArrayBuffer {
  const corners = boxCorners(width, depth, height);
  const buf = new ArrayBuffer(84 + 50 * BOX_FACES.length);
  const view = new DataView(buf);
  view.setUint32(80, BOX_FACES.length, true);
  BOX_FACES.forEach((face, n) => {
    const at = 84 + 50 * n;
    face.forEach((idx, k) => {
      const p = corners[idx];
      for (let a = 0; a < 3; a++) view.setFloat32(at + 12 * k + 4 * a, p[a], true);
    });
  });
  return buf;
}

async function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const { pathname } = new URL(String(input), 'http://localhost');
  if (pathname === '/api/cut') {
    return new Response(
      JSON.stringify({
        upper: { modelId: 'upper', name: 'upper', position: [0, 0, 10] },
        lower: { modelId: 'lower', name: 'lower', position: [0, 0, 0] },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }
  // the halves of the 20 mm cube: an upper block standing on z = 10 and a lower one on the bed
  if (pathname === '/api/models/upper') return new Response(boxStl(20, 20, 10), { status: 200 });
  if (pathname === '/api/models/lower') return new Response(boxStl(20, 20, 10), { status: 200 });
  throw new Error(`unexpected request: ${pathname}`);
}

/** The object the tests cut: one 20 mm cube with an uploaded model, one instance at the origin. */
function cubeObject(): PlaterObject {
  return {
    id: 'obj-1',
    name: 'cube.stl',
    modelId: 'model-1',
    geometry: new THREE.BoxGeometry(20, 20, 20),
    instances: [{ id: 'inst-1', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }],
    size: [20, 20, 20],
    config: {},
    extruder: 0,
    visible: true,
    triangles: 12,
    volumes: [],
    ranges: [],
  };
}

beforeEach(() => {
  cutCalls.length = 0;
  gate = new Promise((r) => (release = r));
  (globalThis as { fetch: unknown }).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/api/cut')) cutCalls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    // hold the cut request until the test releases it, so "while it runs" is a real moment in time
    if (String(input).endsWith('/api/cut')) await gate;
    return fakeFetch(input);
  };
  useStore.setState({
    objects: [cubeObject()],
    selectedIds: ['obj-1'],
    selectedInstanceId: 'inst-1',
    selectedVolumeId: undefined,
    undoStack: [],
    redoStack: [],
    toasts: [],
    cutSettings: { z: 10, rotX: 0, rotY: 0, keep: 'both', placeOnCut: false, flipUpper: false },
  });
});

const st = () => useStore.getState();

test('N5: a second cut while the first runs does nothing', async () => {
  const first = st().cutSelection();
  assert.equal(st().cutBusy, true, 'the button is disabled while the request runs');
  // the user hits "Perform cut" again (or a shortcut fires): it must return without a second request
  await st().cutSelection();
  assert.equal(cutCalls.length, 1, 'only one request went out');
  release();
  await first;
  assert.equal(st().cutBusy, false, 'the flag drops after the request');
});

test('N5: a cut result for an object that changed meanwhile is discarded', async () => {
  const cutting = st().cutSelection();
  // the user drags the instance while the server cuts
  st().updateInstance('obj-1', 'inst-1', { position: [30, 0, 0] });
  release();
  await cutting;

  assert.equal(st().objects.length, 1, 'the cut parts are not added');
  assert.equal(st().objects[0].instances[0].position[0], 30, 'the moved instance stays');
  assert.equal(st().undoStack.length, 0, 'no history entry for a discarded cut');
  assert.equal(st().toasts[st().toasts.length - 1].text, 'Cut discarded: the object changed while cutting');
});

test('N5: a cut result for an object deleted meanwhile is discarded', async () => {
  const cutting = st().cutSelection();
  st().removeObjects(['obj-1']);
  release();
  await cutting;

  assert.deepEqual(st().objects, [], 'nothing is added back');
  assert.equal(st().toasts[st().toasts.length - 1].text, 'Cut discarded: the object changed while cutting');
});

test('N5: one undo after a successful cut restores the uncut object', async () => {
  const cutting = st().cutSelection();
  release();
  await cutting;

  assert.equal(st().objects.length, 2, 'both parts are on the plater');
  assert.equal(st().objects[0].name, 'cube.stl (upper)');
  st().undo();
  assert.equal(st().objects.length, 1, 'one undo brings the uncut object back');
  assert.equal(st().objects[0].id, 'obj-1');
  assert.equal(st().objects[0].instances[0].position[0], 0);
});

/** The world footprint of an object's first instance, read from its geometry and placement. */
function footprint(o: PlaterObject): { minX: number; maxX: number; minY: number; maxY: number } {
  const box = instanceBounds(o, o.instances[0]);
  return { minX: box.min.x, maxX: box.max.x, minY: box.min.y, maxY: box.max.y };
}

test('keep both: the two halves are placed apart and the other objects stay put', async () => {
  // a second object on the bed: the cut may not move it
  const other: PlaterObject = {
    ...cubeObject(),
    id: 'obj-2',
    name: 'other.stl',
    instances: [{ id: 'inst-2', position: [80, 40, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }],
  };
  useStore.setState({ objects: [cubeObject(), other] });

  const cutting = st().cutSelection();
  release();
  await cutting;

  const [a, b] = st().objects.filter((o) => o.id !== 'obj-2');
  assert.ok(a && b, 'both halves are on the plater');
  const fa = footprint(a);
  const fb = footprint(b);
  // the arrangement spacing of the default print profile is 6 mm: the halves have to be clear of
  // each other in at least one axis, so they cannot trigger the plate overlap check
  const clear =
    fa.maxX <= fb.minX - 6 + 1e-6 || fb.maxX <= fa.minX - 6 + 1e-6 || fa.maxY <= fb.minY - 6 + 1e-6 || fb.maxY <= fa.minY - 6 + 1e-6;
  assert.ok(clear, `the halves overlap: ${JSON.stringify([fa, fb])}`);
  // the other object has not moved
  const kept = st().objects.find((o) => o.id === 'obj-2');
  assert.deepEqual(kept?.instances[0].position, [80, 40, 0]);
  // every instance is on the bed
  for (const o of [a, b]) {
    const f = footprint(o);
    assert.ok(f.minX >= -1e-6 && f.maxX <= 200 + 1e-6 && f.minY >= -1e-6 && f.maxY <= 200 + 1e-6, `on the bed: ${JSON.stringify(f)}`);
  }
  assert.deepEqual(
    st().toasts.map((t) => t.text),
    ['Cut into two parts'],
  );
});

test('keep both: one undo takes the cut and its placement back in one step', async () => {
  const cutting = st().cutSelection();
  release();
  await cutting;
  assert.equal(st().objects.length, 2);
  st().undo();
  assert.equal(st().objects.length, 1);
  assert.deepEqual(st().objects[0].instances[0].position, [0, 0, 0], 'the uncut object is where it was');
});

test('keep both: when the halves do not fit, the placement stays and the user is told', async () => {
  // a bed of 1 mm: no arrangement can place two 20 mm halves on it – the cut still happens
  useStore.setState({ presets: { ...st().presets, printer: { ...st().presets.printer, current: { bed_shape: '0x0,1x0,1x1,0x1' } } } });
  const cutting = st().cutSelection();
  release();
  await cutting;

  assert.equal(st().objects.length, 2, 'the cut itself is not undone');
  for (const o of st().objects) assert.ok(o.name.includes('(upper)') || o.name.includes('(lower)'));
  assert.ok(
    st().toasts.some((t) => t.text === 'Cut: the two parts do not fit side by side – arrange them before slicing'),
    st()
      .toasts.map((t) => t.text)
      .join(' | '),
  );
});
