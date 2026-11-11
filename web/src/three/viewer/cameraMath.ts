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
  // the band covers `bandHeight / canvas height` of the canvas: fit that much less of the world
  const fovEff = (2 * Math.atan(tan * Math.min(1, bandHeight / Math.max(band.height, 1))) * 180) / Math.PI;
  const frame = fitFrame(box, dir, up, fovEff, Math.max(band.width, 1) / bandHeight, margin);
  // moving camera and target together along the view's up axis moves the picture down: the band's
  // centre is above the canvas' centre, so the box has to move up on screen. The move is made along
  // the world's vertical axis, scaled so it shifts the picture by the same amount, not along the
  // tilted screen-up axis: the orbit target keeps the box's x/y, so a quarter turn spins around the
  // plate's own vertical instead of around a point beside it (AC-4).
  const basis = viewBasis(frame.position.clone().sub(frame.target), frame.up);
  const worldPerPixel = (2 * frame.distance * tan) / Math.max(band.height, 1);
  const shift = ((band.top + band.bottom) / 2 - band.height / 2) * worldPerPixel;
  const offset = Math.abs(basis.up.z) > 0.05 ? new THREE.Vector3(0, 0, shift / basis.up.z) : basis.up.clone().multiplyScalar(shift);
  return {
    target: frame.target.clone().add(offset),
    position: frame.position.clone().add(offset),
    up: frame.up,
    distance: frame.distance,
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
