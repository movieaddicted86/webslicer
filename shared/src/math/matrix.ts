/**
 * Column-major 4x4 matrices and placements – the one implementation the browser and the headless
 * plater share (R-3, `docs/refactoring/AUDIT.md`).
 *
 * A `Matrix4` is the 16 numbers `three.js` keeps in `Matrix4.elements`: column by column, the
 * translation in slots 12..14. Everything stays free of three.js; `web/src/three/matrix.ts` is the
 * thin adapter that converts, and the server uses the array form directly.
 *
 * The placement conventions are the browser's, because the browser is what the user sees and what
 * the server has to reproduce: Euler XYZ in radians, one matrix per instance, and a mirror that
 * turns the instance over in place (T-001).
 */
import type { Placement, Vec3 } from '../types/index.js';

/** A 4x4 matrix, column-major (`three.js` `Matrix4.elements` order). */
export type Matrix4 = number[];

/** The identity matrix. */
export const IDENTITY: Matrix4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** A pure translation. */
export function translate(x: number, y: number, z: number): Matrix4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

/**
 * `a · b` for column-major 4x4 matrices: element `e[c * 4 + r]` is row `r`, column `c`, so
 * `(a·b)[c * 4 + r] = Σ_k a[k * 4 + r] * b[c * 4 + k]`. The right-hand matrix is applied to a point
 * first: `apply(multiply(a, b), p) = apply(a, apply(b, p))`.
 */
