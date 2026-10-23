/**
 * The three.js constructors the plater uses (`web/src/three/geometry.ts`): one shell as a geometry of
 * its own, and a geometry from a flat triangle soup (merge). The plain readers moved to
 * `plater/meshInfo.test.ts` (q4-web-store).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { geometryFromVertices, shellGeometry } from './geometry';
import { geometrySize, triangleCount } from '../plater/meshInfo';

/** Axis-aligned box, non-indexed like every loaded mesh, its position array in the given frame. */
function box(size: number, at: [number, number, number] = [0, 0, 0]): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(size, size, size).toNonIndexed();
  g.translate(at[0], at[1], at[2]);
  return g;
}

test('shellGeometry rebuilds one shell from the source position array', () => {
  const source = box(10);
  const positions = source.getAttribute('position').array as Float32Array;
  const shell = shellGeometry(positions, Uint32Array.from([0, 5, 11]));
  assert.equal(shell.getAttribute('position').count, 9, 'three triangles…');
  assert.equal(triangleCount(shell), 3, '…and nothing indexed');
  assert.deepEqual(geometrySize(shell), [10, 10, 10], 'the same box as the source');
  assert.ok(shell.getAttribute('normal'), 'the normals are computed for the viewer');
});

test('geometryFromVertices builds a non-indexed geometry with normals and bounds', () => {
  const g = geometryFromVertices([0, 0, 0, 10, 0, 0, 0, 10, 0]);
  assert.equal(g.getIndex(), null, 'a part is a triangle soup');
  assert.equal(triangleCount(g), 1);
  assert.ok(g.getAttribute('normal'), 'the normals are computed for the viewer');
  assert.ok(g.boundingBox, 'the bounds are computed for the store');
  assert.deepEqual(geometrySize(g), [10, 10, 0]);
});
