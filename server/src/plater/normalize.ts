/**
 * Model normalisation for the headless plater – the port of `addObjects` in
 * `web/src/state/store.ts`.
 *
 * The browser centres an imported geometry in X/Y and puts its minimum Z on the bed, then places it
 * with one matrix per instance. A project import brings object coordinates (the object sits at its
 * own origin) plus one build-item transform per instance, so the copy has to go back where the file
 * had it: with the offset `c = (centre X, centre Y, min Z)` the instance matrix becomes
 * `M_j · Translate(c)` – the same formula the browser uses. Applying it to the centred geometry
 * `v - c` gives `M_j · v`, i.e. exactly the position the file had.
 */

import type { Bounds } from '@webslicer/shared';

/** 4x4 matrices are column-major (three.js `Matrix4.elements` order), as everywhere else in WebSlicer. */
export type Matrix4 = number[];

export const IDENTITY: Matrix4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function translateMatrix(x: number, y: number, z: number): Matrix4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

/**
 * `a · b` for column-major 4x4 matrices: element `e[c * 4 + r]` is row `r`, column `c`, so
 * `(a·b)[c * 4 + r] = Σ_k a[k * 4 + r] * b[c * 4 + k]`.
 */
export function multiplyMatrix(a: Matrix4, b: Matrix4): Matrix4 {
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

/** Apply a column-major 4x4 matrix to one point. */
export function applyMatrix(m: Matrix4, x: number, y: number, z: number): [number, number, number] {
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}

/** Bounding box of a vertex list (flat xyz). */
export function meshBounds(vertices: Float32Array): Bounds {
  if (!vertices.length) return { min: [0, 0, 0], max: [0, 0, 0] };
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertices.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = vertices[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}

/** World bounds of one instance: the mesh bounds through the instance matrix. */
export function instanceBounds(box: Bounds, matrix: Matrix4): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  // the eight corners are enough: an affine map keeps the box a box (rotated, but its axis-aligned hull
  // is what the arrangement needs) – same result as the browser's Box3.applyMatrix4
  for (let i = 0; i < 8; i++) {
    const p = applyMatrix(matrix, i & 1 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1], i & 4 ? box.max[2] : box.min[2]);
    for (let a = 0; a < 3; a++) {
      if (p[a] < min[a]) min[a] = p[a];
      if (p[a] > max[a]) max[a] = p[a];
    }
  }
  return { min, max };
}

/** Move a vertex list by `-c` (returns a new array; the input is not touched). */
export function translateVertices(vertices: Float32Array, c: [number, number, number]): Float32Array {
  const out = new Float32Array(vertices.length);
  for (let i = 0; i < vertices.length; i += 3) {
    out[i] = vertices[i] - c[0];
    out[i + 1] = vertices[i + 1] - c[1];
    out[i + 2] = vertices[i + 2] - c[2];
  }
  return out;
}

/**
 * Offset the browser applies to an imported geometry: centre in X/Y, minimum Z on the bed.
 * The geometry is moved by `-c`, the instance matrices by `Translate(c)` (see `normalize`).
 */
export function normalizationOffset(bounds: Bounds): [number, number, number] {
  return [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, bounds.min[2]];
}

/**
 * Normalise a model: centre its vertices in X/Y with the minimum Z on the bed and move every
 * instance matrix by the same offset, so the placed copies keep the position they had in the file.
 */
export function normalize(
  vertices: Float32Array,
  instances: Matrix4[],
): { vertices: Float32Array; offset: [number, number, number]; instances: Matrix4[] } {
  const c = normalizationOffset(meshBounds(vertices));
  const shift = translateMatrix(c[0], c[1], c[2]);
  return {
    vertices: translateVertices(vertices, c),
    offset: c,
    instances: (instances.length ? instances : [IDENTITY]).map((m) => multiplyMatrix(m, shift)),
  };
}