export function multiply(a: Matrix4, b: Matrix4): Matrix4 {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

/**
 * Inverse of an affine column-major 4x4 matrix, or `undefined` for a singular linear part (a scale
 * of zero). Only the affine case is needed – every placement this app builds is `T · R · S` – so the
 * last row is assumed to be `0 0 0 1`.
 */
export function invert(m: Matrix4): Matrix4 | undefined {
  // rows 1-3 of the linear part, "column, row" labels as in the other functions here
  const a = m[0],
    b = m[4],
    c = m[8];
  const d = m[1],
    e = m[5],
    f = m[9];
  const g = m[2],
    h = m[6],
    i = m[10];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return undefined;
  const k = 1 / det;
  // inverse of the 3x3 linear part, row by row
  const r00 = (e * i - f * h) * k;
  const r01 = (c * h - b * i) * k;
  const r02 = (b * f - c * e) * k;
  const r10 = (f * g - d * i) * k;
  const r11 = (a * i - c * g) * k;
  const r12 = (c * d - a * f) * k;
  const r20 = (d * h - e * g) * k;
  const r21 = (b * g - a * h) * k;
  const r22 = (a * e - b * d) * k;
  const [tx, ty, tz] = [m[12], m[13], m[14]];
  return [
    r00,
    r10,
    r20,
    0,
    r01,
    r11,
    r21,
    0,
    r02,
    r12,
    r22,
    0,
    -(r00 * tx + r01 * ty + r02 * tz),
    -(r10 * tx + r11 * ty + r12 * tz),
    -(r20 * tx + r21 * ty + r22 * tz),
    1,
  ];
}

/** Apply a column-major 4x4 matrix to one point. */
export function apply(m: Matrix4, x: number, y: number, z: number): Vec3 {
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}

/**
 * Determinant of the linear part (rows 1-3, columns 1-3). A negative value means the matrix mirrors,
 * which is what tells `placementFromMatrix` to put the sign into the first scale component.
 */
export function determinant(m: Matrix4): number {
  return m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
}

/**
 * World matrix of a placement: `T(position) · R(euler XYZ) · S(scale)`, built exactly like
 * `three.js` `Matrix4.compose` (Euler XYZ in radians) so the browser's rendering, its slice request
 * and the server's plater all speak the same matrix.
 */
export function placementMatrix(p: Pick<Placement, 'position' | 'rotation' | 'scale'>): Matrix4 {
  const [rx, ry, rz] = p.rotation;
  const c1 = Math.cos(rx / 2);
  const c2 = Math.cos(ry / 2);
  const c3 = Math.cos(rz / 2);
  const s1 = Math.sin(rx / 2);
  const s2 = Math.sin(ry / 2);
  const s3 = Math.sin(rz / 2);
  // Euler XYZ -> quaternion (`Quaternion.setFromEuler(euler, 'XYZ')`)
  return quaternionMatrix(
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
    p.scale,
    p.position,
  );
}

type Quaternion = [number, number, number, number];

/**
 * `Matrix4.compose`: the rotation of a quaternion, its columns scaled by `scale`, the translation in
 * the last column. The `scale` may be negative, which is how a mirrored placement is stored.
 */
function quaternionMatrix(qx: number, qy: number, qz: number, qw: number, scale: Vec3, position: Vec3): Matrix4 {
  const x2 = qx + qx;
  const y2 = qy + qy;
  const z2 = qz + qz;
  const xx = qx * x2;
  const xy = qx * y2;
  const xz = qx * z2;
  const yy = qy * y2;
  const yz = qy * z2;
  const zz = qz * z2;
  const wx = qw * x2;
  const wy = qw * y2;
  const wz = qw * z2;
  const [sx, sy, sz] = scale;
  return [
    (1 - (yy + zz)) * sx,
    (xy + wz) * sx,
    (xz - wy) * sx,
    0,
    (xy - wz) * sy,
    (1 - (xx + zz)) * sy,
    (yz + wx) * sy,
    0,
    (xz + wy) * sz,
    (yz - wx) * sz,
    (1 - (xx + yy)) * sz,
    0,
    position[0],
    position[1],
    position[2],
    1,
  ];
}

/** `Quaternion.setFromRotationMatrix` for a matrix whose columns are already unit length. */
function quaternionFromRotation(r: Matrix4): Quaternion {
  // m11..m33 as in three.js: "column, row", 1-based
  const m11 = r[0];
  const m12 = r[4];
  const m13 = r[8];
  const m21 = r[1];
  const m22 = r[5];
  const m23 = r[9];
  const m31 = r[2];
  const m32 = r[6];
  const m33 = r[10];
  const trace = m11 + m22 + m33;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return [(m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s];
  }
  if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    return [0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s];
  }
  if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    return [(m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s];
  }
  const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
  return [(m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s];
}

/**
 * Euler XYZ (radians) of a quaternion, extracted the way three.js' `Euler.setFromQuaternion` does:
 * through the rotation matrix, and with its gimbal-lock branch. The browser shows these angles in the
 * transform panel, so a 90 degree rotation has to come back as 90 degrees and not as its equivalent.
 */
function eulerXyz(q: Quaternion): Vec3 {
  const r = quaternionMatrix(q[0], q[1], q[2], q[3], [1, 1, 1], [0, 0, 0]);
  // m13, m23, m33 / m12 / m11 / m22 / m32 are "column, row" with a 1-based label, as in three.js
  const m11 = r[0];
  const m12 = r[4];
  const m22 = r[5];
  const m32 = r[6];
  const m13 = r[8];
  const m23 = r[9];
  const m33 = r[10];
  const y = Math.asin(Math.min(1, Math.max(-1, m13)));
  if (Math.abs(m13) < 0.9999999) return [Math.atan2(-m23, m33), y, Math.atan2(-m12, m11)];
  return [Math.atan2(m32, m22), y, 0];
}

/**
 * Decompose a world matrix back into a placement (`three.js` `Matrix4.decompose`): the translation is
 * the last column, the scale is the length of the three basis vectors, the rotation is what is left.
 *
 * A mirrored matrix does not have a unique placement, and this follows three.js: the negative
 * determinant goes into the **first** scale component and the rotation is taken with it. So "mirror Z"
 * can come back as "mirror X plus a 180 degree rotation" – the same transform, and the only thing that
 * has to hold is `placementMatrix(placementFromMatrix(M)) = M` (T-001, review finding 1).
 */
export function placementFromMatrix(m: Matrix4): Placement {
  const sx0 = Math.hypot(m[0], m[1], m[2]);
  const sy = Math.hypot(m[4], m[5], m[6]);
  const sz = Math.hypot(m[8], m[9], m[10]);
  const sx = determinant(m) < 0 ? -sx0 : sx0;
  // normalise the basis vectors: a negative `sx` turns the mirror into a proper rotation
  const invX = 1 / sx;
  const invY = 1 / sy;
  const invZ = 1 / sz;
  const r = m.slice();
  r[0] *= invX;
  r[1] *= invX;
  r[2] *= invX;
  r[4] *= invY;
  r[5] *= invY;
  r[6] *= invY;
  r[8] *= invZ;
  r[9] *= invZ;
  r[10] *= invZ;
  return { position: [m[12], m[13], m[14]], rotation: eulerXyz(quaternionFromRotation(r)), scale: [sx, sy, sz] };
}

/**
 * Mirror a placement along a world axis through the instance's own position (PrusaSlicer's
 * "Mirror X/Y/Z"): `M' = T(p) · S(axis = -1) · T(-p) · M`, M = matrix of `placement`.
 * The mirror therefore keeps the instance where it is and turns it over in place.
 *
 * Decomposing M' puts the sign into the scale, so a mirrored instance has exactly one negative scale
 * component (two mirrors cancel, three flip again). Negating a local scale component instead would be
 * wrong as soon as the instance is rotated (T-001 bug: the sign moved without the rotation).
 */
export function mirrorPlacement(placement: Placement, axis: 0 | 1 | 2): Placement {
  const [px, py, pz] = placement.position;
  const sign: Vec3 = [axis === 0 ? -1 : 1, axis === 1 ? -1 : 1, axis === 2 ? -1 : 1];
  const mirror: Matrix4 = [sign[0], 0, 0, 0, 0, sign[1], 0, 0, 0, 0, sign[2], 0, px, py, pz, 1];
  return placementFromMatrix(multiply(multiply(mirror, translate(-px, -py, -pz)), placementMatrix(placement)));
}
