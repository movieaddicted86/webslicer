/**
 * The plater's three.js constructors (q4-web-store): the geometry objects the store actions need.
 * The plain readers – size, triangle count, soup, frame offset, binary STL – live in
 * `web/src/plater/meshInfo.ts` and need no three.js; only construction stays here.
 */
import * as THREE from 'three';
import { shellPositions } from '../plater/split';

/** One shell of a non-indexed mesh as a geometry of its own, in the object's coordinate frame. */
export function shellGeometry(positions: Float32Array, tris: Uint32Array): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(shellPositions(positions, tris), 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** A non-indexed geometry from a flat triangle soup (merge: the source mesh as one part). */
export function geometryFromVertices(vertices: ArrayLike<number>): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(Array.from(vertices), 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}
