/**
 * Pure camera maths of the 3D view (no React, no WebGL, no renderer): the standard views, the
 * distance that fits a box into the frustum, and the size of the orthographic frustum. The unit
 * tests drive this module directly, so `three/Viewer.tsx` only applies what comes back.
 * The world is Z-up, like PrusaSlicer's.
 */
import * as THREE from 'three';

/** PrusaSlicer's standard views, in the order of its number keys: Iso = 0 … Right = 6. */
export type CameraView = 'iso' | 'top' | 'bottom' | 'front' | 'rear' | 'left' | 'right';

interface ViewDef {
  id: CameraView;
  label: string;
  /** the number key of the view (PrusaSlicer: Iso 0, Top 1, Bottom 2, Front 3, Rear 4, Left 5, Right 6) */
  key: string;
  /** unit vector from the target towards the camera */
  dir: THREE.Vector3;
  /** camera up vector – the top and bottom views need a different one, because the world is Z-up */
  up: THREE.Vector3;
}

const vec = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * The standard views. "Front" looks at the bed from -Y, so +X is to the right and +Z up, and the
 * side views keep the horizon level; only the two vertical views need up = +Y.
 */
export const VIEWS: ViewDef[] = [
  { id: 'iso', label: 'Iso', key: '0', dir: vec(1, -1, 1).normalize(), up: vec(0, 0, 1) },
  { id: 'top', label: 'Top', key: '1', dir: vec(0, 0, 1), up: vec(0, 1, 0) },
  { id: 'bottom', label: 'Bottom', key: '2', dir: vec(0, 0, -1), up: vec(0, 1, 0) },
  { id: 'front', label: 'Front', key: '3', dir: vec(0, -1, 0), up: vec(0, 0, 1) },
  { id: 'rear', label: 'Rear', key: '4', dir: vec(0, 1, 0), up: vec(0, 0, 1) },
  { id: 'left', label: 'Left', key: '5', dir: vec(-1, 0, 0), up: vec(0, 0, 1) },
  { id: 'right', label: 'Right', key: '6', dir: vec(1, 0, 0), up: vec(0, 0, 1) },
];

/** The view a number key selects, `undefined` for any other key. */
export function viewByKey(key: string): CameraView | undefined {
  return VIEWS.find((v) => v.key === key)?.id;
}

export function viewDef(view: CameraView): ViewDef {
  return VIEWS.find((v) => v.id === view) ?? VIEWS[0];
}

/** Orthonormal camera basis: screen right, screen up and the direction towards the camera. */
export function viewBasis(dir: THREE.Vector3, up: THREE.Vector3): { right: THREE.Vector3; up: THREE.Vector3; dir: THREE.Vector3 } {
  const d = dir.clone().normalize();
  let right = new THREE.Vector3().crossVectors(up, d);
  // an up vector parallel to the view direction has no right vector; pick any other axis then
  if (right.lengthSq() < 1e-12) right = new THREE.Vector3().crossVectors(vec(1, 0, 0), d);
  right.normalize();
  return { right, up: new THREE.Vector3().crossVectors(d, right).normalize(), dir: d };
}

interface Frame {
  /** point the camera looks at – the centre of the box, and the orbit centre */
  target: THREE.Vector3;
  position: THREE.Vector3;
  up: THREE.Vector3;
  /** distance between target and position */
  distance: number;
}

/**
 * Frame a box from the given direction: the camera sits on `dir` at the smallest distance that
 * keeps all eight corners of the box inside the frustum, so nothing is cut off and nothing is
 * lost in empty space. `margin` (8 % by default) is the breathing room around the box.
 */
export function fitFrame(box: THREE.Box3, dir: THREE.Vector3, up: THREE.Vector3, fovDeg: number, aspect: number, margin = 0.08): Frame {
  const b = viewBasis(dir, up);
  const target = box.getCenter(new THREE.Vector3());
  // the corners are tested against a slightly narrower cone, which is the margin
  const tanY = Math.tan((fovDeg * Math.PI) / 360) * (1 - margin);
  const tanX = tanY * Math.max(aspect, 1e-6);
  const corner = new THREE.Vector3();
  let distance = 0;
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(target);
    const depth = corner.dot(b.dir);
    distance = Math.max(distance, depth + Math.abs(corner.dot(b.up)) / tanY, depth + Math.abs(corner.dot(b.right)) / tanX);
  }
  distance = Math.max(distance, 1e-3);
  return { target, position: target.clone().addScaledVector(b.dir, distance), up: b.up, distance };
}

/** The direction and up vector that place the camera for a standard view, in world space. */
export function viewDirection(view: CameraView): { dir: THREE.Vector3; up: THREE.Vector3 } {
  const d = viewDef(view);
  return { dir: d.dir.clone(), up: d.up.clone() };
}

/**
 * The up vector after a quarter turn: the world's vertical axis, so the horizon is level again after
 * an orbit that tilted it. A view straight down or up has no level horizon – there the current up
 * stays, because +Z would be parallel to the view direction.
 */
export function uprightUp(dir: THREE.Vector3, current: THREE.Vector3): THREE.Vector3 {
  return Math.abs(dir.clone().normalize().z) > 0.9999 ? current.clone() : new THREE.Vector3(0, 0, 1);
}

