/**
 * The thin adapter between the shared maths (`@webslicer/shared`, `src/math`) and three.js (R-3).
 *
 * three.js types stay inside `web/src/three/` (guideline §2), so this is the only place where a
 * `Matrix4`/`Bounds` of the shared package turns into a `THREE` object and back. The maths itself
 * lives in the shared package; nothing here computes anything.
 */
import * as THREE from 'three';
import type { Bounds, Matrix4, Vec3 } from '@webslicer/shared';

/** The shared column-major matrix as the renderer's `THREE.Matrix4`. */
export function toMatrix4(m: Matrix4): THREE.Matrix4 {
  return new THREE.Matrix4().fromArray(m);
}

/** The renderer's `THREE.Matrix4` as the shared column-major matrix. */
export function fromMatrix4(m: THREE.Matrix4): Matrix4 {
  return m.elements.slice();
}

export function toVector3(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(v[0], v[1], v[2]);
}

/** The shared bounds as the renderer's `THREE.Box3` (used by the view, the gizmo and the bed checks). */
export function toBox3(b: Bounds): THREE.Box3 {
  return new THREE.Box3(toVector3(b.min), toVector3(b.max));
}

/** The renderer's `THREE.Box3` as the shared bounds. */
export function fromBox3(box: THREE.Box3): Bounds {
  return { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] };
}
