/**
 * The three.js geometry helpers the plater uses (`web/src/three/geometry.ts`): sizes and triangle
 * counts of a mesh, the frame offset a normalized object was built with, one shell as a geometry of
 * its own, and the binary STL export the server receives as the uploaded mesh.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { geometrySize, geometryToStl, objectFrameOffset, shellGeometry, triangleCount } from './geometry';

/** Axis-aligned box, non-indexed like every loaded mesh, its position array in the given frame. */
function box(size: number, at: [number, number, number] = [0, 0, 0]): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(size, size, size).toNonIndexed();
  g.translate(at[0], at[1], at[2]);
  return g;
}

test('geometrySize measures the bounding box without needing one computed beforehand', () => {
  assert.deepEqual(geometrySize(box(10)), [10, 10, 10]);
  assert.deepEqual(geometrySize(box(4, [2, 3, 5])), [4, 4, 4]);
  const point = new THREE.BufferGeometry();
  point.setAttribute('position', new THREE.Float32BufferAttribute([7, 8, 9], 3));
  assert.deepEqual(geometrySize(point), [0, 0, 0], 'a single vertex has no extent');
});

test('triangleCount reads indexed and non-indexed meshes alike', () => {
  assert.equal(triangleCount(box(10)), 12);
  const indexed = new THREE.BoxGeometry(10, 10, 10);
  assert.ok(indexed.getIndex());
  assert.equal(triangleCount(indexed), 12, 'the index decides, not the position count');
});

test('objectFrameOffset undoes the normalization addObjects applies', () => {
  // A geometry centred on its own origin is moved by [0, 0, 5] to stand on the bed, so the offset
  // back into its own frame is exactly that move, negated.
  assert.deepEqual(objectFrameOffset({ geometry: box(10) }), [-0, -0, 5]);
  // one sitting at [30, 20, 15] (so z 10…20) is moved to the bed centre instead
  assert.deepEqual(objectFrameOffset({ geometry: box(10, [30, 20, 15]) }), [-30, -20, -10]);
});

test('shellGeometry rebuilds one shell from the source position array', () => {
  const source = box(10);
  const positions = source.getAttribute('position').array as Float32Array;
  const shell = shellGeometry(positions, Uint32Array.from([0, 5, 11]));
  assert.equal(shell.getAttribute('position').count, 9, 'three triangles…');
  assert.equal(triangleCount(shell), 3, '…and nothing indexed');
  assert.deepEqual(geometrySize(shell), [10, 10, 10], 'the same box as the source');
  assert.ok(shell.getAttribute('normal'), 'the normals are computed for the viewer');
});

test('geometryToStl writes a binary STL with the header, the count and one record per triangle', () => {
  const stl = geometryToStl(box(10));
  const view = new DataView(stl);
  assert.equal(stl.byteLength, 84 + 12 * 50);
  assert.equal(view.getUint32(80, true), 12, 'triangle count in the header');
  // the first record's normal points along an axis of a unit cube face, and the three vertices follow
  const normal = [view.getFloat32(84, true), view.getFloat32(88, true), view.getFloat32(92, true)];
  assert.equal(normal.filter((v) => Math.abs(Math.abs(v) - 1) < 1e-6).length, 1, `unit face normal: ${normal}`);
  const vertices: Array<[number, number, number]> = [];
  for (let i = 0; i < 3; i++) {
    const o = 96 + i * 12;
    vertices.push([view.getFloat32(o, true), view.getFloat32(o + 4, true), view.getFloat32(o + 8, true)]);
  }
  for (const v of vertices) for (const c of v) assert.ok(Math.abs(Math.abs(c) - 5) < 1e-6, `corner of the 10 mm box: ${v}`);
  assert.equal(view.getUint16(84 + 48, true), 0, 'no attribute byte count');
});
