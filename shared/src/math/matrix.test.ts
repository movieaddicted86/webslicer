/**
 * The matrix and placement maths (R-3). The values marked "three.js reference" were generated with
 * `Matrix4.compose`/`Matrix4.decompose`/`Euler.setFromQuaternion(q, 'XYZ')`, i.e. with the code the
 * browser used before this moved here – the numbers are the contract, not the formulas.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDENTITY, apply, determinant, mirrorPlacement, multiply, placementFromMatrix, placementMatrix, translate } from './matrix.js';
import { instanceBounds } from './bounds.js';
import type { Bounds, Placement, Vec3 } from '../types/index.js';

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const closePoint = (a: number[], b: number[], eps = 1e-9) => {
  assert.equal(a.length, b.length);
  a.forEach((v, i) => close(v, b[i], eps));
};

const identity: Placement = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };

/** A rotated, scaled and translated placement – the case a naive local-scale negation gets wrong. */
const rotated: Placement = {
  position: [12, -4, 3],
  rotation: [0.4, -0.2, Math.PI / 6],
  scale: [1.5, 0.75, 2],
};

const PROBES: Vec3[] = [
  [0, 0, 0],
  [10, 0, 0],
  [0, 20, 5],
  [3, -7, 2],
];

/** A world mirror of one point along an axis through `p`: x -> 2 * p.x - x. */
function worldMirror(p: Vec3, axis: 0 | 1 | 2, v: Vec3): Vec3 {
  const out: Vec3 = [v[0], v[1], v[2]];
  out[axis] = 2 * p[axis] - out[axis];
  return out;
}

test('placementMatrix builds T(position) · R(euler XYZ) · S(scale)', () => {
  assert.deepEqual(placementMatrix(identity), IDENTITY);
  // three.js reference for position (12, -4, 3), rotation (0.4, -0.2, pi/6), scale (1.5, 0.75, 2)
  closePoint(
    placementMatrix(rotated),
    [1.273143830716, 0.590295037014, 0.529770285677, 0, -0.36752496669, 0.627258719981, 0.184314668617, 0, -0.39733866159, -0.76331180419, 1.805402192751, 0, 12, -4, 3, 1],
    1e-12,
  );
  // a 90 degree turn about Y maps +X to -Z (a transposed rotation would map it to +Z)
  closePoint(placementMatrix({ position: [0, 0, 0], rotation: [0, Math.PI / 2, 0], scale: [1, 1, 1] }).slice(0, 3), [0, 0, -1], 1e-12);
});

test('multiply composes in column-major order', () => {
  // T(5,0,0) · T(0,3,0) = T(5,3,0) – and the other way round as well
  assert.deepEqual(multiply(translate(5, 0, 0), translate(0, 3, 0)), translate(5, 3, 0));
  assert.deepEqual(multiply(translate(0, 3, 0), translate(5, 0, 0)), translate(5, 3, 0));
  // identity is neutral
  assert.deepEqual(multiply(IDENTITY, IDENTITY), IDENTITY);
  // the order matters: T · Rz turns the point first, Rz · T turns the moved point (Rz maps x -> y)
  const rz = placementMatrix({ position: [0, 0, 0], rotation: [0, 0, Math.PI / 2], scale: [1, 1, 1] });
  closePoint(apply(multiply(translate(10, 0, 0), rz), 1, 0, 0), [10, 1, 0]);
  closePoint(apply(multiply(rz, translate(10, 0, 0)), 1, 0, 0), [0, 11, 0]);
});

test('apply maps a point through the matrix', () => {
  closePoint(apply(translate(1, 2, 3), -4, 5, -6), [-3, 7, -3]);
  closePoint(apply(placementMatrix(rotated), 0, 0, 0), rotated.position);
  // and compose: apply(a · b, v) = apply(a, apply(b, v))
  const a = translate(10, 0, 0);
  const b = placementMatrix({ position: [0, 0, 0], rotation: [0, 0, Math.PI / 2], scale: [2, 2, 2] });
  const viaB = apply(b, 1, 0, 0);
  closePoint(apply(multiply(a, b), 1, 0, 0), apply(a, viaB[0], viaB[1], viaB[2]));
});

test('placementFromMatrix is the inverse of placementMatrix', () => {
  const back = placementFromMatrix(placementMatrix(rotated));
  closePoint(back.position, rotated.position, 1e-9);
  closePoint(back.rotation, rotated.rotation, 1e-9);
  closePoint(back.scale, rotated.scale, 1e-9);
  // three.js reference for the same matrix
  closePoint(back.rotation, [0.4, -0.2, Math.PI / 6], 1e-12);
  closePoint(back.scale, [1.5, 0.75, 2], 1e-12);
});

