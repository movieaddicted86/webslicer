/**
 * Field rules of `validateSliceRequest`, one test per rule (R-10).
 *
 * This file was written **before** the validator was rewritten onto a zod schema: every case below
 * pins a message and the precedence between rules that `main` produces, so the rewrite cannot move a
 * message or let another rule win. The function keeps its contract – normalising in place, throwing a
 * plain `Error` – so these pins stay valid afterwards.
 *
 * Precedence is pinned deliberately as well, in the cases marked "(order)": the client shows the first
 * message, so which rule fires first is part of the contract.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSliceRequest } from './slice.js';
import type { SliceRequest } from '@webslicer/shared';
import { IDENTITY, translate } from '@webslicer/shared';

const I = IDENTITY;
const UUID = '11111111-1111-1111-1111-111111111111';

/** A request whose first object carries `overrides`, and whose top level carries the rest. */
function req(objectOverrides: Record<string, unknown> = {}, topOverrides: Record<string, unknown> = {}): SliceRequest {
  return {
    objects: [{ modelId: UUID, name: 'cube', transform: [...I], ...objectOverrides }],
    print: { name: 'p', config: {} },
    printer: { name: 'pr', config: {} },
    filaments: [],
    ...topOverrides,
  } as unknown as SliceRequest;
}

function messageOf(body: unknown): string {
  try {
    validateSliceRequest(body as SliceRequest);
  } catch (e) {
    return (e as Error).message;
  }
  return '<no error>';
}

/** `case name` -> the message the validator has to produce. */
const OBJECT_CASES: Array<[string, Record<string, unknown>, string]> = [
  ['modelId is not a uuid', { modelId: 'not-a-uuid' }, 'invalid modelId'],
  ['modelId is too short', { modelId: 'abc' }, 'invalid modelId'],
  ['transform is missing', { transform: undefined }, 'transform must have 16 entries'],
  ['transform has 15 entries', { transform: [...I].slice(0, 15) }, 'transform must have 16 entries'],
  ['transform is not an array', { transform: 'identity' }, 'transform must have 16 entries'],
  ['transform holds NaN', { transform: [...I.slice(0, 15), Number.NaN] }, 'transform must contain 16 finite numbers'],
  ['transform holds Infinity', { transform: [Number.POSITIVE_INFINITY, ...I.slice(1)] }, 'transform must contain 16 finite numbers'],
  ['transform holds a string', { transform: ['1', ...I.slice(1)] }, 'transform must contain 16 finite numbers'],
  ['instances are empty', { instances: [] }, 'instances must have 1-1000 entries'],
  ['instances are not an array', { instances: 'one' }, 'instances must have 1-1000 entries'],
  ['instances are more than 1000', { instances: Array.from({ length: 1001 }, () => [...I]) }, 'instances must have 1-1000 entries'],
  ['an instance has 15 entries', { instances: [[...I].slice(0, 15)] }, 'every instance must be a transform with 16 finite numbers'],
  ['an instance holds NaN', { instances: [[...I.slice(0, 15), Number.NaN]] }, 'every instance must be a transform with 16 finite numbers'],
  ['an instance is not an array', { instances: ['identity'] }, 'every instance must be a transform with 16 finite numbers'],
  ['supportPaint has a bad character', { supportPaint: '2' }, 'invalid supportPaint'],
  ['supportPaint is not a string', { supportPaint: 5 }, 'invalid supportPaint'],
  ['seamPaint has a bad character', { seamPaint: 'x' }, 'invalid seamPaint'],
  ['mmuPaint has a bad character', { mmuPaint: 'z' }, 'invalid mmuPaint'],
  ['mmuPaint is not a string', { mmuPaint: 7 }, 'invalid mmuPaint'],
  ['ranges are not an array', { ranges: 'none' }, 'invalid ranges'],
  ['ranges are more than 64', { ranges: Array.from({ length: 65 }, () => ({ minZ: 0, maxZ: 1, config: {} })) }, 'invalid ranges'],
  ['a range is inverted', { ranges: [{ minZ: 1, maxZ: 0, config: {} }] }, 'invalid range'],
  ['a range starts below the bed', { ranges: [{ minZ: -1, maxZ: 0, config: {} }] }, 'invalid range'],
  ['a range has a non-numeric height', { ranges: [{ minZ: '0', maxZ: 1, config: {} }] }, 'invalid range'],
  ['a range has no config', { ranges: [{ minZ: 0, maxZ: 1 }] }, 'range config required'],
  ['a range config is not an object', { ranges: [{ minZ: 0, maxZ: 1, config: 5 }] }, 'range config required'],
  ['layerProfile is not an array', { layerProfile: '0;0.2' }, 'invalid layerProfile'],
  ['layerProfile has an odd number of values', { layerProfile: [0, 0.2, 0.4] }, 'invalid layerProfile'],
  ['layerProfile holds a string', { layerProfile: [0, '0.2'] }, 'invalid layerProfile'],
  ['layerProfile holds NaN', { layerProfile: [0, Number.NaN] }, 'invalid layerProfile'],
  ['layerProfile is too long', { layerProfile: Array.from({ length: 40_002 }, (_, i) => i / 1000) }, 'invalid layerProfile'],
  ['a volume modelId is not a uuid', { volumes: [{ modelId: 'nope', transform: [...I], type: 'ModelPart' }] }, 'invalid volume modelId'],
  [
    'a volume transform has 15 entries',
    { volumes: [{ modelId: UUID, transform: [...I].slice(0, 15), type: 'ModelPart' }] },
    'volume transform must have 16 entries',
  ],
  [
    'a volume transform holds NaN',
    { volumes: [{ modelId: UUID, transform: [...I.slice(0, 15), Number.NaN], type: 'ModelPart' }] },
    'volume transform must have 16 entries',
  ],
  ['a volume type is unknown', { volumes: [{ modelId: UUID, transform: [...I], type: 'Nope' }] }, 'invalid volume type Nope'],
];

