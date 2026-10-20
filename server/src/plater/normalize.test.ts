/**
 * The normalisation has to reproduce the browser's import exactly (AC-2): the geometry is centred
 * and the instance matrices are shifted by the same offset, so every vertex ends up where the
 * original 3MF put it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMatrix, IDENTITY, instanceBounds, meshBounds, multiplyMatrix, normalize, normalizationOffset, translateMatrix } from './normalize.js';

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
});

test('normalize centres the vertices and shifts the instances by the offset', () => {
  const { vertices, offset, instances } = normalize(CUBE, [IDENTITY]);
  assert.deepEqual(offset, [10, 10, 0]);
  assert.deepEqual(meshBounds(vertices).min, [-10, -10, 0]);
  assert.deepEqual(meshBounds(vertices).max, [10, 10, 20]);
  // identity · Translate(c) is the shift itself
  assert.deepEqual(instances, [translateMatrix(10, 10, 0)]);
});

test('normalize keeps a rotated and scaled instance exactly where the file had it', () => {
  const m = rotatedScaled(60, 40, 0, 30, 1.5);
  const { vertices, instances } = normalize(CUBE, [m]);
  const c = normalizationOffset(meshBounds(CUBE));
  for (let i = 0; i < CUBE.length; i += 3) {
    const v = [CUBE[i], CUBE[i + 1], CUBE[i + 2]];
    const centred = [vertices[i], vertices[i + 1], vertices[i + 2]];
    closePoint(applyMatrix(instances[0], centred[0], centred[1], centred[2]), applyMatrix(m, v[0], v[1], v[2]));
    closePoint(centred, [v[0] - c[0], v[1] - c[1], v[2] - c[2]]);
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
  assert.deepEqual(normalize(CUBE, []).instances, [translateMatrix(10, 10, 0)]);
});

test('multiplyMatrix composes in column-major order', () => {
  // T(5,0,0) · T(0,3,0) = T(5,3,0) – and the other way round as well
  assert.deepEqual(multiplyMatrix(translateMatrix(5, 0, 0), translateMatrix(0, 3, 0)), translateMatrix(5, 3, 0));
  assert.deepEqual(multiplyMatrix(translateMatrix(0, 3, 0), translateMatrix(5, 0, 0)), translateMatrix(5, 3, 0));
  // identity is neutral
  assert.deepEqual(multiplyMatrix(IDENTITY, IDENTITY), IDENTITY);
  // the order matters: T · Rz turns the point first, Rz · T turns the moved point (Rz maps x -> y)
  const rz = rotatedScaled(0, 0, 0, 90, 1);
  closePoint(applyMatrix(multiplyMatrix(translateMatrix(10, 0, 0), rz), 1, 0, 0), [10, 1, 0]);
  closePoint(applyMatrix(multiplyMatrix(rz, translateMatrix(10, 0, 0)), 1, 0, 0), [0, 11, 0]);
});
