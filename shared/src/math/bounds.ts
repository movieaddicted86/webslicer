/**
 * Bounding boxes and model normalisation (R-3) – the maths the browser's `addObjects` and the
 * headless plater both need.
 *
 * An imported model is centred in X/Y and its minimum Z is put on the bed: the geometry is moved by
 * `-c`, and every instance matrix is moved by `Translate(c)` instead, so `M_j · Translate(c)` applied
 * to the centred vertex `v - c` gives `M_j · v` – the position the file had. The instance position is
 * therefore `M_j · c`, not `c` added to the translation (P1.3 bug `cx + x`).
 */
import type { Bounds, Vec3 } from '../types/index.js';
import { IDENTITY, multiply, translate, apply, type Matrix4 } from './matrix.js';

/** Bounding box of a vertex list (flat xyz). */
export function meshBounds(vertices: Float32Array): Bounds {
  if (!vertices.length) return { min: [0, 0, 0], max: [0, 0, 0] };
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
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
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  // the eight corners are enough: an affine map keeps the box a box (rotated, but its axis-aligned hull
  // is what the arrangement needs) – same result as the browser's Box3.applyMatrix4
  for (let i = 0; i < 8; i++) {
    const p = apply(matrix, i & 1 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1], i & 4 ? box.max[2] : box.min[2]);
    for (let a = 0; a < 3; a++) {
      if (p[a] < min[a]) min[a] = p[a];
      if (p[a] > max[a]) max[a] = p[a];
    }
  }
  return { min, max };
}

/** Move a vertex list by `-c` (returns a new array; the input is not touched). */
export function translateVertices(vertices: Float32Array, c: Vec3): Float32Array {
  const out = new Float32Array(vertices.length);
  for (let i = 0; i < vertices.length; i += 3) {
    out[i] = vertices[i] - c[0];
    out[i + 1] = vertices[i + 1] - c[1];
    out[i + 2] = vertices[i + 2] - c[2];
  }
  return out;
}

/**
 * Offset applied to an imported geometry: centre in X/Y, minimum Z on the bed.
 * The geometry is moved by `-c`, the instance matrices by `Translate(c)` (see `normalize`).
 */
export function normalizationOffset(bounds: Bounds): Vec3 {
  return [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, bounds.min[2]];
}

/**
 * Normalise a model: centre its vertices in X/Y with the minimum Z on the bed and move every
 * instance matrix by the same offset, so the placed copies keep the position they had in the file.
 * An empty instance list means "one copy at the object's own origin" and gets the identity.
 */
export function normalize(vertices: Float32Array, instances: Matrix4[]): { vertices: Float32Array; offset: Vec3; instances: Matrix4[] } {
  const c = normalizationOffset(meshBounds(vertices));
  const shift = translate(c[0], c[1], c[2]);
  return {
    vertices: translateVertices(vertices, c),
    offset: c,
    instances: (instances.length ? instances : [IDENTITY]).map((m) => multiply(m, shift)),
  };
}
