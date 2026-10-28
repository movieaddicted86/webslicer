/**
 * What a touch gesture does to the camera (T-092). The maths of one orbit step, one pinch step and
 * the two-finger pan is pure, so it is unit-tested without a renderer: the viewer applies the result
 * to the active camera and to the orbit controls' target.
 *
 * Orbiting mirrors OrbitControls' one-finger rotate, so a finger drags the model the same way the
 * mouse does; the pinch changes the camera-target distance the way the wheel does – a *scale* of that
 * distance, which keeps the perspective and the orthographic view in step.
 */
import * as THREE from 'three';

/** How fast one finger orbits, as radians per CSS pixel, at the viewer's 900 px reference height. */
export const ORBIT_SPEED = (2 * Math.PI) / 900;

/** The distance stays between these, in mm – the bounds the wheel uses (`minDistance`/`maxDistance`). */
export const MIN_DISTANCE = 5;
export const MAX_DISTANCE = 4000;

/** Keep a distance inside the viewer's bounds. */
export function clampDistance(distance: number): number {
  return Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, distance));
}

const WORLD_UP = new THREE.Vector3(0, 0, 1);

/**
 * One orbit step around the target: `dx`/`dy` are the finger's movement in CSS pixels. The point the
 * finger holds follows the finger, as with a left-drag: to the right the camera swings around the
 * world's up axis, downwards it rises over the model. `up` is the camera up vector, which turns with
 * the elevation so the horizon stays level.
 */
export function orbitStep(
  target: THREE.Vector3,
  position: THREE.Vector3,
  up: THREE.Vector3,
  dx: number,
  dy: number,
  speed = ORBIT_SPEED,
): THREE.Vector3 {
  const offset = position.clone().sub(target);
  // the elevation turns around the camera's own right axis, which the azimuth does not change
  const { right } = cameraBasis(target, position, up);
  // the azimuth around the world's vertical axis, counter-clockwise from above for a rightward drag
  offset.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(WORLD_UP, dx * speed));
  // the elevation; the polar range is unlimited like OrbitControls', so the bottom view stays reachable
  const rotRight = new THREE.Quaternion().setFromAxisAngle(right, -dy * speed);
  offset.applyQuaternion(rotRight);
  up.applyQuaternion(rotRight);
  return target.clone().add(offset);
}

/**
 * Millimetres per CSS pixel at the target distance: the height the perspective camera shows there,
 * divided by the viewport height. An orthographic camera shows its own frustum instead, so the caller
 * passes that height.
 */
export function worldPerPixel(shownHeightMm: number, viewportHeightPx: number): number {
  return shownHeightMm / Math.max(viewportHeightPx, 1);
}

/** The camera's own right and up vectors (screen directions in world space). */
export function cameraBasis(
  target: THREE.Vector3,
  position: THREE.Vector3,
  up: THREE.Vector3,
): { right: THREE.Vector3; up: THREE.Vector3 } {
  const back = position.clone().sub(target).normalize();
  const right = new THREE.Vector3().crossVectors(up, back);
  if (right.lengthSq() < 1e-12) right.set(1, 0, 0);
  right.normalize();
  return { right, up: new THREE.Vector3().crossVectors(back, right).normalize() };
}

/**
 * One pinch step: `ratio` > 1 means the fingers moved apart, so the camera comes *closer* (zoom in).
 * The midpoint's movement (`dx`/`dy`) pans the view in the camera's own plane, so the point under the
 * two fingers stays under them.
 */
export function pinchStep(
  target: THREE.Vector3,
  position: THREE.Vector3,
  up: THREE.Vector3,
  ratio: number,
  dx: number,
  dy: number,
  mmPerPixel: number,
): { target: THREE.Vector3; position: THREE.Vector3 } {
  const offset = position.clone().sub(target);
  offset.setLength(clampDistance(offset.length() / Math.max(ratio, 1e-3)));
  const basis = cameraBasis(target, position, up);
  // a finger that moves right drags the model right, which moves the target left
  const pan = basis.right.multiplyScalar(-dx * mmPerPixel).add(basis.up.multiplyScalar(dy * mmPerPixel));
  const nextTarget = target.clone().add(pan);
  return { target: nextTarget, position: nextTarget.clone().add(offset) };
}