test('placementFromMatrix reproduces a mirrored matrix with non-uniform scale', () => {
  // A mirror does not have a unique placement: three.js puts the sign on the first scale component, so
  // "mirror Z" comes back as "mirror X" plus a 180 degree rotation. That is the same transform, but
  // only as long as the rotation is taken with it - moving the sign to another axis without correcting
  // the rotation would not recompose to the input matrix (T-001, review finding 1). The round trip,
  // not the axis label, is what has to hold.
  const matrices = [
    placementMatrix({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, -1.5] }),
    placementMatrix({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, -2, 1] }),
    placementMatrix({ position: [10, 20, 0], rotation: [0, 0, 0], scale: [-1, 1, 1] }),
    placementMatrix({ position: [-8, 4, 2], rotation: [0.3, -0.7, 2.1], scale: [-2, 1.25, 0.5] }),
    placementMatrix(rotated),
  ];
  for (const m of matrices) closePoint(placementMatrix(placementFromMatrix(m)), m, 1e-9);
  // and a mirrored matrix really is mirrored: the round trip must not silently drop the mirror
  assert.ok(determinant(placementMatrix(placementFromMatrix(matrices[0]))) < 0);
});

test('mirrorPlacement maps sample points like a world mirror through the instance position', () => {
  for (const axis of [0, 1, 2] as const) {
    for (const v of PROBES) {
      const world = apply(placementMatrix(rotated), v[0], v[1], v[2]);
      const mirrored = apply(placementMatrix(mirrorPlacement(rotated, axis)), v[0], v[1], v[2]);
      closePoint(mirrored, worldMirror(rotated.position, axis, world));
    }
  }
});

test('mirrorPlacement turns a rotated instance over in place (three.js reference values)', () => {
  const m = mirrorPlacement(rotated, 0);
  closePoint(m.position, rotated.position, 1e-9);
  closePoint(m.rotation, [0.4, 0.2, -Math.PI / 6], 1e-9);
  closePoint(m.scale, [-1.5, 0.75, 2], 1e-9);
});

test('mirrorPlacement puts the sign into exactly one scale component', () => {
  for (const axis of [0, 1, 2] as const) {
    const s = mirrorPlacement(rotated, axis).scale;
    assert.equal(s.filter((v) => v < 0).length, 1, `axis ${axis}: ${s.join(',')}`);
    // magnitudes are the original ones, so the panel can show sizes without signs
    closePoint([...s].map(Math.abs).sort(), [...rotated.scale].sort(), 1e-9);
  }
});

test('mirroring twice restores the original placement (AC-2)', () => {
  for (const axis of [0, 1, 2] as const) {
    const back = mirrorPlacement(mirrorPlacement(rotated, axis), axis);
    closePoint(back.position, rotated.position, 1e-6);
    closePoint(back.rotation, rotated.rotation, 1e-6);
    closePoint(back.scale, rotated.scale, 1e-6);
  }
  // and the matrix of the double mirror is the original matrix again
  const m = placementMatrix(mirrorPlacement(mirrorPlacement(rotated, 1), 1));
  closePoint(m, placementMatrix(rotated), 1e-6);
});

test('determinant is negative after one mirror and positive again after two', () => {
  assert.ok(determinant(placementMatrix(mirrorPlacement(identity, 0))) < 0);
  assert.ok(determinant(placementMatrix(mirrorPlacement(rotated, 2))) < 0);
  assert.ok(determinant(placementMatrix(mirrorPlacement(mirrorPlacement(rotated, 2), 2))) > 0);
  // a rotation and a uniform scale never flip the sign
  assert.ok(determinant(placementMatrix(rotated)) > 0);
  assert.ok(determinant(IDENTITY) > 0);
});

test('mirroring an unrotated instance keeps its footprint on the bed (AC-1)', () => {
  // Plater objects are normalized to centre XY on the instance origin, so a mirror through that
  // origin mirrors the object in place: a 10 cube centred on (20, 30) stays where it is
  const p: Placement = { position: [20, 30, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
  const cube: Bounds = { min: [-5, -5, 0], max: [5, 5, 10] };
  const mirrored = mirrorPlacement(p, 0);
  closePoint(mirrored.position, [20, 30, 0], 1e-9);
  closePoint(mirrored.scale, [-1, 1, 1], 1e-9);
  const box = instanceBounds(cube, placementMatrix(mirrored));
  closePoint(box.min, [15, 25, 0], 1e-9);
  closePoint(box.max, [25, 35, 10], 1e-9);
  // Z mirror turns it over: it leaves the bed below 0 and `dropToBed` puts it back upside down
  const zBox = instanceBounds(cube, placementMatrix(mirrorPlacement(p, 2)));
  closePoint(zBox.min, [15, 25, -10], 1e-9);
  closePoint(zBox.max, [25, 35, 0], 1e-9);
});
