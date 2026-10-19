import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mirrorPlacement, placementFromMatrix, placementMatrix, type Placement } from './transform.js';

const identity: Placement = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };

/** A rotated, scaled and translated placement – the case a naive local-scale negation gets wrong. */
const rotated: Placement = {
  position: [12, -4, 3],
  rotation: [0.4, -0.2, Math.PI / 6],
  scale: [1.5, 0.75, 2],
};

function points(m: THREE.Matrix4): THREE.Vector3[] {
  return [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(10, 0, 0),
    new THREE.Vector3(0, 20, 5),
  ].map((p) => p.applyMatrix4(m));
}

/** The world mirror a click has to produce: mirror through the instance position, then the placement. */
function expectedWorldMirror(p: Placement, axis: 0 | 1 | 2): THREE.Matrix4 {
  const pos = new THREE.Vector3(...p.position);
  const sign = new THREE.Vector3(axis === 0 ? -1 : 1, axis === 1 ? -1 : 1, axis === 2 ? -1 : 1);
  return new THREE.Matrix4().compose(pos, new THREE.Quaternion(), sign).multiply(new THREE.Matrix4().makeTranslation(-pos.x, -pos.y, -pos.z)).multiply(placementMatrix(p));
}

function closeTo(a: number[], b: number[], eps = 1e-9) {
  assert.equal(a.length, b.length);
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < eps, `${i}: ${v} != ${b[i]}`));
}

test('mirrorPlacement maps sample points like a world mirror through the instance position', () => {
  for (const axis of [0, 1, 2] as const) {
    const mirrored = placementMatrix(mirrorPlacement(rotated, axis));
    const expected = expectedWorldMirror(rotated, axis);
    points(mirrored).forEach((p, i) => closeTo(p.toArray(), points(expected)[i].toArray(), 1e-9));
  }
});

test('mirrorPlacement keeps the instance position', () => {
  closeTo(mirrorPlacement(rotated, 0).position, rotated.position, 1e-9);
  closeTo(mirrorPlacement(rotated, 1).position, rotated.position, 1e-9);
  closeTo(mirrorPlacement(rotated, 2).position, rotated.position, 1e-9);
});

test('mirrorPlacement puts the sign into exactly one scale component', () => {
  for (const axis of [0, 1, 2] as const) {
    const s = mirrorPlacement(rotated, axis).scale;
    assert.equal(s.filter((v) => v < 0).length, 1, `axis ${axis}: ${s.join(',')}`);
    // magnitudes are the original ones, so the panel can show sizes without signs
    closeTo([...s].map(Math.abs).sort(), [...rotated.scale].sort(), 1e-9);
  }
});

test('mirroring twice restores the original placement (AC-2)', () => {
  for (const axis of [0, 1, 2] as const) {
    const back = mirrorPlacement(mirrorPlacement(rotated, axis), axis);
    closeTo(back.position, rotated.position, 1e-6);
    closeTo(back.rotation, rotated.rotation, 1e-6);
    closeTo(back.scale, rotated.scale, 1e-6);
  }
  // and the matrix of the double mirror is the original matrix again
  const m = placementMatrix(mirrorPlacement(mirrorPlacement(rotated, 1), 1));
  points(m).forEach((p, i) => closeTo(p.toArray(), points(placementMatrix(rotated))[i].toArray(), 1e-6));
});

test('determinant is negative after one mirror and positive again after two', () => {
  assert.ok(placementMatrix(mirrorPlacement(identity, 0)).determinant() < 0);
  assert.ok(placementMatrix(mirrorPlacement(rotated, 2)).determinant() < 0);
  assert.ok(placementMatrix(mirrorPlacement(mirrorPlacement(rotated, 2), 2)).determinant() > 0);
});

test('mirroring an unrotated instance keeps its footprint on the bed (AC-1)', () => {
  // Plater objects are normalized to centre XY on the instance origin, so a mirror through that
  // origin mirrors the object in place: a 10 cube centred on (20, 30) stays where it is
  const p: Placement = { position: [20, 30, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
  const cube = new THREE.Box3(new THREE.Vector3(-5, -5, 0), new THREE.Vector3(5, 5, 10));
  const mirrored = mirrorPlacement(p, 0);
  closeTo(mirrored.position, [20, 30, 0], 1e-9);
  closeTo(mirrored.scale, [-1, 1, 1], 1e-9);
  const box = cube.clone().applyMatrix4(placementMatrix(mirrored));
  closeTo(box.min.toArray(), [15, 25, 0], 1e-9);
  closeTo(box.max.toArray(), [25, 35, 10], 1e-9);
  // Z mirror turns it over: it leaves the bed below 0 and `dropToBed` puts it back upside down
  const zBox = cube.clone().applyMatrix4(placementMatrix(mirrorPlacement(p, 2)));
  closeTo(zBox.min.toArray(), [15, 25, -10], 1e-9);
  closeTo(zBox.max.toArray(), [25, 35, 0], 1e-9);
});

test('placementFromMatrix is the inverse of placementMatrix', () => {
  const back = placementFromMatrix(placementMatrix(rotated));
  closeTo(back.position, rotated.position, 1e-6);
  closeTo(back.rotation, rotated.rotation, 1e-6);
  closeTo(back.scale, rotated.scale, 1e-6);
});

test('placementFromMatrix reproduces a mirrored matrix with non-uniform scale', () => {
  // A mirror does not have a unique placement: `Matrix4.decompose` always puts the sign on the
  // first scale component, so "mirror Z" comes back as "mirror X" plus a 180 degree rotation. That
  // is the same transform, but only as long as the rotation is taken with it - moving the sign to
  // another axis without correcting the rotation would not recompose to the input matrix (that was
  // review finding 1 of T-001, round 1). The round trip, not the axis label, is what has to hold.
  const matrices = [
    placementMatrix({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, -1.5] }),
    placementMatrix({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, -2, 1] }),
    placementMatrix({ position: [10, 20, 0], rotation: [0, 0, 0], scale: [-1, 1, 1] }),
    placementMatrix({ position: [-8, 4, 2], rotation: [0.3, -0.7, 2.1], scale: [-2, 1.25, 0.5] }),
    placementMatrix(rotated),
  ];
  for (const m of matrices) {
    const back = placementMatrix(placementFromMatrix(m));
    closeTo(back.elements, m.elements, 1e-9);
  }
  // and a mirrored matrix really is mirrored: the round trip must not silently drop the mirror
  const mirrored = placementMatrix({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, -1.5] });
  assert.ok(placementMatrix(placementFromMatrix(mirrored)).determinant() < 0);
});
