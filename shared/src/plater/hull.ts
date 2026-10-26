/**
 * Convex-hull geometry for the plate checks (T-078): the real outline of an instance on the bed,
 * instead of its axis-aligned bounding box.
 *
 * Everything here is plain numbers and dependency-free, so the browser and the server (which read
 * the same models as three.js geometries and as parsed STLs) build the same footprint from the same
 * vertex arrays. An affine map keeps a convex body convex and maps its hull exactly, so a hull
 * computed once in the object's own frame can be moved to the bed by transforming its points.
 *
 * The hull is the convex hull, not the true contour: for a concave part (a C, a bar with a notch) it
 * is larger than the part itself. That keeps every check on the safe side – the toolpath of a concave
 * part can never be tighter than its hull, which is what PrusaSlicer's own conflict check assumes –
 * while a convex, diagonal or rotated object is measured as the shape it is.
 */
import { type Matrix4 } from '../math/matrix.js';

/** A point in the bed plane (mm). */
export type Point2 = [number, number];

/** A convex polygon: its vertices, counter-clockwise, no collinear points. */
export type Hull = Point2[];

const EPS = 1e-9;

/** Twice the signed area of the triangle a-b-c; positive when c is left of a→b. */
function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** Convex hull of a point set (Andrew's monotone chain), counter-clockwise, collinear points dropped. */
export function convexHull2D(points: ReadonlyArray<Point2>): Hull {
  if (points.length < 3) return points.map((p) => [p[0], p[1]] as Point2);
  const sorted = points.map((p) => [p[0], p[1]] as Point2).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const chain: Point2[] = [];
  // lower hull, then upper hull; `<= 0` also drops points on a hull edge
  for (const p of sorted) {
    while (chain.length >= 2 && cross(...chain[chain.length - 2], ...chain[chain.length - 1], ...p) <= EPS) chain.pop();
    chain.push(p);
  }
  const lower = chain.length;
  for (let i = sorted.length - 2; i >= 0; i--) {
    const p = sorted[i];
    while (chain.length > lower && cross(...chain[chain.length - 2], ...chain[chain.length - 1], ...p) <= EPS) chain.pop();
    chain.push(p);
  }
  chain.pop();
  return chain;
}

/** Convex hull of the XY projection of a flat xyz vertex array (a mesh or a part in its own frame). */
export function hullOfFlat(vertices: ArrayLike<number>): Hull {
  const points: Point2[] = [];
  for (let i = 0; i + 1 < vertices.length; i += 3) points.push([vertices[i], vertices[i + 1]]);
  return convexHull2D(points);
}

/** Move a hull into another frame. An affine map keeps it convex, so this is the transformed hull. */
export function transformHull(hull: Hull, m: Matrix4): Hull {
  return hull.map(([x, y]) => [m[0] * x + m[4] * y + m[12], m[1] * x + m[5] * y + m[13]] as Point2);
}

/** Convex hull of several outlines (the footprint of an object with its parts, or of a whole plate). */
export function unionHull(hulls: ReadonlyArray<Hull>): Hull {
  const points: Point2[] = [];
  for (const hull of hulls) points.push(...hull);
  return convexHull2D(points);
}

/** Smallest axis-aligned box around a hull (for the cheap "cannot possibly touch" rejects). */
export function hullBox(hull: Hull): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of hull) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** The hull of an axis-aligned box – what a caller without a mesh (or an old footprint) has. */
export function boxHull(minX: number, minY: number, maxX: number, maxY: number): Hull {
  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
}

/** Area of a hull (shoelace, positive for the counter-clockwise order this module produces). */
export function hullArea(hull: Hull): number {
  if (hull.length < 3) return 0;
  let sum = 0;
  for (let i = 0, j = hull.length - 1; i < hull.length; j = i++) sum += hull[j][0] * hull[i][1] - hull[i][0] * hull[j][1];
  return Math.abs(sum) / 2;
}

