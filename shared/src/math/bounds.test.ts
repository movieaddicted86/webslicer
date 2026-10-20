/**
 * Bounds and normalisation (R-3, ported from `server/src/plater/normalize.test.ts`).
 *
 * The normalisation has to reproduce the browser's import exactly (AC-2): the geometry is centred
 * and the instance matrices are shifted by the same offset, so every vertex ends up where the
 * original 3MF put it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, IDENTITY, multiply, translate } from './matrix.js';
import { instanceBounds, meshBounds, normalizationOffset, normalize, translateVertices } from './bounds.js';

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const closePoint = (a: number[], b: number[], eps = 1e-9) => a.forEach((v, i) => close(v, b[i], eps));

/** Column-major matrix of a Z rotation, then a translation (T · Rz). */
function rotatedScaled(tx: number, ty: number, tz: number, deg: number, scale: number): number[] {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r) * scale;
  const s = Math.sin(r) * scale;
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, scale, 0, tx, ty, tz, 1];
}

// a cube 20 x 20 x 20 sitting at 0..20 in every axis
const CUBE = Float32Array.from([0, 0, 0, 20, 0, 0, 20, 20, 0, 0, 20, 0, 0, 0, 20, 20, 0, 20, 20, 20, 20, 0, 20, 20]);

test('meshBounds and normalizationOffset centre X/Y and put min Z on the bed', () => {
  const b = meshBounds(CUBE);
  assert.deepEqual(b.min, [0, 0, 0]);
  assert.deepEqual(b.max, [20, 20, 20]);
  assert.deepEqual(normalizationOffset(b), [10, 10, 0]);

  // an asymmetric mesh: the offset follows the centre, not a corner
  const b2 = meshBounds(Float32Array.from([-5, 2, 3, 15, 8, 9]));
  assert.deepEqual(normalizationOffset(b2), [5, 5, 3]);

  // an empty mesh has no bounds rather than an infinite box
  assert.deepEqual(meshBounds(Float32Array.from([])), { min: [0, 0, 0], max: [0, 0, 0] });
});

test('normalize centres the vertices and shifts the instances by the offset', () => {
  const { vertices, offset, instances } = normalize(CUBE, [IDENTITY]);
  assert.deepEqual(offset, [10, 10, 0]);
  assert.deepEqual(meshBounds(vertices).min, [-10, -10, 0]);
  assert.deepEqual(meshBounds(vertices).max, [10, 10, 20]);
  // identity · Translate(c) is the shift itself
  assert.deepEqual(instances, [translate(10, 10, 0)]);
  // the input array is not touched
  assert.deepEqual(meshBounds(CUBE).min, [0, 0, 0]);
  closePoint([...translateVertices(CUBE, [1, 2, 3]).slice(0, 3)], [-1, -2, -3]);
});

test('normalize keeps a rotated and scaled instance exactly where the file had it', () => {
  const m = rotatedScaled(60, 40, 0, 30, 1.5);
  const { vertices, instances } = normalize(CUBE, [m]);
  const c = normalizationOffset(meshBounds(CUBE));
  for (let i = 0; i < CUBE.length; i += 3) {
    const v = [CUBE[i], CUBE[i + 1], CUBE[i + 2]];
    const centred = [vertices[i], vertices[i + 1], vertices[i + 2]];
    closePoint(apply(instances[0], centred[0], centred[1], centred[2]), apply(m, v[0], v[1], v[2]));
    closePoint(centred, [v[0] - c[0], v[1] - c[1], v[2] - c[2]]);
  }
});

test('an instance position is M_j · c – with a non-zero Z offset, not the offset added to it', () => {
  // The normalisation offset is not always flat: a mesh sitting above the bed keeps its Z, so
  // c = [10, 10, 5] here. The instance matrix is T_j · Translate(c), and its translation is
  // therefore M_j · c: the offset is turned and scaled by the instance like any other point.
  const RAISED = Float32Array.from(Array.from(CUBE).map((v, i) => (i % 3 === 2 ? v + 5 : v)));
  const c = normalizationOffset(meshBounds(RAISED));
  assert.deepEqual(c, [10, 10, 5]);
  assert.ok(c[2] !== 0, 'this case is only interesting with c.z != 0');

  const m = rotatedScaled(60, 40, 0, 30, 1.5);
  const { vertices, instances } = normalize(RAISED, [m]);

  // position of the instance = the translation of M_j · Translate(c)
  closePoint(instances[0].slice(12, 15), apply(m, c[0], c[1], c[2]));
  // and not `c + t` (the P1.3 mistake `cx + x`): the two differ by a visible distance
  const naive = [c[0] + m[12], c[1] + m[13], c[2] + m[14]];
  const cur = instances[0].slice(12, 15);
  assert.ok(Math.hypot(cur[0] - naive[0], cur[1] - naive[1], cur[2] - naive[2]) > 1, `position ${cur.join(',')} is the naive offset sum ${naive.join(',')}`);
  // the whole instance transform is T_j · Translate(c): every vertex stays where the file had it
  for (let i = 0; i < RAISED.length; i += 3) {
    closePoint(apply(instances[0], vertices[i], vertices[i + 1], vertices[i + 2]), apply(m, RAISED[i], RAISED[i + 1], RAISED[i + 2]));
  }
});

test('normalize handles several instances and an empty instance list', () => {
  const a = rotatedScaled(0, 0, 0, 0, 1);
  const b = rotatedScaled(50, 0, 0, 90, 2);
  const { vertices, instances } = normalize(CUBE, [a, b]);
  assert.equal(instances.length, 2);
  // instance 1 sits where the file had it: the shift puts the centred geometry back to 0..20
  const box = instanceBounds(meshBounds(vertices), instances[0]);
  assert.deepEqual(box.min, [0, 0, 0]);
  assert.deepEqual(box.max, [20, 20, 20]);
  // instance 2 is turned 90° about Z and doubled: the 20 mm cube becomes 40 mm wide, 40 deep, 40 high
  const box2 = instanceBounds(meshBounds(vertices), instances[1]);
  closePoint(box2.min, [10, 0, 0]);
  closePoint(box2.max, [50, 40, 40]);
  // an object without build items is placed by the identity, like the browser's IDENTITY_PLACEMENT
  assert.deepEqual(normalize(CUBE, []).instances, [translate(10, 10, 0)]);
});

test('instanceBounds is the mesh box through the matrix', () => {
  const box = { min: [-5, -5, 0] as [number, number, number], max: [5, 5, 10] as [number, number, number] };
  // no transform: the box itself
  assert.deepEqual(instanceBounds(box, IDENTITY), box);
  // a 90 degree turn about Z takes width to depth
  const long = { min: [0, 0, 0] as [number, number, number], max: [10, 4, 2] as [number, number, number] };
  closePoint(instanceBounds(long, rotatedScaled(0, 0, 0, 90, 1)).min, [-4, 0, 0]);
  closePoint(instanceBounds(long, rotatedScaled(0, 0, 0, 90, 1)).max, [0, 10, 2]);
  // moved and scaled: min/max follow M
  const m = multiply(translate(10, 0, 0), rotatedScaled(0, 0, 0, 0, 2));
  closePoint(instanceBounds(box, m).min, [0, -10, 0]);
  closePoint(instanceBounds(box, m).max, [20, 10, 20]);
  // an empty box stays a point (the arrangement must not blow up on a degenerate mesh)
  assert.deepEqual(instanceBounds({ min: [0, 0, 0], max: [0, 0, 0] }, translate(1, 2, 3)), { min: [1, 2, 3], max: [1, 2, 3] });
});
