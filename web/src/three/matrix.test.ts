/**
 * The THREE adapter (R-3): the shared maths has to agree with the renderer, because the view, the
 * gizmo and the bed checks keep using three.js while the matrices now come from `@webslicer/shared`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  instanceBounds,
  mirrorPlacement,
  placementFromMatrix,
  placementMatrix,
  type Bounds,
  type Placement,
  type Vec3,
} from '@webslicer/shared';
import { fromBox3, fromMatrix4, toBox3, toMatrix4, toVector3 } from './matrix.js';

const close = (a: number, b: number, eps = 1e-12) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const closePoint = (a: number[], b: number[], eps = 1e-12) => {
  assert.equal(a.length, b.length);
  a.forEach((v, i) => close(v, b[i], eps));
};

const placements: Placement[] = [
  { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  { position: [12, -4, 3], rotation: [0.4, -0.2, Math.PI / 6], scale: [1.5, 0.75, 2] },
  { position: [10, 20, 0], rotation: [0, 0, 0], scale: [-1, 1, 1] },
  { position: [-8, 4, 2], rotation: [0.3, -0.7, 2.1], scale: [-2, 1.25, 0.5] },
  { position: [0, 0, 0], rotation: [0, Math.PI / 2, 0], scale: [1, 1, 1] },
  { position: [7, -2, 5], rotation: [0.9, 1.4, -2.6], scale: [-1.2, 0.8, 3] },
];

/** The matrix three.js builds for a placement – the renderer's own convention. */
function threeMatrix(p: Placement): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...p.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rotation[0], p.rotation[1], p.rotation[2], 'XYZ')),
    new THREE.Vector3(...p.scale),
  );
}

test('the shared placement matrix is the one three.js builds', () => {
  for (const p of placements) {
    const m = placementMatrix(p);
    assert.equal(m.length, 16);
    closePoint(m, threeMatrix(p).elements, 1e-15);
    // and the adapter hands that matrix to the renderer unchanged
    closePoint(fromMatrix4(toMatrix4(m)), m, 0);
    closePoint(toMatrix4(m).elements, threeMatrix(p).elements, 1e-15);
  }
});

test('the shared decomposition agrees with three.js, mirrors included', () => {
  for (const p of [...placements, ...placements.map((x) => mirrorPlacement(x, 1))]) {
    const t = threeMatrix(p);
    const back = placementMatrix(placementFromMatrix(fromMatrix4(t)));
    closePoint(back, t.elements, 1e-12);
  }
});

test('the shared bounds agree with Box3.applyMatrix4', () => {
  const bounds: Bounds = { min: [-5, -2, 0], max: [5, 8, 4] };
  assert.deepEqual(fromBox3(toBox3(bounds)), bounds);
  for (const p of placements) {
    const m = placementMatrix(p);
    const byThree = new THREE.Box3(toVector3(bounds.min), toVector3(bounds.max)).applyMatrix4(toMatrix4(m));
    const byShared = instanceBounds(bounds, m);
    closePoint(byShared.min, fromBox3(byThree).min, 1e-12);
    closePoint(byShared.max, fromBox3(byThree).max, 1e-12);
  }
  // a vector conversion keeps the numbers
  const v: Vec3 = [1.25, -3.5, 0];
  closePoint(toVector3(v).toArray(), v, 0);
});