/**
 * Smallest distance from a hull to the bed polygon's boundary (0 when it touches or crosses it).
 * Inside the bed, this is how much room is left for a skirt or a brim: PrusaSlicer's skirt and brim
 * follow the object at a rounded (Euclidean) distance, so the margin is measured, not approximated
 * with an offset polygon.
 */
export function hullClearanceToPolygon(hull: Hull, poly: ReadonlyArray<Point2>): number {
  if (!hull.length || !poly.length) return 0;
  let best = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    for (let j = 0; j < poly.length; j++) {
      const d = segmentDistance(a, b, poly[j], poly[(j + 1) % poly.length]);
      if (d < best) best = d;
      if (best === 0) return 0;
    }
  }
  return best;
}

/** Ray casting with the boundary counting as inside (the same rule the bed polygon uses). */
export function pointInPolygon(x: number, y: number, poly: ReadonlyArray<Point2>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (onSegment(x, y, xi, yi, xj, yj)) return true;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const TOUCH = 1e-6;

function onSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): boolean {
  const c = cross(ax, ay, bx, by, px, py);
  const len = Math.hypot(bx - ax, by - ay);
  if (Math.abs(c) > TOUCH * Math.max(1, len)) return false;
  return (
    px >= Math.min(ax, bx) - TOUCH && px <= Math.max(ax, bx) + TOUCH && py >= Math.min(ay, by) - TOUCH && py <= Math.max(ay, by) + TOUCH
  );
}

/** True when the segments cross at an interior point (touching, collinear overlap and corners do not). */
function properlyCross(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const d1 = cross(c[0], c[1], d[0], d[1], a[0], a[1]);
  const d2 = cross(c[0], c[1], d[0], d[1], b[0], b[1]);
  const d3 = cross(a[0], a[1], b[0], b[1], c[0], c[1]);
  const d4 = cross(a[0], a[1], b[0], b[1], d[0], d[1]);
  return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
}

/**
 * True when the hull lies inside the bed polygon (touching the border counts as inside), and – with
 * a `margin` – keeps that distance off the border for a rounded skirt or brim around it.
 *
 * A convex body is inside a simple polygon exactly when all of its vertices are inside and none of
 * its edges crosses a bed edge – that also catches an edge that cuts straight across the notch of an
 * L-shaped bed while both of its ends are on the bed.
 */
export function hullInsidePolygon(hull: Hull, bed: ReadonlyArray<Point2>, margin = 0): boolean {
  if (!hull.length) return false;
  for (const [x, y] of hull) if (!pointInPolygon(x, y, bed)) return false;
  if (hull.length < 2) return margin <= 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    for (let j = 0, k = bed.length - 1; j < bed.length; k = j++) {
      if (properlyCross(a, b, bed[k], bed[j])) return false;
    }
  }
  if (margin <= 0) return true;
  // room left for a rounded skirt/brim: the whole hull has to stay `margin` off the border
  return hullClearanceToPolygon(hull, bed) >= margin - TOUCH;
}

/**
 * Overlap of two convex polygons: the depth of the smallest push that separates them (SAT).
 *
 * Written without allocations, because the arrange scan calls it once per candidate position.
 */
export function hullPenetration(a: Hull, b: Hull): number {
  if (a.length < 3 || b.length < 3) return 0;
  const slack = closestSlack(a, b);
  return slack > 0 ? slack : 0;
}

/**
 * The smallest overlap of the two outlines over all their separating axes: positive is the depth of
 * their penetration, negative is how far the best axis proves them apart.
 *
 * Index loops and no allocations on purpose: the arrange scan runs this thousands of times per
 * item, and `for...of` over the point tuples with destructuring was the top entry in the profile.
 */
