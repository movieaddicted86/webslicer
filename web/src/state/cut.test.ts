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
import { useStore } from './store';
import type { PlaterObject } from './types';

/** The cut requests the fake server received, and a gate the test opens when they may answer. */
const cutCalls: Array<Record<string, unknown>> = [];
let gate: Promise<void> = Promise.resolve();
let release: () => void = () => undefined;

/** A one-triangle binary STL, as `POST /api/cut` leaves the parts in the model directory. */
function binaryStl(): ArrayBuffer {
  const buf = new ArrayBuffer(84 + 50);
  const view = new DataView(buf);
  view.setUint32(80, 1, true);
  const at = 84;
  for (let i = 0; i < 3; i++) view.setFloat32(at + 12 * i, i * 10, true);
  return buf;
}

async function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const { pathname } = new URL(String(input), 'http://localhost');
  if (pathname === '/api/cut') {
    return new Response(
      JSON.stringify({
        upper: { modelId: 'upper', name: 'upper', position: [0, 0, 5] },
        lower: { modelId: 'lower', name: 'lower', position: [0, 0, 0] },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (pathname.startsWith('/api/models/')) return new Response(binaryStl(), { status: 200 });
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
