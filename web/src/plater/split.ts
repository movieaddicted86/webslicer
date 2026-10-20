/**
 * Split a mesh into its connected shells (PrusaSlicer's "Split to objects" / "Split to parts").
 * Pure math on a non-indexed position array: no three.js geometry, no store, no rendering.
 *
 * Loaded meshes are non-indexed, so shared vertices are duplicated in the buffer; connectivity is
 * rebuilt by welding positions onto a grid.
 */
import type { Bounds } from '@webslicer/shared';

/** Welding grid in mm: two vertices whose coordinates round to the same cell are one vertex. */
const GRID = 1e-4;

/**
 * Connected shells of a non-indexed triangle soup, as triangle index lists sorted by size
 * (largest first). A hollow shell – one with negative signed volume, i.e. an inward-facing inner
 * wall – that lies inside another shell's bounding box is not a shell of its own: it is merged
 * into that enclosing shell, so a hollow object counts as one part.
 */
export function splitShells(positions: Float32Array): Uint32Array[] {
  const triCount = Math.floor(positions.length / 9);
  if (triCount < 1) return [];

  // weld: quantise every vertex onto the grid, equal cells share one vertex id
  const cellIds = new Map<string, number>();
  const corner = new Uint32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const o = t * 9 + k * 3;
      const key = `${Math.round(positions[o] / GRID)},${Math.round(positions[o + 1] / GRID)},${Math.round(positions[o + 2] / GRID)}`;
      let id = cellIds.get(key);
      if (id === undefined) {
        id = cellIds.size;
        cellIds.set(key, id);
      }
      corner[t * 3 + k] = id;
    }
  }

  // union-find over triangles: two triangles that use a welded vertex belong to the same shell
  const parent = new Uint32Array(triCount);
  for (let i = 0; i < triCount; i++) parent[i] = i;
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root];
    while (parent[x] !== root) {
      const next = parent[x];
      parent[x] = root;
      x = next;
    }
    return root;
  };
  const firstUse = new Map<number, number>();
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const vertex = corner[t * 3 + k];
      const first = firstUse.get(vertex);
      if (first === undefined) firstUse.set(vertex, t);
      else {
        const a = find(first);
        const b = find(t);
        if (a !== b) parent[b] = a;
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let t = 0; t < triCount; t++) {
    const root = find(t);
    const group = groups.get(root);
    if (group) group.push(t);
    else groups.set(root, [t]);
  }
  const shells = Array.from(groups.values(), (tris) => Uint32Array.from(tris));
  mergeHollowShells(positions, shells);
  // largest first; the magnitude keeps an inverted single shell from sorting to the end
  return shells
    .filter((s) => s.length > 0)
    .sort((a, b) => Math.abs(signedVolume(positions, b)) - Math.abs(signedVolume(positions, a)));
}

/** Flat position array of a set of triangles of a non-indexed mesh (a shell's own geometry). */
export function shellPositions(positions: Float32Array, tris: Uint32Array): Float32Array {
  const out = new Float32Array(tris.length * 9);
  for (let i = 0; i < tris.length; i++) {
    const src = tris[i] * 9;
    const dst = i * 9;
    for (let k = 0; k < 9; k++) out[dst + k] = positions[src + k];
  }
  return out;
}

/** Signed volume of a set of triangles (positive when they face outwards, negative for a cavity). */
export function signedVolume(positions: Float32Array, tris: Uint32Array): number {
  let volume = 0;
  for (let i = 0; i < tris.length; i++) {
    const o = tris[i] * 9;
    const ax = positions[o], ay = positions[o + 1], az = positions[o + 2];
    const bx = positions[o + 3], by = positions[o + 4], bz = positions[o + 5];
    const cx = positions[o + 6], cy = positions[o + 7], cz = positions[o + 8];
    volume += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return volume / 6;
}

function shellBounds(positions: Float32Array, tris: Uint32Array): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i++) {
    const o = tris[i] * 9;
    for (let k = 0; k < 3; k++) {
      for (let a = 0; a < 3; a++) {
        const v = positions[o + k * 3 + a];
        if (v < min[a]) min[a] = v;
        if (v > max[a]) max[a] = v;
      }
    }
  }
  return { min, max };
}

/** True when `inner` lies within `outer` (a small tolerance keeps touching walls inside). */
function boxInside(outer: Bounds, inner: Bounds): boolean {
  const eps = 1e-6;
  return (
    inner.min[0] >= outer.min[0] - eps &&
    inner.min[1] >= outer.min[1] - eps &&
    inner.min[2] >= outer.min[2] - eps &&
    inner.max[0] <= outer.max[0] + eps &&
    inner.max[1] <= outer.max[1] + eps &&
    inner.max[2] <= outer.max[2] + eps
  );
}

/** Merge inward-facing shells that sit inside an outward-facing shell into that shell (in place). */
function mergeHollowShells(positions: Float32Array, shells: Uint32Array[]): void {
  const volumes = shells.map((tris) => signedVolume(positions, tris));
  const bounds = shells.map((tris) => shellBounds(positions, tris));
  for (let i = 0; i < shells.length; i++) {
    if (volumes[i] >= 0) continue; // outward-facing shells are never folded away
    const host = shells.findIndex((_, j) => j !== i && volumes[j] > 0 && boxInside(bounds[j], bounds[i]));
    if (host < 0) continue;
    shells[host] = Uint32Array.from([...shells[host], ...shells[i]].sort((a, b) => a - b));
    shells[i] = new Uint32Array(0);
  }
}