/** A horizontal strip of the canvas, in CSS px (y down), that the framed box has to fill. */
export interface FrameBand {
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * Frame `box` into the band above the phone's sheet: the camera keeps the canvas' aspect, but the
 * distance fits the band's height and the pose is shifted so the box is centred in the band instead
 * of the canvas. The result is a normal camera pose – no projection tricks – so orbiting, picking
 * and the orthographic switch keep working on it.
 *
 * Fit and shift are solved together: the shift changes the depth of the box from the camera (and
 * with it the scale), so a shift computed after a plain fit leaves the box too big for the band on a
 * short band – the phone's preview at peek used to push the plate under the view row (T-103). The
 * distance is solved for the shifted pose, tightest first.
 */
export function fitFrameInBand(
  box: THREE.Box3,
  dir: THREE.Vector3,
  up: THREE.Vector3,
  fovDeg: number,
  band: FrameBand,
  margin = 0.08,
): Frame {
  const bandHeight = Math.max(1, band.bottom - band.top);
  const tan = Math.tan((fovDeg * Math.PI) / 360);
  const basis = viewBasis(dir, up);
  const centre = box.getCenter(new THREE.Vector3());
  const k = band.height / (2 * tan);
  // where the box's centre has to land on screen, in canvas pixels (y down; negative is upwards)
  const shift = (band.top + band.bottom) / 2 - band.height / 2;
  // the world-vertical move keeps the orbit target's x/y (a quarter turn spins around the plate's
  // own vertical, AC-4); a view along the vertical axis has no such screen axis, so there the pose
  // moves along its own up instead
  const worldVertical = Math.abs(basis.up.z) > 0.05;
  const corners: Array<{ right: number; up: number; depth: number }> = [];
  const corner = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(centre);
    corners.push({ right: corner.dot(basis.right), up: corner.dot(basis.up), depth: corner.dot(basis.dir) });
  }
  const halfY = (bandHeight / 2) * (1 - margin);
  const halfX = (Math.max(band.width, 1) / 2) * (1 - margin);
  const offsetAt = (distance: number): THREE.Vector3 =>
    worldVertical
      ? // the move that puts the centre exactly on the band's centre at this distance
        new THREE.Vector3(0, 0, distance ? (shift * distance) / (basis.up.z * k - shift * basis.dir.z) : 0)
      : basis.up.clone().multiplyScalar((shift * (2 * distance * tan)) / Math.max(band.height, 1));
  // every corner within the band's height around the box centre's projection, and within the
  // canvas' width; the deviations shrink like 1/distance, so a far enough camera always fits
  const fits = (distance: number): boolean => {
    if (!(distance > 0)) return false;
    const offset = offsetAt(distance);
    const upOffset = offset.dot(basis.up);
    const depthOffset = offset.dot(basis.dir);
    const centreDepth = distance + depthOffset;
    if (!(centreDepth > 1e-3)) return false;
    const centreY = (upOffset * k) / centreDepth;
    for (const c of corners) {
      const depth = distance - c.depth + depthOffset;
      if (!(depth > 1e-3)) return false;
      if (Math.abs(-((c.up - upOffset) * k) / depth - centreY) > halfY) return false;
      if (Math.abs((c.right * k) / depth) > halfX) return false;
    }
    return true;
  };
  // the tightest distance that fits: double until it does, then halve towards the edge
  let lo = 0;
  let hi = Math.max(box.getSize(new THREE.Vector3()).length(), 1);
  while (!fits(hi) && hi < 1e9) {
    lo = hi;
    hi *= 2;
  }
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  const offset = offsetAt(hi);
  return {
    target: centre.clone().add(offset),
    position: centre.clone().addScaledVector(basis.dir, hi).add(offset),
    up: basis.up,
    distance: hi,
  };
}

/** The world's up axis (the app's Z-up world), the axis a quarter turn rotates around. */
const WORLD_Z = new THREE.Vector3(0, 0, 1);

/**
 * The camera offset after a quarter turn around the world's vertical axis: this is what the phone's
 * turn buttons do, so the elevation and the distance stay exactly as they were and an isometric view
 * becomes the next isometric corner.
 */
export function turnOffset(offset: THREE.Vector3, quarterTurns: number): THREE.Vector3 {
  return offset.clone().applyAxisAngle(WORLD_Z, (Math.PI / 2) * quarterTurns);
}

/**
 * Height of the orthographic frustum that shows the same area as the perspective view at
 * `distance` – this is what keeps the framing when the camera type is switched.
 */
export function orthoFrustumHeight(distance: number, fovDeg: number): number {
  return 2 * distance * Math.tan((fovDeg * Math.PI) / 360);
}

/** The distance at which a perspective camera shows the same area as an ortho frustum of that height. */
export function orthoFitDistance(frustumHeight: number, fovDeg: number): number {
  return frustumHeight / (2 * Math.tan((fovDeg * Math.PI) / 360));
}

/** Half height and half width of an ortho frustum of that height. */
export function orthoExtents(frustumHeight: number, aspect: number): { halfHeight: number; halfWidth: number } {
  const halfHeight = frustumHeight / 2;
  return { halfHeight, halfWidth: halfHeight * Math.max(aspect, 1e-6) };
}