const TOP_CASES: Array<[string, Record<string, unknown>, string]> = [
  ['customGcodes are not an array', { customGcodes: 'none' }, 'at most 500 custom G-codes'],
  [
    'customGcodes are more than 500',
    { customGcodes: Array.from({ length: 501 }, () => ({ printZ: 1, type: 'pause' })) },
    'at most 500 custom G-codes',
  ],
  ['a custom G-code height is 0', { customGcodes: [{ printZ: 0, type: 'pause' }] }, 'invalid custom G-code height'],
  ['a custom G-code height is NaN', { customGcodes: [{ printZ: Number.NaN, type: 'pause' }] }, 'invalid custom G-code height'],
  [
    'a custom G-code height is Infinity',
    { customGcodes: [{ printZ: Number.POSITIVE_INFINITY, type: 'pause' }] },
    'invalid custom G-code height',
  ],
  ['a custom G-code type is unknown', { customGcodes: [{ printZ: 1, type: 'nope' }] }, 'invalid custom G-code type nope'],
  [
    'a custom G-code colour is not a hex colour',
    { customGcodes: [{ printZ: 1, type: 'pause', color: 'red' }] },
    'invalid custom G-code colour',
  ],
  ['a custom G-code text is not a string', { customGcodes: [{ printZ: 1, type: 'pause', extra: 5 }] }, 'invalid custom G-code text'],
  ['a custom G-code extruder is 0', { customGcodes: [{ printZ: 1, type: 'pause', extruder: 0 }] }, 'invalid custom G-code extruder'],
  ['a custom G-code extruder is 1.5', { customGcodes: [{ printZ: 1, type: 'pause', extruder: 1.5 }] }, 'invalid custom G-code extruder'],
  ['a custom G-code extruder is 17', { customGcodes: [{ printZ: 1, type: 'pause', extruder: 17 }] }, 'invalid custom G-code extruder'],
  ['thumbnails are not an array', { thumbnails: 'none' }, 'at most 8 thumbnails'],
  [
    'thumbnails are more than 8',
    { thumbnails: Array.from({ length: 9 }, () => ({ format: 'PNG', width: 1, height: 1, data: '' })) },
    'at most 8 thumbnails',
  ],
  ['a thumbnail format is unknown', { thumbnails: [{ format: 'GIF', width: 1, height: 1, data: '' }] }, 'invalid thumbnail format'],
  ['a thumbnail width is 0', { thumbnails: [{ format: 'PNG', width: 0, height: 1, data: '' }] }, 'invalid thumbnail size'],
  ['a thumbnail width is 1.5', { thumbnails: [{ format: 'PNG', width: 1.5, height: 1, data: '' }] }, 'invalid thumbnail size'],
  ['a thumbnail height is too large', { thumbnails: [{ format: 'PNG', width: 1, height: 2001, data: '' }] }, 'invalid thumbnail size'],
  ['a thumbnail data has a bad character', { thumbnails: [{ format: 'PNG', width: 1, height: 1, data: '!!' }] }, 'invalid thumbnail data'],
];

test('the slice request rules report exactly the message of `main`', () => {
  for (const [name, overrides, message] of OBJECT_CASES) {
    assert.equal(messageOf(req(overrides)), message, `object: ${name}`);
  }
  for (const [name, overrides, message] of TOP_CASES) {
    assert.equal(messageOf(req({}, overrides)), message, `top level: ${name}`);
  }
});

