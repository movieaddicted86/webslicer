/**
 * The slice guard of the store: the one seam every path into a slice goes through (the Prepare
 * footer, the Preview's own button, the re-slice after a colour change, scripted callers).
 *
 * The three tests pin what the guard is for: a blocking plate issue and a blocking configuration limit
 * each keep `api.slice` from being called at all, and a warning does not. The store is the real one;
 * only `api.slice` and `api.jobEvents` are replaced.
 */
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { useStore } from './store';
import { api } from '../api';
import type { JobEvent, JobRecord, PresetType } from '../api';

const realSlice = api.slice;
const realJobEvents = api.jobEvents;

let sliceCalls = 0;
let emit: ((ev: JobEvent) => void) | undefined;

function job(): JobRecord {
  return {
    id: 'job-1',
    status: 'queued',
    createdAt: '2026-01-01T00:00:00.000Z',
    percent: 0,
    message: 'Queued',
    outputName: 'cube.gcode',
    technology: 'FFF',
    presets: { print: 'p', filaments: [], printer: 'pr' },
    objectNames: ['cube'],
  };
}

/** A 10 mm cube on the default 200 × 200 bed; `x` moves it, the default skirt then runs off the bed. */
function cube(x = 100) {
  return {
    id: 'a',
    name: 'cube.stl',
    modelId: 'm-a',
    geometry: new THREE.BoxGeometry(10, 10, 10),
    size: [10, 10, 10] as [number, number, number],
    config: {},
    extruder: 0,
    visible: true,
    triangles: 12,
    instances: [
      {
        id: 'a-i',
        position: [x, 100, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
      },
    ],
    volumes: [],
    ranges: [],
  };
}

function slot(name: string, config: Record<string, string> = {}) {
  return { name, saved: { ...config }, current: { ...config }, system: true };
}

/** The presets the guard reads: the default 200 × 200 bed and an optional print/filament config. */
function presets(print: Record<string, string> = {}, filament: Record<string, string> = {}) {
  return {
    print: slot('p', print),
    printer: slot('pr'),
    filament: [slot('f', filament)],
  } as unknown as Record<PresetType, never>;
}

const errors = () =>
  useStore
    .getState()
    .toasts.filter((t) => t.kind === 'error')
    .map((t) => t.text);

beforeEach(() => {
  sliceCalls = 0;
  emit = undefined;
  api.slice = async () => {
    sliceCalls++;
    return job();
  };
  api.jobEvents = (_id, onEvent) => {
    emit = onEvent;
    return () => undefined;
  };
  useStore.setState({
    ready: true,
    objects: [cube()] as never,
    job: undefined,
    toasts: [],
    schema: undefined,
    binaryGcode: false,
    presets: presets() as never,
  });
});

after(() => {
  api.slice = realSlice;
  api.jobEvents = realJobEvents;
});

test('a blocking plate issue stops the slice before a request is made', async () => {
  // the cube at the left edge: the object fits, the default 1-loop skirt does not
  useStore.setState({ objects: [cube(6)] as never });

  await useStore.getState().slice();

  assert.equal(sliceCalls, 0, 'no request reached the server');
  assert.equal(useStore.getState().job, undefined, 'the result on screen is untouched');
  assert.equal(errors().length, 1);
  assert.match(errors()[0], /skirt .* outside the print volume/);
});

test('a blocking configuration limit stops the slice before a request is made', async () => {
  // 2150 °C is far outside the global window, whatever the plate looks like
  useStore.setState({ presets: presets({}, { temperature: '2150', filament_type: 'PLA' }) as never });

  await useStore.getState().slice();

  assert.equal(sliceCalls, 0, 'no request reached the server');
  assert.equal(useStore.getState().job, undefined);
  assert.equal(errors().length, 1);
  assert.match(errors()[0], /temperature = 2150/);
});

test('a warning does not stop the slice: the plate passes and the request goes out', async () => {
  // 265 °C is unusual for PLA – a soft-range warning, not a block
  useStore.setState({ presets: presets({}, { temperature: '265', filament_type: 'PLA' }) as never });

  await useStore.getState().slice();

  assert.equal(sliceCalls, 1, 'the warning did not block the slice');
  assert.deepEqual(errors(), []);
  assert.ok(emit, 'the store subscribed to the job events');
});
