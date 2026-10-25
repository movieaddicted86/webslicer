/**
 * B6: the cancel toast. A cancelled job used to reach the browser as an SSE `error` event (the
 * events route replayed "cancelled" as an error), so cancelling showed a red "Slicing failed" toast.
 * Now the cancelled status is its own event and produces exactly one clear toast, and an error event
 * that still carries a cancelled job is not reported as a failure.
 *
 * The store is the real one; only `api.slice` and `api.jobEvents` are replaced, so the test drives the
 * same handler the browser runs.
 */
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { useStore } from './store';
import { api } from '../api';
import type { JobEvent, JobRecord } from '../api';

const realSlice = api.slice;
const realJobEvents = api.jobEvents;

/** The listener the store registered for the fake job stream, so the test can send events. */
let emit: ((ev: JobEvent) => void) | undefined;
let cancelCalls = 0;

function job(status: JobRecord['status'] = 'running'): JobRecord {
  return {
    id: 'job-1',
    status,
    createdAt: '2026-01-01T00:00:00.000Z',
    percent: 0,
    message: 'Slicing',
    outputName: 'cube.gcode',
    technology: 'FFF',
    presets: { print: 'p', filaments: [], printer: 'pr' },
    objectNames: ['cube'],
  };
}

const object = {
  id: 'a',
  name: 'a.stl',
  modelId: 'm-a',
  // a real geometry: the store's plate checks read the object's bounding box before it slices
  geometry: new THREE.BoxGeometry(10, 10, 10),
  size: [10, 10, 10] as [number, number, number],
  config: {},
  extruder: 0,
  visible: true,
  triangles: 12,
  instances: [
    {
      id: 'a-i',
      // the middle of the default 200 × 200 bed, so the default 1-loop skirt fits
      position: [100, 100, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
    },
  ],
  volumes: [],
  ranges: [],
};

const texts = () => useStore.getState().toasts.map((t) => `${t.kind}:${t.text}`);
const errors = () =>
  useStore
    .getState()
    .toasts.filter((t) => t.kind === 'error')
    .map((t) => t.text);

beforeEach(() => {
  emit = undefined;
  cancelCalls = 0;
  api.slice = async () => job();
  api.jobEvents = (_id, onEvent) => {
    emit = onEvent;
    return () => undefined;
  };
  api.cancelJob = async () => {
    cancelCalls++;
    return { ok: true };
  };
  useStore.setState({
    ready: true,
    objects: [object] as never,
    job: undefined,
    toasts: [],
    schema: undefined,
    binaryGcode: false,
  });
});

after(() => {
  api.slice = realSlice;
  api.jobEvents = realJobEvents;
});

test('B6: cancelling a job shows one toast, not "Slicing failed"', async () => {
  await useStore.getState().slice();
  assert.ok(emit, 'the store subscribed to the job events');

  await useStore.getState().cancelSlice();
  assert.equal(cancelCalls, 1, 'the cancel reached the server');

  // what the server sends now: a status event with the cancelled record, then the stream closes
  emit?.({ type: 'status', job: job('cancelled') });
  assert.equal(useStore.getState().job?.status, 'cancelled');
  assert.deepEqual(texts(), ['info:Slicing cancelled'], 'exactly one, informational toast');
  assert.deepEqual(errors(), []);
});

test('B6: an error event for a cancelled job is not reported as a failure', async () => {
  await useStore.getState().slice();
  emit?.({ type: 'error', message: 'Slicing was aborted', job: job('cancelled') });
  assert.deepEqual(errors(), [], 'a cancelled job is never a "Slicing failed" toast');
});

test('B6: a real failure still shows the error toast', async () => {
  await useStore.getState().slice();
  emit?.({ type: 'error', message: 'All objects are outside of the print volume.', job: job('error') });
  assert.deepEqual(errors(), ['Slicing failed: All objects are outside of the print volume.']);
});
