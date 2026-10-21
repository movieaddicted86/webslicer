/** Number formatting and the axis order the plater panels share. */

/** Trim a number for a field: two decimals at most, no trailing zeros, "0" for NaN. */
export function fmt(n: number, d = 2) {
  return Number.isFinite(n) ? n.toFixed(d).replace(/\.?0+$/, '') : '0';
}

/** The X, Y, Z order of every placement row. */
export const AXES = ['X', 'Y', 'Z'] as const;
