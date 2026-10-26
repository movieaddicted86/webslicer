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

/** Overlap of two convex polygons: the depth of the smallest push that separates them (SAT). */
export function hullPenetration(a: Hull, b: Hull): number {
  if (a.length < 3 || b.length < 3) return 0;
  let depth = Infinity;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < EPS) continue;
      const nx = (q[1] - p[1]) / len;
      const ny = -(q[0] - p[0]) / len;
      const pa = project(a, nx, ny);
      const pb = project(b, nx, ny);
      const overlap = Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min);
      if (overlap <= 0) return 0;
      if (overlap < depth) depth = overlap;
    }
  }
  return depth === Infinity ? 0 : depth;
}

function project(poly: Hull, nx: number, ny: number): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const [x, y] of poly) {
    const v = x * nx + y * ny;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
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
  if (len2 < EPS) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
