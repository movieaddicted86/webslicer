/**
 * Pure placement maths of the plater (no React, no store, no rendering).
 * Mirrors the transform conventions of `state/store.ts`: Euler XYZ in radians, one Matrix4 per
 * instance (`instanceMatrix`).
 */
import * as THREE from 'three';
import type { Placement } from '@webslicer/shared';

/** World matrix of a placement, the same way `instanceMatrix` builds it. */
export function placementMatrix(p: Pick<Placement, 'position' | 'rotation' | 'scale'>): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...p.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rotation[0], p.rotation[1], p.rotation[2], 'XYZ')),
    new THREE.Vector3(...p.scale),
  );
}

/** Decompose a world matrix back into a placement (the matrix form of a placement). */
export function placementFromMatrix(m: THREE.Matrix4): Placement {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  m.decompose(position, quaternion, scale);
  const e = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
  return {
    position: position.toArray() as [number, number, number],
    rotation: [e.x, e.y, e.z],
    scale: scale.toArray() as [number, number, number],
  };
}

/**
 * Mirror a placement along a world axis through the instance's own position (PrusaSlicer's
 * "Mirror X/Y/Z"): `M' = T(p) · S(axis = -1) · T(-p) · M`, M = matrix of `placement`.
 * The mirror therefore keeps the instance where it is and turns it over in place.
 *
 * Decomposing M' puts the sign into the scale, so a mirrored instance has exactly one negative
 * scale component (two mirrors cancel, three flip again). Negating a local scale component instead
 * would be wrong as soon as the instance is rotated.
 */
export function mirrorPlacement(placement: Placement, axis: 0 | 1 | 2): Placement {
  const p = new THREE.Vector3(...placement.position);
  const sign = new THREE.Vector3(axis === 0 ? -1 : 1, axis === 1 ? -1 : 1, axis === 2 ? -1 : 1);
  const mirror = new THREE.Matrix4().compose(p, new THREE.Quaternion(), sign).multiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
  return placementFromMatrix(mirror.multiply(placementMatrix(placement)));
}