function closestSlack(a: Hull, b: Hull): number {
  let slack = Infinity;
  for (let pass = 0; pass < 2; pass++) {
    const poly = pass === 0 ? a : b;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < EPS) continue;
      const nx = dy / len;
      const ny = -dx / len;
      let aMin = Infinity;
      let aMax = -Infinity;
      for (let k = 0; k < a.length; k++) {
        const v = a[k][0] * nx + a[k][1] * ny;
        if (v < aMin) aMin = v;
        if (v > aMax) aMax = v;
      }
      let bMin = Infinity;
      let bMax = -Infinity;
      for (let k = 0; k < b.length; k++) {
        const v = b[k][0] * nx + b[k][1] * ny;
        if (v < bMin) bMin = v;
        if (v > bMax) bMax = v;
      }
      const overlap = (aMax < bMax ? aMax : bMax) - (aMin > bMin ? aMin : bMin);
      if (overlap < slack) slack = overlap;
    }
  }
  return slack === Infinity ? 0 : slack;
}

/**
 * Whether two outlines stay at least `gap` apart and do not overlap. One separating-axis pass
 * answers most of it: a positive slack is an overlap, and a slack of at least `gap` on any axis
 * proves the distance. Only the pairs that no axis settles reach the edge-pair distance, and that
 * stops at the first pair that is too close. `hullPenetration` + `hullGap` would answer the same
 * but runs the axis pass twice and every edge pair every time, which the arrange scan cannot pay.
 */
export function hullKeepsGap(a: Hull, b: Hull, gap: number): boolean {
  if (a.length < 3 || b.length < 3) return true;
  // an axis that proves the gap ends the test right there: most candidates are far apart, so the
  // first or second edge axis settles them and the rest are never projected
  const limit = TOUCH - gap;
  let slack = -Infinity;
  for (let pass = 0; pass < 2; pass++) {
    const poly = pass === 0 ? a : b;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < EPS) continue;
      const overlap = overlapOn(a, b, dy / len, -dx / len);
      if (overlap <= limit) return true;
      if (overlap > slack) slack = overlap;
    }
  }
  // every axis overlaps: the outlines cut into each other
  if (slack > 0) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const r = b[j];
      const s = b[(j + 1) % b.length];
      if (properlyCross(p, q, r, s)) return false;
      if (pointSegment(p, r, s) < limit || pointSegment(q, r, s) < limit) return false;
      if (pointSegment(r, p, q) < limit || pointSegment(s, p, q) < limit) return false;
    }
  }
  return true;
}

/** The overlap of two outlines' extents along a unit axis, as a signed slack. */
function overlapOn(a: Hull, b: Hull, nx: number, ny: number): number {
  let aMin = Infinity;
  let aMax = -Infinity;
  for (let k = 0; k < a.length; k++) {
    const v = a[k][0] * nx + a[k][1] * ny;
    if (v < aMin) aMin = v;
    if (v > aMax) aMax = v;
  }
  let bMin = Infinity;
  let bMax = -Infinity;
  for (let k = 0; k < b.length; k++) {
    const v = b[k][0] * nx + b[k][1] * ny;
    if (v < bMin) bMin = v;
    if (v > bMax) bMax = v;
  }
  return (aMax < bMax ? aMax : bMax) - (aMin > bMin ? aMin : bMin);
}

/**
 * Two outlines' separating axes with both extents along them – everything the axis test of
 * `hullKeepsGap` needs. The axes come from the edges of both outlines and do not change when one of
 * them moves; only its extents shift, by one dot product per axis. A scan that tries one outline at
 * many positions against the same obstacles pays for the projections once per pair instead of once
 * per position.
 */
export interface OutlinePair {
  /** the unit axes, `[nx, ny]` each */
  axes: Float64Array;
  /** the first outline's `[min, max]` per axis, in its own frame */
  first: Float64Array;
  /** the second outline's `[min, max]` per axis */
  second: Float64Array;
}

