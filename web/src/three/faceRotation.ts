/**
 * Placing an object on a face (q4-web-store): the quaternion maths that turned an object in the
 * plater now lives here, in `three/`, so the store action only passes the face normal and the
 * instance rotation in and gets a new Euler rotation back.
 */
import * as THREE from 'three';

/**
 * The Euler XYZ rotation that points `worldNormal` down (-Z), composed with the instance's current
 * rotation; `undefined` when the normal is degenerate.
 */
export function rotationForFace(
  worldNormal: [number, number, number],
  rotation: [number, number, number],
): [number, number, number] | undefined {
  const n = new THREE.Vector3(worldNormal[0], worldNormal[1], worldNormal[2]).normalize();
  if (n.lengthSq() < 0.5) return undefined;
  const down = new THREE.Vector3(0, 0, -1);
  const q = new THREE.Quaternion().setFromUnitVectors(n, down);
  const cur = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2], 'XYZ'));
  const e = new THREE.Euler().setFromQuaternion(q.multiply(cur), 'XYZ');
  return [e.x, e.y, e.z];
}
