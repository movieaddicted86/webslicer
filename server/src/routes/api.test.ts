/**
 * `validateSliceRequest` used to live in `routes/api.ts`, next to the route handlers that called it.
 * T-021 (R-9) moved it to the service layer (`services/slice.ts`), so this test now pins the service
 * boundary instead of the route module: the HTTP contract of the slice routes is covered by
 * `routes/http.test.ts`, which mounts the real app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSliceRequest } from '../services/slice.js';
import type { SliceRequest } from '@webslicer/shared';
import { IDENTITY, translate } from '@webslicer/shared';

const I = IDENTITY;

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
  const req = request({ instances: [translate(10, 0, 0), translate(30, 0, 0)] });
  assert.doesNotThrow(() => validateSliceRequest(req));
  assert.deepEqual(req.objects[0].transform, translate(10, 0, 0));
});

test('validateSliceRequest rejects an empty instances array', () => {
  assert.throws(() => validateSliceRequest(request({ instances: [] })), /instances must have 1-1000 entries/);
});

test('validateSliceRequest rejects more than 1000 instances', () => {
  assert.throws(
    () => validateSliceRequest(request({ instances: Array.from({ length: 1001 }, () => I) })),
    /instances must have 1-1000 entries/,
  );
});

test('validateSliceRequest accepts exactly 1000 instances', () => {
  assert.doesNotThrow(() => validateSliceRequest(request({ instances: Array.from({ length: 1000 }, (_, i) => translate(i, 0, 0)) })));
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
  assert.throws(
    () => validateSliceRequest(request({ transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, Number.POSITIVE_INFINITY, 0, 0, 1] })),
    /16 finite numbers/,
  );
});

test('validateSliceRequest still rejects a missing transform', () => {
  assert.throws(() => validateSliceRequest(request({ transform: undefined })), /transform must have 16 entries/);
});

test('validateSliceRequest still throws a plain Error, so the callers keep their own status (R-10 types this)', async () => {
  const { HttpError } = await import('../errors.js');
  let thrown: unknown;
  try {
    validateSliceRequest(request({ instances: [] }));
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown instanceof Error);
  assert.ok(!(thrown instanceof HttpError), 'not typed: /api/slice maps it to 400, /api/export/3mf falls through to 500');
});
