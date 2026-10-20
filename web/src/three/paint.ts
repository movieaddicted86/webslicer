/**
 * Triangle painting (support enforcers/blockers, seam) on non-indexed geometries.
 * PrusaSlicer stores paint per triangle as a hex nibble string
 * (slic3rpe:custom_supports / slic3rpe:custom_seam); whole-triangle states encode as
 * "4" (enforcer) and "8" (blocker).
 */
import * as THREE from 'three';

export type PaintKind = 'supports' | 'seam' | 'mmu';
export const PAINT_NONE = 0;
export const PAINT_ENFORCER = 1;
export const PAINT_BLOCKER = 2;

export const PAINT_COLORS: Record<number, [number, number, number]> = {
  [PAINT_ENFORCER]: [0.25, 0.45, 1.0],
  [PAINT_BLOCKER]: [1.0, 0.3, 0.3],
};

/**
 * Split triangles until no edge is longer than `maxEdge` (midpoint subdivision of the
 * longest edge). Returns a new non-indexed geometry; the first triangles keep their order
 * so existing paint arrays can be mapped (see remapPaint).
 */
export function subdivideForPainting(g: THREE.BufferGeometry, maxEdge: number, maxTriangles = 400_000): { geometry: THREE.BufferGeometry; parent: Uint32Array } {
  const src = (g.getIndex() ? g.toNonIndexed() : g).getAttribute('position').array as Float32Array;
  const n = src.length / 9;
  // working list of triangles as flat coords + parent index
  let tris: number[] = Array.from(src);
  let parents: number[] = Array.from({ length: n }, (_, i) => i);
  const maxSq = maxEdge * maxEdge;
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 40 && tris.length / 9 < maxTriangles) {
    changed = false;
    const out: number[] = [];
    const outParents: number[] = [];
    for (let t = 0; t < tris.length; t += 9) {
      const ax = tris[t], ay = tris[t + 1], az = tris[t + 2];
      const bx = tris[t + 3], by = tris[t + 4], bz = tris[t + 5];
      const cx = tris[t + 6], cy = tris[t + 7], cz = tris[t + 8];
      const ab = (bx - ax) ** 2 + (by - ay) ** 2 + (bz - az) ** 2;
      const bc = (cx - bx) ** 2 + (cy - by) ** 2 + (cz - bz) ** 2;
      const ca = (ax - cx) ** 2 + (ay - cy) ** 2 + (az - cz) ** 2;
      const longest = Math.max(ab, bc, ca);
      const parent = parents[t / 9];
      if (longest <= maxSq || out.length / 9 + 2 > maxTriangles) {
        out.push(ax, ay, az, bx, by, bz, cx, cy, cz);
        outParents.push(parent);
        continue;
      }
      changed = true;
      if (longest === ab) {
        const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;
        out.push(ax, ay, az, mx, my, mz, cx, cy, cz, mx, my, mz, bx, by, bz, cx, cy, cz);
      } else if (longest === bc) {
        const mx = (bx + cx) / 2, my = (by + cy) / 2, mz = (bz + cz) / 2;
        out.push(ax, ay, az, bx, by, bz, mx, my, mz, ax, ay, az, mx, my, mz, cx, cy, cz);
      } else {
        const mx = (cx + ax) / 2, my = (cy + ay) / 2, mz = (cz + az) / 2;
        out.push(ax, ay, az, bx, by, bz, mx, my, mz, mx, my, mz, bx, by, bz, cx, cy, cz);
      }
      outParents.push(parent, parent);
    }
    tris = out;
    parents = outParents;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(tris, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return { geometry, parent: Uint32Array.from(parents) };
}

/** Map an old per-triangle paint array through the subdivision parent table. */
export function remapPaint(old: Uint8Array | undefined, parent: Uint32Array): Uint8Array | undefined {
  if (!old) return undefined;
  const out = new Uint8Array(parent.length);
  for (let i = 0; i < parent.length; i++) out[i] = old[parent[i]] || 0;
  return out;
}

/** Triangle centroids (object space) for brush lookups. */
export function computeCentroids(g: THREE.BufferGeometry): Float32Array {
  const p = g.getAttribute('position').array as Float32Array;
  const n = p.length / 9;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const o = i * 9;
    c[i * 3] = (p[o] + p[o + 3] + p[o + 6]) / 3;
    c[i * 3 + 1] = (p[o + 1] + p[o + 4] + p[o + 7]) / 3;
    c[i * 3 + 2] = (p[o + 2] + p[o + 5] + p[o + 8]) / 3;
  }
  return c;
}

/** Indices of triangles whose centroid lies within `radius` of `center` (object space). */
export function trianglesInSphere(centroids: Float32Array, center: THREE.Vector3, radius: number): number[] {
  const out: number[] = [];
  const r2 = radius * radius;
  for (let i = 0, n = centroids.length / 3; i < n; i++) {
    const dx = centroids[i * 3] - center.x;
    const dy = centroids[i * 3 + 1] - center.y;
    const dz = centroids[i * 3 + 2] - center.z;
    if (dx * dx + dy * dy + dz * dz <= r2) out.push(i);
  }
  return out;
}

/**
 * Fill a vertex colour attribute from a paint array (base colour for unpainted triangles).
 * `palette` maps a state to a colour; defaults to enforcer/blocker colours.
 */
export function paintToColors(
  paint: Uint8Array | undefined,
  triCount: number,
  base: THREE.Color,
  target?: Float32Array,
  palette: (state: number) => [number, number, number] | undefined = (s) => PAINT_COLORS[s],
): Float32Array {
  const colors = target && target.length === triCount * 9 ? target : new Float32Array(triCount * 9);
  for (let i = 0; i < triCount; i++) {
    const s = paint ? paint[i] : 0;
    const c = s ? palette(s) : undefined;
    const r = c ? c[0] : base.r;
    const g = c ? c[1] : base.g;
    const b = c ? c[2] : base.b;
    const o = i * 9;
    colors[o] = colors[o + 3] = colors[o + 6] = r;
    colors[o + 1] = colors[o + 4] = colors[o + 7] = g;
    colors[o + 2] = colors[o + 5] = colors[o + 8] = b;
  }
  return colors;
}

/** Encode a paint array as PrusaSlicer per-triangle hex strings joined by nothing: one char per triangle. */
export function encodePaint(paint: Uint8Array): string {
  let s = '';
  for (let i = 0; i < paint.length; i++) s += paint[i] === PAINT_ENFORCER ? '4' : paint[i] === PAINT_BLOCKER ? '8' : '0';
  return s;
}

/** MMU paint: one hex char per triangle = extruder index */
export function encodeMmu(paint: Uint8Array): string {
  let s = '';
  for (let i = 0; i < paint.length; i++) s += (paint[i] & 15).toString(16);
  return s;
}

export function decodeMmu(s: string | undefined, triCount: number): Uint8Array | undefined {
  if (!s) return undefined;
  const out = new Uint8Array(triCount);
  let any = false;
  for (let i = 0; i < Math.min(s.length, triCount); i++) {
    out[i] = parseInt(s[i], 16) || 0;
    if (out[i]) any = true;
  }
  return any ? out : undefined;
}

export function decodePaint(s: string | undefined, triCount: number): Uint8Array | undefined {
  if (!s) return undefined;
  const out = new Uint8Array(triCount);
  let any = false;
  for (let i = 0; i < Math.min(s.length, triCount); i++) {
    const c = s[i];
    out[i] = c === '4' ? PAINT_ENFORCER : c === '8' ? PAINT_BLOCKER : 0;
    if (out[i]) any = true;
  }
  return any ? out : undefined;
}