test('the body itself has to be an object', () => {
  for (const body of [undefined, null, 5, 'request', true]) {
    assert.equal(messageOf(body), 'body required', JSON.stringify(body));
  }
});

test('objects are required and have to be an array', () => {
  for (const objects of [undefined, 'one', [], 5]) {
    assert.equal(messageOf({ objects, print: {}, printer: {} }), 'at least one object required', JSON.stringify(objects));
  }
});

test('print and printer both need a config', () => {
  const ok = { objects: [{ modelId: UUID, transform: [...I] }] };
  assert.equal(messageOf({ ...ok, printer: { config: {} } }), 'print and printer config required');
  assert.equal(messageOf({ ...ok, print: { config: {} } }), 'print and printer config required');
  assert.equal(messageOf({ ...ok, print: { config: {} }, printer: { config: null } }), 'print and printer config required');
  // an empty array is an object for this check, as it was on `main`
  assert.equal(messageOf({ ...ok, print: { config: [] }, printer: { config: {} } }), '<no error>');
});

// ---------------------------------------------------------------------------
// precedence – which rule wins when several are broken
// ---------------------------------------------------------------------------

test('the object rules run in the order of `main` (order)', () => {
  // modelId before transform before instances
  assert.equal(messageOf(req({ modelId: 'nope', transform: [1], instances: [] })), 'invalid modelId');
  assert.equal(messageOf(req({ transform: [1], instances: [] })), 'transform must have 16 entries');
  // a broken legacy transform is not checked when instances are present
  assert.equal(messageOf(req({ transform: [...I.slice(0, 15), Number.NaN], instances: [[...I]] })), '<no error>');
  // supportPaint before mmuPaint before ranges before volumes
  assert.equal(messageOf(req({ supportPaint: 'x', mmuPaint: 'z' })), 'invalid supportPaint');
  assert.equal(messageOf(req({ mmuPaint: 'z', ranges: 'none' })), 'invalid mmuPaint');
  assert.equal(messageOf(req({ ranges: 'none', volumes: 5 })), 'invalid ranges');
  // ranges in order: the range before its config
  assert.equal(messageOf(req({ ranges: [{ minZ: 1, maxZ: 0 }] })), 'invalid range');
});

test('the top-level rules run in the order of `main` (order)', () => {
  assert.equal(messageOf({ objects: [], print: {}, printer: {} }), 'at least one object required');
  assert.equal(messageOf(req({ modelId: 'nope' }, { print: undefined })), 'invalid modelId');
  assert.equal(messageOf(req({}, { print: undefined, customGcodes: [{ printZ: 0, type: 'pause' }] })), 'print and printer config required');
  assert.equal(
    messageOf(req({}, { customGcodes: [{ printZ: 0, type: 'pause' }], thumbnails: [{ format: 'GIF', width: 1, height: 1, data: '' }] })),
    'invalid custom G-code height',
  );
  // a custom G-code's own fields in order: height before type before colour before text before extruder
  assert.equal(
    messageOf(req({}, { customGcodes: [{ printZ: 1, type: 'nope', color: 'red', extra: 5, extruder: 0 }] })),
    'invalid custom G-code type nope',
  );
  assert.equal(
    messageOf(req({}, { customGcodes: [{ printZ: 1, type: 'pause', color: 'red', extra: 5, extruder: 0 }] })),
    'invalid custom G-code colour',
  );
  assert.equal(messageOf(req({}, { customGcodes: [{ printZ: 1, type: 'pause', extra: 5, extruder: 0 }] })), 'invalid custom G-code text');
  assert.equal(messageOf(req({}, { customGcodes: [{ printZ: 1, type: 'pause', extruder: 0 }] })), 'invalid custom G-code extruder');
  // a thumbnail's fields in order: format before size before data
  assert.equal(messageOf(req({}, { thumbnails: [{ format: 'GIF', width: 0, height: 1, data: '!!' }] })), 'invalid thumbnail format');
  assert.equal(messageOf(req({}, { thumbnails: [{ format: 'PNG', width: 0, height: 1, data: '!!' }] })), 'invalid thumbnail size');
});

// ---------------------------------------------------------------------------
// values that are accepted, and the two normalisations
// ---------------------------------------------------------------------------

