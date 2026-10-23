/**
 * T-044: `POST /api/cut` as a zod schema.
 *
 * The messages pinned here are the API contract: the route answers a refused body with 400 and the
 * message of the first issue, so these strings reach the client unchanged. The schema is loose, so a
 * client that sends the object's own fields along with the cut is not refused.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CUT_KEEP_VALUES, cutRequestSchema, parseCutRequest } from './cut.js';

const UUID = '11111111-1111-1111-1111-111111111111';
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const body = (over: Record<string, unknown> = {}) => ({
  modelId: UUID,
  transform: IDENTITY,
  plane: { point: [0, 0, 10], normal: [0, 0, 1] },
  ...over,
});
const messageOf = (r: { ok: boolean; message?: string }): string => (r.ok ? '<no error>' : String(r.message));

test('a complete request is accepted, with both parts kept by default', () => {
  const parsed = parseCutRequest(body());
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.request.modelId, UUID);
  assert.deepEqual(parsed.request.transform, IDENTITY);
  assert.deepEqual(parsed.request.plane, { point: [0, 0, 10], normal: [0, 0, 1] });
  assert.equal(parsed.request.keep, 'both');
  assert.equal(parsed.request.placeOnCut, undefined);
  assert.equal(parsed.request.flipUpper, undefined);
});

test('the keep options and the two flags are passed through', () => {
  for (const keep of CUT_KEEP_VALUES) {
    const parsed = parseCutRequest(body({ keep, placeOnCut: true, flipUpper: true }));
    assert.equal(parsed.ok, true, keep);
    if (!parsed.ok) continue;
    assert.equal(parsed.request.keep, keep);
    assert.equal(parsed.request.placeOnCut, true);
    assert.equal(parsed.request.flipUpper, true);
  }
});

test('a missing or malformed model id is refused by name', () => {
  for (const modelId of [undefined, '', 'not-a-uuid', 42, null]) {
    assert.equal(messageOf(parseCutRequest(body({ modelId }))), 'invalid modelId', String(modelId));
  }
});

test('the transform has to be 16 finite numbers', () => {
  assert.equal(messageOf(parseCutRequest(body({ transform: undefined }))), 'transform must contain 16 finite numbers');
  assert.equal(messageOf(parseCutRequest(body({ transform: [1, 0, 0] }))), 'transform must contain 16 finite numbers');
  assert.equal(
    messageOf(parseCutRequest(body({ transform: [...IDENTITY.slice(0, 15), 'a'] }))),
    'transform must contain 16 finite numbers',
  );
  const nan = [...IDENTITY];
  nan[3] = Number.NaN;
  assert.equal(messageOf(parseCutRequest(body({ transform: nan }))), 'transform must contain 16 finite numbers');
});

test('the plane needs a point and a direction', () => {
  assert.equal(messageOf(parseCutRequest(body({ plane: undefined }))), 'plane required');
  assert.equal(messageOf(parseCutRequest(body({ plane: { normal: [0, 0, 1] } }))), 'plane point must be 3 finite numbers');
  assert.equal(messageOf(parseCutRequest(body({ plane: { point: [0, 0], normal: [0, 0, 1] } }))), 'plane point must be 3 finite numbers');
  assert.equal(messageOf(parseCutRequest(body({ plane: { point: [0, 0, 0] } }))), 'plane normal must be 3 finite numbers');
  assert.equal(messageOf(parseCutRequest(body({ plane: { point: [0, 0, 0], normal: [0, 0, 0] } }))), 'plane normal must not be zero');
  // a tiny but real direction is the caller's business (the CLI is the judge of that)
  const tiny = parseCutRequest(body({ plane: { point: [0, 0, 0], normal: [0, 0, 1e-6] } }));
  assert.equal(tiny.ok, true);
});

test('an unknown keep value, or a non-boolean flag, is refused', () => {
  assert.equal(messageOf(parseCutRequest(body({ keep: 'middle' }))), 'invalid keep (both, upper or lower)');
  assert.equal(messageOf(parseCutRequest(body({ keep: null }))), 'invalid keep (both, upper or lower)');
  assert.equal(messageOf(parseCutRequest(body({ placeOnCut: 'yes' }))), 'invalid placeOnCut');
  assert.equal(messageOf(parseCutRequest(body({ flipUpper: 1 }))), 'invalid flipUpper');
});

test('the schema is loose: extra fields of a client are ignored', () => {
  const parsed = cutRequestSchema.safeParse(
    body({ name: 'cube', selected: true, plane: { point: [0, 0, 1], normal: [0, 0, 1], tilt: 30 } }),
  );
  assert.equal(parsed.success, true);
});

test('an empty body is refused by the first field, a non-object body by zod itself', () => {
  // `undefined`/`null` become `{}` in the parser, so the missing model id answers
  assert.equal(messageOf(parseCutRequest(undefined)), 'invalid modelId');
  assert.equal(messageOf(parseCutRequest(null)), 'invalid modelId');
  assert.match(messageOf(parseCutRequest('cut')), /expected object/);
});
