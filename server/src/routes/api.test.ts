import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSliceRequest } from './api.js';
import type { SliceRequest } from '../jobs.js';

const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const translate = (x: number): number[] => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1];

function request(overrides: Record<string, unknown> = {}): SliceRequest {
  return {
    objects: [{ modelId: '11111111-1111-1111-1111-111111111111', name: 'cube', transform: I, ...overrides }],
    print: { name: 'p', config: {} },
    printer: { name: 'pr', config: {} },
    filaments: [],
  } as SliceRequest;
}

test('validateSliceRequest accepts an object without instances', () => {
  assert.doesNotThrow(() => validateSliceRequest(request()));
});

test('validateSliceRequest accepts instances and syncs the legacy transform', () => {
  const req = request({ instances: [translate(10), translate(30)] });
  assert.doesNotThrow(() => validateSliceRequest(req));
  assert.deepEqual(req.objects[0].transform, translate(10));
});

test('validateSliceRequest rejects an empty instances array', () => {
  assert.throws(() => validateSliceRequest(request({ instances: [] })), /instances must have 1-1000 entries/);
});

test('validateSliceRequest rejects more than 1000 instances', () => {
  assert.throws(() => validateSliceRequest(request({ instances: Array.from({ length: 1001 }, () => I) })), /instances must have 1-1000 entries/);
});

test('validateSliceRequest accepts exactly 1000 instances', () => {
  assert.doesNotThrow(() => validateSliceRequest(request({ instances: Array.from({ length: 1000 }, (_, i) => translate(i)) })));
});

test('validateSliceRequest rejects an instance with 15 numbers', () => {
  assert.throws(() => validateSliceRequest(request({ instances: [I.slice(0, 15)] })), /every instance must be a transform/);
});

test('validateSliceRequest rejects NaN in an instance', () => {
  const bad = [...I];
  bad[12] = NaN;
  assert.throws(() => validateSliceRequest(request({ instances: [bad] })), /every instance must be a transform/);
});

test('validateSliceRequest rejects a non-numeric instance entry', () => {
  assert.throws(() => validateSliceRequest(request({ instances: [['a', ...I.slice(1)]] })), /every instance must be a transform/);
});

test('validateSliceRequest rejects NaN in the legacy transform', () => {
  assert.throws(() => validateSliceRequest(request({ transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, Number.POSITIVE_INFINITY, 0, 0, 1] })), /16 finite numbers/);
});

test('validateSliceRequest still rejects a missing transform', () => {
  assert.throws(() => validateSliceRequest(request({ transform: undefined })), /transform must have 16 entries/);
});