test('a full valid request passes', () => {
  const body = req(
    {
      instances: [translate(10, 0, 0), translate(30, 0, 0)],
      supportPaint: '0408',
      seamPaint: '0',
      mmuPaint: 'a0f',
      ranges: [{ minZ: 0, maxZ: 10, config: { layer_height: '0.2' } }],
      volumes: [{ modelId: UUID, transform: [...I], type: 'ModelPart', config: {}, extruder: 1 }],
      config: { layer_height: '0.2' },
      extruder: 1,
    },
    {
      outputName: 'cube',
      binaryGcode: true,
      filaments: [{ name: 'f', config: {} }],
      customGcodes: [{ printZ: 1.2, type: 'pause', color: '#ff0000', extra: 'M600', extruder: 1 }],
      thumbnails: [{ format: 'PNG', width: 16, height: 16, data: 'AAAA' }],
    },
  );
  assert.doesNotThrow(() => validateSliceRequest(body));
});

test('the limits are inclusive', () => {
  assert.doesNotThrow(() => validateSliceRequest(req({ instances: Array.from({ length: 1000 }, (_, i) => translate(i, 0, 0)) })));
  assert.doesNotThrow(() =>
    validateSliceRequest(req({ ranges: Array.from({ length: 64 }, (_, i) => ({ minZ: i, maxZ: i + 1, config: {} })) })),
  );
  assert.doesNotThrow(() =>
    validateSliceRequest(req({}, { customGcodes: Array.from({ length: 500 }, () => ({ printZ: 1, type: 'pause' })) })),
  );
  assert.doesNotThrow(() =>
    validateSliceRequest(
      req({}, { thumbnails: Array.from({ length: 8 }, () => ({ format: 'QOI', width: 2000, height: 2000, data: '' })) }),
    ),
  );
  assert.doesNotThrow(() => validateSliceRequest(req({}, { customGcodes: [{ printZ: 1, type: 'pause', extruder: 16 }] })));
});

test('instances overwrite the legacy transform, a missing filaments list becomes an array', () => {
  const body = req({ instances: [translate(10, 0, 0), translate(30, 0, 0)] });
  validateSliceRequest(body);
  assert.deepEqual(body.objects[0].transform, translate(10, 0, 0));

  const noFilaments = { objects: [{ modelId: UUID, transform: [...I] }], print: { config: {} }, printer: { config: {} } };
  validateSliceRequest(noFilaments as unknown as SliceRequest);
  assert.deepEqual((noFilaments as unknown as SliceRequest).filaments, []);

  // a filaments value that is not an array is replaced, not rejected
  const badFilaments = req({}, { filaments: 'one' });
  validateSliceRequest(badFilaments);
  assert.deepEqual(badFilaments.filaments, []);
});

test('unknown fields of the body survive the check', () => {
  const body = req({ unknownObjectField: 1 }, { unknownTopField: 'kept', outputName: 'x' });
  validateSliceRequest(body);
  assert.equal((body.objects[0] as unknown as Record<string, unknown>).unknownObjectField, 1);
  assert.equal((body as unknown as Record<string, unknown>).unknownTopField, 'kept');
  assert.equal(body.outputName, 'x');
});

// ---------------------------------------------------------------------------
// the cases the old hand-written checks crashed on
// ---------------------------------------------------------------------------

/**
 * The old loop read `o.modelId` before it checked anything, so a non-object element threw a
 * `TypeError` – a 500 on every route that maps validation. The schema reports the field rule instead:
 * one more corrupted body that becomes a 400, which is what the routes were always meant to answer.
 */
test('an element that is not an object is reported as a field error, not a crash', () => {
  assert.equal(messageOf(req({}, { objects: [null] })), 'invalid modelId');
  assert.equal(messageOf(req({ volumes: [null] })), 'invalid volume modelId');
  assert.equal(messageOf(req({ ranges: ['x'] })), 'invalid range');
  assert.equal(messageOf(req({}, { customGcodes: [null] })), 'invalid custom G-code height');
  assert.equal(messageOf(req({}, { thumbnails: [null] })), 'invalid thumbnail format');
});

test('a volumes value that is not an array is rejected', () => {
  // `main` iterated the field directly, so a non-iterable threw a TypeError; the schema names it
  for (const volumes of ['x', 1, true, {}]) {
    assert.equal(messageOf(req({ volumes })), 'invalid volumes', JSON.stringify(volumes));
  }
  // falsy values stay "no volumes", as they were
  for (const volumes of [undefined, null, 0]) {
    assert.equal(messageOf(req({ volumes })), '<no error>', String(volumes));
  }
});

test('an infinite range height stays accepted, as it was', () => {
  // the old condition was `typeof minZ !== 'number' || typeof maxZ !== 'number' || !(maxZ > minZ) ||
  // minZ < 0` – `Infinity` passes all four, and a refactoring must not turn that into a 400
  assert.equal(messageOf(req({ ranges: [{ minZ: 0, maxZ: Number.POSITIVE_INFINITY, config: {} }] })), '<no error>');
});
