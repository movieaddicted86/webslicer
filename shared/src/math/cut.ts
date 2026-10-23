/**
 * The cut plane maths (T-044): the rotation that turns a plane normal onto +Z, and the adjustments of
 * the two parts after the cut.
 *
 * The PrusaSlicer CLI only knows horizontal cuts (`--cut <z>`), so the server turns the mesh into a
 * frame where the user's plane is horizontal (`z = planeZ`), cuts there and turns the parts back. The
 * browser needs the same rotation to preview the plane, so the maths lives here once and both sides
 * use it (no second copy in `web/`).
 */
import type { Vec3 } from '../types/index.js';
import { apply, IDENTITY, multiply, translate, type Matrix4 } from './matrix.js';

/** Length of a vector. */
function length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

/** The unit form of `v`, or `undefined` for a zero vector (a plane without a direction). */
export function unit(v: Vec3): Vec3 | undefined {
  const n = length(v);
  if (!(n > 1e-9) || !Number.isFinite(n)) return undefined;
  return [v[0] / n, v[1] / n, v[2] / n];
}

/** The cross product `a × b`. */
export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * A rotation that maps the unit vector `from` onto `to` (Rodrigues' formula). The result is a proper
 * rotation, so it also serves as the "cut frame" of a plane: applying it to world points puts the
 * plane's normal on +Z. `undefined` when either vector has no direction.
 */
export function rotationBetween(from: Vec3, to: Vec3): Matrix4 | undefined {
  const a = unit(from);
  const b = unit(to);
  if (!a || !b) return undefined;
  const v = cross(a, b);
  const cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const sin = length(v);
  if (sin < 1e-9) {
    if (cos > 0) return IDENTITY.slice();
    // opposite vectors: a half turn about an axis perpendicular to `a` (X unless `a` is along X);
    // a half turn about the unit axis u is `2·u·uᵀ − I`
    const [x, y, z] = (Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]) as Vec3;
    return [
      2 * x * x - 1,
      2 * y * x,
      2 * z * x,
      0,
      2 * x * y,
      2 * y * y - 1,
      2 * z * y,
      0,
      2 * x * z,
      2 * y * z,
      2 * z * z - 1,
      0,
      0,
      0,
      0,
      1,
    ];
  }
  // R = I + K + K²·(1 − cos)/sin² with K = skew(v), |v| = sin
  const k = 1 / (1 + cos);
  const [x, y, z] = v;
  return [
    1 - k * (y * y + z * z),
    k * x * y + z,
    k * x * z - y,
    0,
    k * x * y - z,
    1 - k * (x * x + z * z),
    k * y * z + x,
    0,
    k * x * z + y,
    k * y * z - x,
    1 - k * (x * x + y * y),
    0,
    0,
    0,
    0,
    1,
  ];
}

/** A cut plane in world coordinates: a point on it and its normal. */
export interface CutPlane {
  point: Vec3;
  normal: Vec3;
}

/** The frame the CLI cuts in: `rotation` turns world points into it, `planeZ` is the plane's height there. */
export interface PlaneFrame {
  rotation: Matrix4;
  planeZ: number;
}

/**
 * The cut frame of a plane: the rotation that puts the normal on +Z, and the plane's height in that
 * frame. `undefined` for a normal without a direction (nothing to cut with).
 */
export function planeFrame(plane: CutPlane): PlaneFrame | undefined {
  const rotation = rotationBetween(plane.normal, [0, 0, 1]);
  if (!rotation) return undefined;
  return { rotation, planeZ: apply(rotation, plane.point[0], plane.point[1], plane.point[2])[2] };
}

/**
 * The turn a part gets after the cut, in the cut frame (both parts have their cut face at `z = planeZ`:
 * the lower one's faces up, the upper one's faces down). The turn is a half turn about the cut frame's
 * X axis through the plane, so the cut face stays on the plane:
 *
 * - `flipUpper`: the upper part is turned over, which puts its cut face on top (printable side up).
 * - `placeOnCut` for the lower part: it is turned over as well – that is what puts its cut face onto
 *   the bed. The upper part only needs `placeOnBed` for that.
 */
export function cutRotation(kind: 'upper' | 'lower', planeZ: number, opts: { flipUpper?: boolean; placeOnCut?: boolean } = {}): Matrix4 {
  const turn = kind === 'upper' ? !!opts.flipUpper : !!opts.placeOnCut;
  if (!turn) return IDENTITY.slice();
  const halfTurnX: Matrix4 = [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1];
  return multiply(translate(0, 0, planeZ), multiply(halfTurnX, translate(0, 0, -planeZ)));
}