/** The axes of two outlines and their extents along them – see `OutlinePair`. */
export function outlinePair(first: Hull, second: Hull): OutlinePair {
  const axes: number[] = [];
  for (const poly of [first, second]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      const len = Math.sqrt(dx * dx + dy * dy);
      // a repeated axis cannot change the verdict; it just costs one more projection
      if (len >= EPS) axes.push(dy / len, -dx / len);
    }
  }
  const list = axes.length ? Float64Array.from(axes) : new Float64Array([1, 0]);
  return { axes: list, first: extentsOf(first, list), second: extentsOf(second, list) };
}

function extentsOf(poly: Hull, axes: Float64Array): Float64Array {
  const out = new Float64Array(axes.length);
  for (let a = 0; a < axes.length; a += 2) {
    const nx = axes[a];
    const ny = axes[a + 1];
    let min = Infinity;
    let max = -Infinity;
    for (let k = 0; k < poly.length; k++) {
      const v = poly[k][0] * nx + poly[k][1] * ny;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    out[a] = min;
    out[a + 1] = max;
  }
  return out;
}

/**
 * The axis verdict of a pair whose first outline is translated by (dx, dy): `true` when an axis
 * proves the two are at least `gap` apart, `false` when every axis overlaps (they cut into each
 * other), `undefined` when the outlines are in the touching band and only the edge distances can
 * decide – the caller then falls back to `hullKeepsGap` on the placed outlines.
 */
export function pairGapVerdict(pair: OutlinePair, dx: number, dy: number, gap: number): boolean | undefined {
  const limit = TOUCH - gap;
  let deepest = Infinity;
  for (let a = 0; a < pair.axes.length; a += 2) {
    const shift = dx * pair.axes[a] + dy * pair.axes[a + 1];
    const min = pair.first[a] + shift;
    const max = pair.first[a + 1] + shift;
    const overlap = (max < pair.second[a + 1] ? max : pair.second[a + 1]) - (min > pair.second[a] ? min : pair.second[a]);
    if (overlap <= limit) return true;
    if (overlap < deepest) deepest = overlap;
  }
  return deepest > 0 ? false : undefined;
}

/**
 * Whether two outlines whose separating axes did not decide (see `pairGapVerdict`) stay `gap`
 * apart: the edge-pair distances, stopping at the first pair that is too close. Skips the axis pass
 * the caller has already run.
 */
export function edgesKeepGap(a: Hull, b: Hull, gap: number): boolean {
  if (a.length < 3 || b.length < 3) return true;
  const limit = gap - TOUCH;
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const r = b[j];
      const s = b[(j + 1) % b.length];
      if (properlyCross(p, q, r, s)) return false;
      if (pointSegment(p, r, s) < limit || pointSegment(q, r, s) < limit) return false;
      if (pointSegment(r, p, q) < limit || pointSegment(s, p, q) < limit) return false;
    }
  }
  return true;
}

/** Shortest distance between two hulls; 0 when they touch or overlap. */
export function hullGap(a: Hull, b: Hull): number {
  if (!a.length || !b.length) return Infinity;
  if (hullPenetration(a, b) > 0) return 0;
  let best = Infinity;
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i];
    const a1 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const d = segmentDistance(a0, a1, b[j], b[(j + 1) % b.length]);
      if (d < best) best = d;
    }
  }
  return best;
}

/** Closest distance between two segments (a degenerate segment is a point). */
function segmentDistance(p1: Point2, p2: Point2, q1: Point2, q2: Point2): number {
  if (properlyCross(p1, p2, q1, q2)) return 0;
  return Math.min(pointSegment(p1, q1, q2), pointSegment(p2, q1, q2), pointSegment(q1, p1, p2), pointSegment(q2, p1, p2));
}

function pointSegment(p: Point2, a: Point2, b: Point2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) return Math.sqrt((p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.sqrt((p[0] - (a[0] + t * dx)) ** 2 + (p[1] - (a[1] + t * dy)) ** 2);
}
