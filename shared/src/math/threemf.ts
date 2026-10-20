/**
 * The transform half of the 3MF format: a column-major 4x4 matrix <-> the 12-value attribute string
 * of a `<build><item transform="...">` (R-3).
 *
 * 3MF writes "m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32" – row-major, the translation in the
 * last row. The matrix itself stays column-major here, so the two conversions are exact inverses and
 * a project written and read again lands where it was (P1.3 bug: a transposed rotation).
 */
import type { Matrix4 } from './matrix.js';

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(6).replace(/\.?0+$/, '');
}

/** Convert a column-major 4x4 matrix into the 3MF 12-value transform string. */
export function transformTo3mf(m: Matrix4): string {
  const e = m;
  const vals = [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10], e[12], e[13], e[14]];
  return vals.map(fmt).join(' ');
}

/** Convert a 3MF 12-value transform string (row-major 4x3, translation last) into a column-major 4x4. */
export function transformFrom3mf(s: string): Matrix4 {
  const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  // an empty attribute means identity – note Number('') is 0, not NaN, so the guard below cannot catch it
  if (!s.trim()) return m;
  const v = s.trim().split(/\s+/).map(Number);
  // 3MF stores the rows; the slot list keeps the same numbers in their column-major places, which is
  // the exact inverse of `transformTo3mf`
  const slots = [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14];
  for (let i = 0; i < 12; i++) if (Number.isFinite(v[i])) m[slots[i]] = v[i];
  return m;
}
