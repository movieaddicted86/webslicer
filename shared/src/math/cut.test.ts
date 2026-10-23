/**
 * T-044: the cut plane maths (shared) – the rotation onto +Z, the cut frame and the part adjustments.
 * These pin the numbers the server and the browser both rely on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutRotation, planeFrame, rotationBetween, unit } from './cut.js';
import { apply } from './matrix.js';
import { meshBounds, translateVertices } from './bounds.js';

/** Near equality of two triples. */
function near(actual: number[], expected: number[], eps = 1e-9) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) < eps, `[${actual}] vs [${expected}]`);
}

test('unit refuses a zero vector and normalises the rest', () => {
  assert.equal(unit([0, 0, 0]), undefined);
  near(unit([0, 0, 5]) as number[], [0, 0, 1]);
  near(unit([3, 4, 0]) as number[], [0.6, 0.8, 0]);
});

test('rotationBetween maps the normal onto +Z and keeps lengths', () => {
  for (const normal of [
    [0, 0, 1],
    [0, 0, -1],
    [1, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [0.3, -0.4, 0.5],
  ]) {
    const r = rotationBetween(normal as [number, number, number], [0, 0, 1]);
    assert.ok(r, `rotation for ${normal}`);
    const n = unit(normal as [number, number, number]) as number[];
    const mapped = apply(r, n[0], n[1], n[2]);
    near(mapped, [0, 0, 1], 1e-9);
    // a rotation keeps the distance of two points
    const a = apply(r, 1, 2, 3);
    const b = apply(r, -2, 0.5, 1);
    const before = Math.hypot(1 - -2, 2 - 0.5, 3 - 1);
    assert.ok(Math.abs(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) - before) < 1e-9);
  }
});

test('the plane keeps one height in the cut frame, and every point of it maps to that height', () => {
  const level = planeFrame({ point: [0, 0, 10], normal: [0, 0, 1] });
  assert.ok(level);
  assert.equal(level.planeZ, 10);

  // tilted about X by 30°: the normal is (0, -sin30, cos30). The frame turns the normal onto +Z, so
  // the plane's height there is the point's height times cos30 (8.66), not 10
  const rad = Math.PI / 6;
  const tilted = planeFrame({ point: [0, 0, 10], normal: [0, -Math.sin(rad), Math.cos(rad)] });
  assert.ok(tilted);
  assert.ok(Math.abs(tilted.planeZ - 10 * Math.cos(rad)) < 1e-9, `planeZ ${tilted.planeZ}`);
  // two points of that plane map to the same height in the cut frame
  // the plane through (0, 0, 10) with that normal: -sin30·y + cos30·(z - 10) = 0
  const onPlane = apply(tilted.rotation, 12, -5, 10 - 5 * Math.tan(rad));
  assert.ok(Math.abs(onPlane[2] - tilted.planeZ) < 1e-9, 'the point is on the plane in the cut frame');
  const origin = apply(tilted.rotation, 0, 0, 10);
  assert.ok(Math.abs(origin[2] - tilted.planeZ) < 1e-9);
});

test('cutRotation is the identity unless the part is flipped or placed', () => {
  near(cutRotation('upper', 10, {}), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  near(cutRotation('lower', 10, {}), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  // "place on cut" turns the lower part over; "flip upper" turns the upper part
  const lower = apply(cutRotation('lower', 10, { placeOnCut: true }), 0, 0, 5);
  near(lower, [0, 0, 15]);
  const upper = apply(cutRotation('upper', 10, { flipUpper: true }), 0, 0, 15);
  near(upper, [0, 0, 5]);
  // both turns keep the cut face on the plane
  assert.ok(Math.abs(apply(cutRotation('upper', 10, { flipUpper: true }), 3, 0, 10)[2] - 10) < 1e-9);
  assert.ok(Math.abs(apply(cutRotation('lower', 10, { placeOnCut: true }), 3, 0, 10)[2] - 10) < 1e-9);
});

test('the cut frame and the two turns turn a bounded cube into the expected bounds', () => {
  // a 20 mm cube standing on the bed, cut level at 10: the upper part sits 10…20, flipped it sits -10…0
  const cube = {
    vertices: Float32Array.from([0, 0, 0, 20, 0, 0, 20, 20, 0, 0, 20, 0, 0, 0, 20, 20, 0, 20, 20, 20, 20, 0, 20, 20]),
    indices: new Uint32Array([0, 1, 2]),
  };
  const upper = translateVertices(cube.vertices, [0, 0, 0]);
  const box = meshBounds(upper);
  assert.deepEqual(box.min, [0, 0, 0]);
  assert.deepEqual(box.max, [20, 20, 20]);
  // `translateVertices` moves by `-c`, so c = (0, 0, 10) lowers the cube by 10
  const rotated = translateVertices(upper, [0, 0, 10]);
  assert.equal(meshBounds(rotated).min[2], -10);
  assert.equal(meshBounds(rotated).max[2], 10);
});
