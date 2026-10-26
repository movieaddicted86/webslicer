/**
 * Packing for the plater: fits the instances' outlines into the bed.
 * Pure and dependency-free so it can be unit tested.
 *
 * `packItems` is the arrangement both sides use: the real convex hulls are nested bottom-left with a
 * spacing between them and an edge reserve for the skirt or brim, so a curved or diagonal part no
 * longer wastes its bounding box and an arranged plate passes the plate check. `packShelf` is
 * PrusaSlicer's simple shelf layout and stays as the fallback when the nesting cannot place
 * everything – never fewer objects placed than before.
 *
 * The browser arranges with this before slicing and the server arranges a project headlessly, so
 * both have to end up with the same layout – which is why the copies this replaces live here now.
 * T-043's arrange options stay: a configurable clearance, 90° turns and a "corner" alignment, plus
 * fixed footprints that stay where they are ("arrange selection").
 */
import { toBool } from '../values.js';
import {
  boxHull,
  convexHull2D,
  hullArea,
  hullBox,
  hullInsidePolygon,
  edgesKeepGap,
  outlinePair,
  pairGapVerdict,
  type Hull,
  type OutlinePair,
  type Point2,
} from './hull.js';

export interface PackItem {
  /** unique key of the item */
  id: string;
  /** footprint (without the arrangement spacing – that is a `PackOptions` concern) */
  width: number;
  height: number;
  /**
   * the item's real outline in its own frame; absent = the `width` × `height` box. The packer keeps
   * `spacing` to it, so a curved or diagonal part can nest into another one's free corner.
   */
  hull?: Hull;
}

export interface PackedItem {
  id: string;
  /** centre of the item inside the bed */
  x: number;
  y: number;
  /** the packer turned this item (only ever set when `rotations` is on) */
  rotated?: boolean;
  /** how far it turned: `1` = 90°, `2` = 180°, `3` = 270°; absent with `rotated` = the plain one */
  turn?: Turn;
}

/** Bed rectangle the items are packed into. */
export interface BedRect {
  min: [number, number];
  max: [number, number];
}

/** Bed rectangle plus the polygon it came from, for the bed outline the viewer draws. */
export interface BedShape extends BedRect {
  points: Array<[number, number]>;
}

/** A footprint that is already on the bed: its centre in bed coordinates, its plain size and hull. */
export interface FixedPackItem extends PackItem {
  x: number;
  y: number;
}

export type PackAlignment = 'center' | 'corner';

/** Options of an arrangement – shared by the browser's Arrange settings and the headless arrange. */
export interface PackOptions {
  /** clearance kept between two items and around fixed ones, mm (default 0: the sizes are as given) */
  spacing?: number;
  /** try the item turned by 90°, 180° or 270° when that packs it tighter (default false) */
  rotations?: boolean;
  /** where the packed block sits in the bed (default `center`: today's layout) */
  alignment?: PackAlignment;
  /** footprints that keep their place and must not be overlapped (default none) */
  fixed?: FixedPackItem[];
  /**
   * room the bed has to keep free around every item, mm: the skirt's distance plus its loops' width
   * or the brim's width, so an arranged plate passes `checkFootprints` (default 0).
   */
  edgeReserve?: number;
  /** the bed polygon the outlines have to stay in; absent = the bed rectangle */
  bedPolygon?: Array<[number, number]>;
}

interface Size {
  id: string;
  width: number;
  height: number;
  rotated?: boolean;
}

interface Row {
  /** offset from the bed's minimum Y */
  y: number;
  height: number;
  /** used width from the bed's minimum X */
  x: number;
  items: Size[];
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const EPS = 1e-9;

/** Bed size relative to its minimum corner. */
function bedSize(bed: BedRect): { width: number; height: number } {
  return { width: bed.max[0] - bed.min[0], height: bed.max[1] - bed.min[1] };
}

/**
 * Pack items into the bed rectangle. Returns the item centres, or `undefined` when a single item
 * is too large for the bed or the items do not fit together. `rotated` marks the items the packer
 * turned by 90° – the caller has to turn the real object as well.
 */
export function packShelf(items: PackItem[], bed: BedRect, options: PackOptions = {}): PackedItem[] | undefined {
  const spacing = Math.max(0, options.spacing ?? 0);
  const { width: bedW, height: bedH } = bedSize(bed);
  if (bedW <= 0 || bedH <= 0) return undefined;
  const sized = items.map((it) => ({ id: it.id, width: it.width + spacing, height: it.height + spacing }));
  // today's layout first: with the options at their defaults this is the only attempt
  const plain = packAttempt(sized, bed, spacing, !!options.rotations, false, options);
  if (plain || !options.rotations) return plain;
  // rotations: retry with every item turned, which packs long items that the plain attempt can't
  const turned = sized.map((it) => ({ ...it, width: it.height, height: it.width, rotated: true }));
  return packAttempt(turned, bed, spacing, false, true, options);
}

/** An item's outline, moved so its bounding box starts at the bed-local origin, plus its extent. */
interface HullShape {
  id: string;
  points: Hull;
  width: number;
  height: number;
  area: number;
  /** the smallest circle around `points`, bed-local like them – the scan's cheap reject */
  circle: Circle;
  /** quarter turns the scan applied to the shape (absent = none) */
  turn?: Turn;
}

/** A quarter turn of the item about its own footprint centre, `1` = 90°, `2` = 180°, `3` = 270°. */
export type Turn = 1 | 2 | 3;

/** A shape's points convexified, moved so its bounding box starts at the origin. */
function normalizeShape(id: string, points: Hull): HullShape {
  const x0 = Math.min(...points.map((p) => p[0]));
  const y0 = Math.min(...points.map((p) => p[1]));
  const local = points.map(([x, y]) => [x - x0, y - y0] as Point2);
  // the overlap tests are separating-axis tests, which need convex outlines; both entry points pass a
  // convex hull already, and hulling here keeps any other caller from breaking the result
  const hull = local.length >= 3 ? convexHull2D(local) : local;
  const box = hullBox(hull);
  return {
    id,
    points: hull,
    width: box.maxX - box.minX,
    height: box.maxY - box.minY,
    area: hullArea(hull),
    circle: circleOf(hull),
  };
}

/** The item's real outline in its own frame, or the box its width and height describe. */
function hullShapeOf(item: PackItem): HullShape {
  return normalizeShape(item.id, item.hull && item.hull.length >= 3 ? item.hull : boxHull(0, 0, item.width, item.height));
}

/**
 * The shape turned by `k` quarter turns; its points still start at the origin. The caller applies the
 * same turn to the real object, so the bed result is exactly what the viewer then shows.
 */
function turnShape(shape: HullShape, k: Turn): HullShape {
  let points = shape.points;
  // the same quarter turn applied `k` times; the offset it leaves behind is uniform, so normalising
  // once at the end recovers the outline exactly
  for (let i = 0; i < k; i++) points = points.map(([x, y]) => [shape.height - y, x] as Point2);
  return { ...normalizeShape(shape.id, points), turn: k };
}

/** An outline in bed coordinates: the shape placed with its box's lower corner at a bed-local spot. */
function placedHull(shape: HullShape, x: number, y: number, bed: BedRect): Hull {
  return shape.points.map(([px, py]) => [bed.min[0] + x + px, bed.min[1] + y + py] as Point2);
}

/**
 * A key that is the same for one outline however it is turned: the vertices from the lowest one,
 * rounded to the micron (float noise from the turns must not make two equal outlines look different).
 */
function outlineKey(points: Hull): string {
  let start = 0;
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i];
    const [bx, by] = points[start];
    if (x < bx - EPS || (Math.abs(x - bx) <= EPS && y < by - EPS)) start = i;
  }
  return points
    .map((_, i) => {
      const [x, y] = points[(i + start) % points.length];
      return `${Math.round(x * 1e6) / 1e6},${Math.round(y * 1e6) / 1e6}`;
    })
    .join(' ');
}

/**
 * The orientations worth scanning: the plain outline first, then each quarter turn that gives a
 * *different* outline. A square part has one, so the cube-heavy plates – the common case – scan a
 * quarter of the turns they used to, and a rotated copy never gets marked for no visible change.
 */
function orientationsOf(shape: HullShape, last: number): HullShape[] {
  const out = [shape];
  const seen = new Set([outlineKey(shape.points)]);
  for (let k = 1; k <= last; k++) {
    const turned = turnShape(shape, k as Turn);
    const key = outlineKey(turned.points);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(turned);
  }
  return out;
}

/** True when no quarter turn of this item gives it a different outline (a square or a circle). */
function turnInvariant(shape: HullShape): boolean {
  return orientationsOf(shape, 3).length === 1;
}

type Box = { minX: number; minY: number; maxX: number; maxY: number };

/** True when the two boxes are at least `gap` apart on one axis – then so are the outlines. */
function boxesApart(a: Box, b: Box, gap: number): boolean {
  return a.minX - b.maxX >= gap || b.minX - a.maxX >= gap || a.minY - b.maxY >= gap || b.minY - a.maxY >= gap;
}

/**
 * A cheap "these two outlines are certainly far apart" test: the circumcircles of both hulls are
 * further apart than the spacing. Most candidate positions fail on it, which keeps the exact polygon
 * tests (two O(n·m) passes) for the handful that can actually touch.
 */
function circlesApart(a: Circle, b: Circle, spacing: number): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const reach = a.r + b.r + spacing;
  return dx * dx + dy * dy >= reach * reach;
}

/**
 * The smallest circle around an outline – the minimal enclosing circle of a convex polygon, which
 * either has two vertices on its diameter or three on its rim. It is the tightest cheap bound the
 * scan has, and for the outlines here (a dozen vertices) the brute force is paid once per shape.
 */
function circleOf(points: Hull): Circle {
  const inside = (c: Circle) => points.every(([x, y]) => Math.hypot(x - c.x, y - c.y) <= c.r + 1e-9);
  for (let i = 0; i < points.length; i++) {
    for (let k = i + 1; k < points.length; k++) {
      const [ax, ay] = points[i];
      const [bx, by] = points[k];
      const c = { x: (ax + bx) / 2, y: (ay + by) / 2, r: Math.hypot(ax - bx, ay - by) / 2 };
      if (inside(c)) return c;
    }
  }
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      for (let k = j + 1; k < points.length; k++) {
        const c = circumcircle(points[i], points[j], points[k]);
        if (c && inside(c)) return c;
      }
    }
  }
  // a single point (an outline of two points or fewer cannot occur – `normalizeShape` boxes it)
  return { x: points[0][0], y: points[0][1], r: 0 };
}

/** The same circle, shifted by the shape's offset into bed coordinates. */
function moved(circle: Circle, dx: number, dy: number): Circle {
  return { x: circle.x + dx, y: circle.y + dy, r: circle.r };
}

/** The circle through three points, or `undefined` when they are collinear. */
function circumcircle(a: Point2, b: Point2, c: Point2): Circle | undefined {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-12) return undefined;
  const a2 = a[0] ** 2 + a[1] ** 2;
  const b2 = b[0] ** 2 + b[1] ** 2;
  const c2 = c[0] ** 2 + c[1] ** 2;
  const x = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
  const y = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
  return { x, y, r: Math.hypot(a[0] - x, a[1] - y) };
}

/**
 * True when the outline keeps `spacing` from every outline already on the bed. `circle` is the
 * shape's own (placed circle, bed-local), so the cheap reject costs one subtraction per obstacle.
 * The placed outline is only built when one of those rejects does not decide, which is the case
 * for a handful of candidates per row.
 */
function clearOfPlaced(
  shape: HullShape,
  x: number,
  y: number,
  box: Box,
  circle: Circle,
  bed: BedRect,
  placed: BandObstacle[],
  spacing: number,
): boolean {
  let hull: Hull | undefined;
  for (const other of placed) {
    if (boxesApart(box, other.box, spacing)) continue;
    if (circlesApart(circle, other.circle, spacing)) continue;
    // the shapes' own frames are fixed: shifting the candidate is one dot product per axis, while
    // the edge distance below is the expensive part – it only runs when no axis decides
    const verdict = other.pair ? pairGapVerdict(other.pair, x, y, spacing) : undefined;
    if (verdict === true) continue;
    if (verdict === false) return false;
    hull ??= placedHull(shape, x, y, bed);
    // the outlines may touch when no clearance was asked for, but they may never cut into each other
    if (!edgesKeepGap(hull, other.hull, spacing)) return false;
  }
  return true;
}

/** An outline on the bed with the two cheap bounds the scan rejects on. */
interface Circle {
  x: number;
  y: number;
  r: number;
}

interface Obstacle {
  hull: Hull;
  box: Box;
  circle: Circle;
}

/** A band obstacle plus the axis data of the current shape against it, projected once per row. */
interface BandObstacle extends Obstacle {
  pair?: OutlinePair;
}

/**
 * One item of the scan: the orientation found and the bed-local lower corner of its box.
 */
interface Placement {
  shape: HullShape;
  x: number;
  y: number;
  box: Box;
  /** the shape's circle in bed coordinates – the cheap reject for the next items */
  circle: Circle;
}

/** One packed item: the placement and its outline in bed coordinates. */
interface Packed extends Placement {
  hull: Hull;
}

/** What one nesting pass has to respect: the bed with the edge reserve, and the outlines on it. */
interface Limits {
  bed: BedRect;
  bedPoly: ReadonlyArray<Point2>;
  reserve: number;
  spacing: number;
  /** the fixed outlines of "arrange selection" – obstacles, never moved */
  fixed: Obstacle[];
  /** the outlines this pass has placed so far; also obstacles for the next item */
  placed: Obstacle[];
}

/**
 * Nest items into the bed on their real outlines (T-084): largest hull first, each placed at the
 * lowest, then leftmost free spot of a bounded 1 mm scan, at 0° or – with `rotations` – 90°, keeping
 * `spacing` to every outline already on the bed and `edgeReserve` off the bed border. Returns the
 * item centres, or `undefined` when an item does not fit. Deterministic: same input, same layout, in
 * the browser and in the headless arrange.
 *
 * Fixed footprints ("arrange selection") stay where they are and are obstacles. Without fixed items
 * the finished block is centred or moved to the bed corner as the alignment says; with them the free
 * space decides where it goes.
 */
export function packItems(items: PackItem[], bed: BedRect, options: PackOptions = {}): PackedItem[] | undefined {
  const { width: bedW, height: bedH } = bedSize(bed);
  if (bedW <= 0 || bedH <= 0 || !items.length) return undefined;
  const limits: Limits = {
    bed,
    bedPoly: options.bedPolygon ?? boxHull(bed.min[0], bed.min[1], bed.max[0], bed.max[1]),
    reserve: Math.max(0, options.edgeReserve ?? 0),
    spacing: Math.max(0, options.spacing ?? 0),
    fixed: [],
    placed: [],
  };
  // a fixed footprint keeps its centre, so its box's lower corner is half a size below it
  for (const f of options.fixed ?? []) {
    const shape = hullShapeOf(f);
    const x = f.x - bed.min[0] - shape.width / 2;
    const y = f.y - bed.min[1] - shape.height / 2;
    const hull = placedHull(shape, x, y, bed);
    limits.fixed.push({
      hull,
      box: hullBox(hull),
      circle: moved(shape.circle, bed.min[0] + x, bed.min[1] + y),
    });
  }

  // largest outline first: the big parts decide the layout, the small ones fill the gaps afterwards;
  // the id breaks ties so the result never depends on the caller's list order
  const order = items.map(hullShapeOf).sort((a, b) => b.area - a.area || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // without rotations the plain pass is the arrangement; with them two passes compete on the block
  // they leave, the plain orientation winning ties inside each: the per-item quarter turns, which
  // is what lets two L brackets interlock, and every item turned the same way, the only way long
  // bars come to lie in rows. A plate of squares or round parts looks the same however it is
  // turned, so it takes the plain pass alone.
  const modes: RotationMode[] = options.rotations && !order.every(turnInvariant) ? ['mixed', 'all'] : ['none'];
  let best: Packed[] | undefined;
  let bestArea = Infinity;
  for (const mode of modes) {
    const packed = nestAttempt(order, bedW, bedH, limits, mode);
    if (!packed) continue;
    const area = blockArea(packed[packed.length - 1], packed.slice(0, -1));
    if (area < bestArea - EPS) {
      best = packed;
      bestArea = area;
    }
  }
  return best ? layoutOf(best, limits, bed, bedW, bedH, options.alignment === 'corner') : undefined;
}

/** One nesting pass: every item placed by the scan under the given rotation rule. */
function nestAttempt(order: HullShape[], bedW: number, bedH: number, limits: Limits, mode: RotationMode): Packed[] | undefined {
  const placed: Obstacle[] = [];
  const results: Packed[] = [];
  for (const shape of order) {
    const spot = placeShape(shape, bedW, bedH, { ...limits, placed }, mode);
    if (!spot) return undefined;
    const hull = placedHull(spot.shape, spot.x, spot.y, limits.bed);
    const box = spot.box;
    results.push({ ...spot, hull });
    placed.push({ hull, box, circle: spot.circle });
  }
  return results;
}

/** How a nesting pass may turn the items: never, per item, or every item the same way. */
type RotationMode = 'none' | 'mixed' | 'all';

/** The callers' answer: every item's centre on the bed, the turned ones marked. */
function layoutOf(packed: Packed[], limits: Limits, bed: BedRect, bedW: number, bedH: number, corner: boolean): PackedItem[] {
  // without fixed outlines the block is centred (or stays in the corner, as before); with them the
  // free space decided where it goes
  const shift = corner || limits.fixed.length ? { dx: 0, dy: 0 } : centreShift(packed, bedW, bedH, limits.reserve);
  return packed.map(({ shape, x, y, box }) => ({
    id: shape.id,
    x: bed.min[0] + x + shift.dx + (box.maxX - box.minX) / 2,
    y: bed.min[1] + y + shift.dy + (box.maxY - box.minY) / 2,
    ...(shape.turn ? { rotated: true, turn: shape.turn } : {}),
  }));
}

/**
 * The offset that centres the packed block in the bed, rounded so the block's lower corner lands on
 * a whole millimetre (the old layout's coordinates). The corner is clamped into the usable area, so
 * an edge reserve that is not a whole millimetre (a 6.4 mm skirt) still centres the block.
 */
function centreShift(results: Packed[], bedW: number, bedH: number, reserve: number): { dx: number; dy: number } {
  const minX = Math.min(...results.map((r) => r.x));
  const minY = Math.min(...results.map((r) => r.y));
  const maxX = Math.max(...results.map((r) => r.x + (r.box.maxX - r.box.minX)));
  const maxY = Math.max(...results.map((r) => r.y + (r.box.maxY - r.box.minY)));
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  return {
    dx: wholeStart((bedW - spanX) / 2, reserve, bedW - reserve - spanX) - minX,
    dy: wholeStart((bedH - spanY) / 2, reserve, bedH - reserve - spanY) - minY,
  };
}

/** The nearest whole millimetre to `at`, clamped into `[from, to]` when that range is not empty. */
function wholeStart(at: number, from: number, to: number): number {
  const value = Math.round(at);
  return to < from ? at : Math.min(Math.max(value, from), to);
}

/**
 * The best free spot under the rotation rule, or `undefined` when the item fits nowhere. With
 * `mixed` it tries the quarter turns that really change the outline and keeps the cheapest block,
 * the plain orientation on a tie – two L brackets only interlock when the second one faces the
 * first, a 180° turn, and a square part is never marked for a turn nobody can see. `all` turns every
 * item 90°, which is the only way long bars that fit the width plain but not the height come to lie
 * in rows.
 */
function placeShape(shape: HullShape, bedW: number, bedH: number, limits: Limits, mode: RotationMode): Placement | undefined {
  if (mode === 'none') return scanShape(shape, bedW, bedH, limits);
  const orientations = orientationsOf(shape, mode === 'all' ? 1 : 3);
  if (mode === 'all') return scanShape(orientations[orientations.length - 1], bedW, bedH, limits);
  let best: Placement | undefined;
  let bestArea = Infinity;
  // the plain orientation first, so a tie keeps the unturned part; each further scan is bounded by
  // the block found so far, so the hopeless spots of the turned outlines are dropped at once
  for (const candidate of orientations) {
    const spot = scanShape(candidate, bedW, bedH, limits, bestArea);
    if (!spot) continue;
    const area = blockArea(spot, limits.placed);
    if (area < bestArea - EPS) {
      best = spot;
      bestArea = area;
    }
  }
  return best;
}

/**
 * The best free spot of one orientation: candidates scored by how much block the item adds to the
 * bed (the bounding box of the outlines placed so far), ties going to the lower, then left-hand
 * spot. A pure bottom-left fit never enters a part's free corner when the empty floor is lower, so
 * it would never nest – the block score is what makes an L's notch the better spot.
 *
 * The free spots of a row come first; then the contact positions beside and centred on every
 * obstacle of the row, where the boxes overlap but the outlines may interlock (two L brackets only
 * nest when the second one sits inside the first one's cut corner). `blockBound` stops the row scan
 * once no later row can beat the best block found.
 */
function scanShape(shape: HullShape, bedW: number, bedH: number, limits: Limits, limit = Infinity): Placement | undefined {
  const { reserve, bedPoly, spacing, bed, fixed, placed } = limits;
  const maxX = bedW - reserve - shape.width;
  const maxY = bedH - reserve - shape.height;
  if (maxX < -EPS || maxY < -EPS) return undefined;
  const obstacles = [...fixed, ...placed];
  const rectangle = isRectangle(bedPoly);
  const band: BandObstacle[] = [];
  // the axis data of this shape against each obstacle does not change from row to row
  const pairs = new Map<Obstacle, OutlinePair>();
  const pairOf = (o: Obstacle): OutlinePair => {
    let pair = pairs.get(o);
    if (!pair) {
      pair = outlinePair(shape.points, o.hull);
      pairs.set(o, pair);
    }
    return pair;
  };
  const spanX = placedSpanX(placed);
  // the block of the outlines placed so far is the same for every candidate of this scan, so its
  // bounding box is measured once – checking a candidate against it is then four comparisons
  const settled = placedBlock(placed);
  let best: Placement | undefined;
  let bestArea = limit;
  for (let y = reserve; y <= maxY + EPS; y += 1) {
    if (best && spanX * (y + shape.height - (placed.length ? placedMinY(placed) : y)) > bestArea + EPS) break;
    const y0 = bed.min[1] + y;
    band.length = 0;
    // the obstacles that reach into this row band, as their own extent inside it; a box that does
    // not reach the band is skipped before the outline is sliced, and one that lies *inside* the
    // band needs no slice at all – its box is its extent there, which is the common case
    for (const o of obstacles) {
      if (o.box.minY > y0 + shape.height + spacing || o.box.maxY < y0 - spacing) continue;
      const inside = o.box.minY >= y0 - spacing - EPS && o.box.maxY <= y0 + shape.height + spacing + EPS;
      const box = inside ? o.box : slabOf(o.hull, y0 - spacing, y0 + shape.height + spacing);
      if (box) band.push({ hull: o.hull, box, circle: o.circle, pair: pairOf(o) });
    }
    for (const x of candidateXs(shape, band, bed.min[0], reserve, maxX, spacing)) {
      const spot = candidate(shape, x, y, bed, bedPoly, reserve, spacing, band, rectangle, settled, bestArea);
      if (!spot) continue;
      const area = blockArea(spot, placed);
      if (area < bestArea - EPS) {
        best = spot;
        bestArea = area;
      }
    }
  }
  return best;
}

/** The x positions of one row worth trying: the free spots, then the contact spots of the obstacles. */
function candidateXs(shape: HullShape, band: Array<{ box: Box }>, minX: number, reserve: number, maxX: number, spacing: number): number[] {
  const xs = new Set<number>();
  const inRange = (x: number) => x >= reserve - EPS && x <= maxX + EPS;
  let x = reserve;
  for (let guard = 0; guard <= band.length && x <= maxX + EPS; guard++) {
    const free = firstFreeX(band, x, shape.width, spacing, maxX, minX);
    if (free > maxX + EPS) break;
    if (inRange(free)) xs.add(free);
    x = free + 1;
  }
  // beside and centred on an obstacle, where the boxes touch although the outlines may not
  for (const o of band) {
    const width = o.box.maxX - o.box.minX;
    for (const at of [o.box.minX - minX, o.box.maxX - minX - shape.width, o.box.minX - minX + (width - shape.width) / 2]) {
      if (inRange(at)) xs.add(at);
    }
  }
  return [...xs];
}

/** The x span of the placed outlines' boxes (zero when nothing is placed yet). */
function placedSpanX(placed: Array<{ box: Box }>): number {
  if (!placed.length) return 0;
  return Math.max(...placed.map((p) => p.box.maxX)) - Math.min(...placed.map((p) => p.box.minX));
}

/** The lowest edge of the placed outlines' boxes, bed-local. */
function placedMinY(placed: Array<{ box: Box }>): number {
  return Math.min(...placed.map((p) => p.box.minY));
}

/** The bed-coordinate box the shape would take at the bed-local spot (x, y). */
function spotBox(shape: HullShape, x: number, y: number, bed: BedRect): Box {
  return {
    minX: bed.min[0] + x,
    minY: bed.min[1] + y,
    maxX: bed.min[0] + x + shape.width,
    maxY: bed.min[1] + y + shape.height,
  };
}

/** The block a spot makes with the outlines already on the bed – the scan's tie-breaker. */
function blockArea(spot: { box: Box }, placed: Array<{ box: Box }>): number {
  return blockAreaWith(spot.box, placedBlock(placed));
}

/** The bounding box of everything placed so far, or `undefined` when the bed is still empty. */
function placedBlock(placed: Array<{ box: Box }>): Box | undefined {
  if (!placed.length) return undefined;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of placed) {
    if (p.box.minX < minX) minX = p.box.minX;
    if (p.box.minY < minY) minY = p.box.minY;
    if (p.box.maxX > maxX) maxX = p.box.maxX;
    if (p.box.maxY > maxY) maxY = p.box.maxY;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * The block a candidate box would make with the settled one, or with nothing when it is the first –
 * four comparisons instead of one pair per placed item.
 */
function blockAreaWith(box: Box, settled: Box | undefined): number {
  if (!settled) return (box.maxX - box.minX) * (box.maxY - box.minY);
  const minX = box.minX < settled.minX ? box.minX : settled.minX;
  const minY = box.minY < settled.minY ? box.minY : settled.minY;
  const maxX = box.maxX > settled.maxX ? box.maxX : settled.maxX;
  const maxY = box.maxY > settled.maxY ? box.maxY : settled.maxY;
  return (maxX - minX) * (maxY - minY);
}

/**
 * An outline's own x and y reach between two heights – what the part really takes of a row band,
 * not the whole box the shelf layout would keep free. `undefined` when it does not reach the band.
 */
function slabOf(hull: Hull, y0: number, y1: number): Box | undefined {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number) => {
    if (y < y0 - EPS || y > y1 + EPS) return;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };
  for (const [x, y] of hull) add(x, y);
  for (let i = 0; i < hull.length; i++) {
    const [ax, ay] = hull[i];
    const [bx, by] = hull[(i + 1) % hull.length];
    if (Math.abs(by - ay) < EPS) continue;
    for (const y of [y0, y1]) {
      if (y < Math.min(ay, by) - EPS || y > Math.max(ay, by) + EPS) continue;
      add(ax + ((y - ay) / (by - ay)) * (bx - ax), y);
    }
  }
  return minX < Infinity ? { minX, minY, maxX, maxY } : undefined;
}

/** The first x at or after `x` where the box fits the bed and no obstacle's band reach overlaps it. */
function firstFreeX(band: Array<{ box: Box }>, x: number, width: number, spacing: number, maxX: number, minX: number): number {
  let px = x;
  for (let guard = 0; guard <= band.length && px <= maxX + EPS; guard++) {
    const hit = band.find((o) => minX + px < o.box.maxX + spacing - EPS && minX + px + width > o.box.minX - spacing + EPS);
    if (!hit) return px;
    px = hit.box.maxX + spacing - minX;
  }
  return maxX + 1;
}

/**
 * One scan candidate: the outline test, or `undefined` when the spot is taken or out of the bed.
 * `bestArea` is the block of the best spot found so far: a spot that cannot beat it is dropped
 * before the polygon tests, which are the expensive part of the scan.
 */
function candidate(
  shape: HullShape,
  x: number,
  y: number,
  bed: BedRect,
  bedPoly: ReadonlyArray<Point2>,
  reserve: number,
  spacing: number,
  band: BandObstacle[],
  rectangle: boolean,
  settled: Box | undefined,
  bestArea: number,
): Placement | undefined {
  if (x > bed.max[0] - bed.min[0] - reserve - shape.width + EPS) return undefined;
  const box = spotBox(shape, x, y, bed);
  // a spot whose block is already bigger than the best one cannot win; the block is a handful of
  // comparisons, the outline tests below are hundreds of multiplications – this is where the scan
  // spends most of its time, so the prune comes first
  if (blockAreaWith(box, settled) > bestArea + 1e-6) return undefined;
  // on a rectangular bed the box tests are the whole border check (the reserve is one inset)
  if (rectangle && (box.minX < bed.min[0] + reserve - EPS || box.minY < bed.min[1] + reserve - EPS)) return undefined;
  if (rectangle && (box.maxX > bed.max[0] - reserve + EPS || box.maxY > bed.max[1] - reserve + EPS)) return undefined;
  const circle = moved(shape.circle, bed.min[0] + x, bed.min[1] + y);
  if (!clearOfPlaced(shape, x, y, box, circle, bed, band, spacing)) return undefined;
  // any other bed – an L, a rounded plate – needs the polygon and its measured margin
  if (!rectangle && !hullInsidePolygon(placedHull(shape, x, y, bed), bedPoly, reserve)) return undefined;
  return { shape, x, y, box, circle };
}

/** True when the bed polygon is exactly the axis-aligned rectangle of its own bounding box. */
function isRectangle(poly: ReadonlyArray<Point2>): boolean {
  if (poly.length !== 4) return false;
  const box = hullBox(poly as Hull);
  const corners: Point2[] = [
    [box.minX, box.minY],
    [box.maxX, box.minY],
    [box.maxX, box.maxY],
    [box.minX, box.maxY],
  ];
  return corners.every(([cx, cy]) => poly.some(([px, py]) => Math.abs(px - cx) < EPS && Math.abs(py - cy) < EPS));
}

/**
 * One packing attempt: shelf rows from the given sizes, then the alignment and fixed-footprint pass.
 * `allowTurn` lets an item join a row turned when its plain orientation does not fit; `forceTurn`
 * marks every placed item as turned (the all-rotated attempt).
 */
function packAttempt(
  items: Size[],
  bed: BedRect,
  spacing: number,
  allowTurn: boolean,
  forceTurn: boolean,
  options: PackOptions,
): PackedItem[] | undefined {
  const { height: bedH } = bedSize(bed);
  const rows = shelfRows(items, bed, allowTurn);
  if (!rows) return undefined;
  const totalH = rows.reduce((acc, r) => acc + r.height, 0);
  if (totalH > bedH + EPS) return undefined;
  const fixed = (options.fixed ?? []).map((f) => rectOf(f, spacing, bed));
  // without fixed footprints the block sits where it always did; with them the offsets are tried
  // from the lowest free band upwards, so a selection moves into the free space below the others
  for (const y0 of blockOffsets(bedH, totalH, options.alignment, fixed.length > 0)) {
    const packed = placeRows(rows, y0, bed, fixed, options.alignment === 'corner', forceTurn);
    if (packed) return packed;
  }
  return undefined;
}

/** Vertical start offsets of the packed block, in the order they are tried. */
function blockOffsets(bedH: number, totalH: number, alignment: PackAlignment | undefined, hasFixed: boolean): number[] {
  const max = bedH - totalH;
  if (alignment === 'corner') return scanOffsets(0, max);
  const centre = max / 2;
  return hasFixed ? [centre, ...scanOffsets(0, max)] : [centre];
}

/** Every whole millimetre from `from` to `to`, both included. */
function scanOffsets(from: number, to: number): number[] {
  const out: number[] = [];
  for (let y = from; y <= to + EPS; y += 1) out.push(y);
  return out;
}

/** Place the rows with their top at `y0`, pushing every item right of a fixed footprint. */
function placeRows(rows: Row[], y0: number, bed: BedRect, fixed: Rect[], corner: boolean, forceTurn: boolean): PackedItem[] | undefined {
  const { width: bedW } = bedSize(bed);
  const packed: PackedItem[] = [];
  let y = y0;
  for (const row of rows) {
    const rowW = row.items.reduce((acc, it) => acc + it.width, 0);
    let x = corner ? 0 : (bedW - rowW) / 2;
    for (const it of row.items) {
      const placedAt = clearOfFixed(x, y, it, fixed, bedW);
      if (placedAt === undefined) return undefined;
      packed.push({
        id: it.id,
        x: bed.min[0] + placedAt + it.width / 2,
        y: bed.min[1] + y + row.height / 2,
        ...(forceTurn || it.rotated ? { rotated: true, turn: 1 as Turn } : {}),
      });
      x = placedAt + it.width;
    }
    y += row.height;
  }
  return packed;
}

/** The shelf rows of one attempt, or `undefined` when an item cannot be placed at all. */
function shelfRows(items: Size[], bed: BedRect, allowTurn: boolean): Row[] | undefined {
  const { width: bedW } = bedSize(bed);
  const sorted = [...items].sort((a, b) => b.width * b.height - a.width * a.height);
  const rows: Row[] = [];
  for (const item of sorted) {
    if (!placeItem(rows, item, bedW, allowTurn)) return undefined;
  }
  return rows;
}

/** Put one item into the first row that takes it (turned when allowed), else open a new row. */
function placeItem(rows: Row[], item: Size, bedW: number, allowTurn: boolean): boolean {
  const turned: Size = { ...item, width: item.height, height: item.width, rotated: true };
  let row = rows.find((r) => rowTakes(r, item, bedW));
  let chosen = item;
  if (!row && allowTurn) {
    row = rows.find((r) => rowTakes(r, turned, bedW));
    chosen = turned;
  }
  if (!row) {
    // a new row: take the orientation that fits the bed width, the plain one when both do
    chosen = item.width <= bedW + EPS ? item : allowTurn && turned.width <= bedW + EPS ? turned : item;
    if (chosen.width > bedW + EPS) return false;
    row = { y: rows.reduce((acc, r) => acc + r.height, 0), height: chosen.height, x: 0, items: [] };
    rows.push(row);
  }
  row.items.push(chosen);
  row.x += chosen.width;
  row.height = Math.max(row.height, chosen.height);
  return true;
}

/** Today's row rule: the row has room and the item is not much higher than the row. */
function rowTakes(row: Row, item: Size, bedW: number): boolean {
  return row.x + item.width <= bedW + EPS && item.height <= row.height * 1.5;
}

/** The fixed footprint as a bed-local rectangle, inflated by half the spacing on every side. */
function rectOf(f: FixedPackItem, spacing: number, bed: BedRect): Rect {
  const w = f.width + spacing;
  const h = f.height + spacing;
  return { x0: f.x - w / 2 - bed.min[0], y0: f.y - h / 2 - bed.min[1], x1: f.x + w / 2 - bed.min[0], y1: f.y + h / 2 - bed.min[1] };
}

/**
 * The first x at or after `x` where an item does not overlap a fixed footprint, or `undefined`
 * when it no longer fits the bed. Items are pushed to the right of a blocker, like a shelf.
 */
function clearOfFixed(x: number, y: number, item: Size, fixed: Rect[], bedW: number): number | undefined {
  let px = x;
  for (let guard = 0; guard <= fixed.length; guard++) {
    if (px + item.width > bedW + EPS) return undefined;
    const hit = fixed.find((r) => px < r.x1 - EPS && px + item.width > r.x0 + EPS && y < r.y1 - EPS && y + item.height > r.y0 + EPS);
    if (!hit) return px;
    px = hit.x1;
  }
  return undefined;
}

/**
 * The arrangement both entry points call: the outline nesting first, and PrusaSlicer's shelf layout
 * as the fallback when the nesting cannot place everything – an arrange never places fewer objects
 * than the shelf layout did. Same input, same layout in the browser and in the headless arrange.
 */
export function arrangeItems(items: PackItem[], bed: BedRect, options: PackOptions = {}): PackedItem[] | undefined {
  return packItems(items, bed, options) ?? packShelf(items, bed, options);
}

/**
 * How many copies of one footprint fit into a bed that already holds `existing`: starts from the
 * grid estimate floor(bedW/w) * floor(bedH/h) minus the existing items, then reduces the count
 * until the arrangement really fits them all. Never more than `limit`. `spacing` is the clearance
 * the arrangement keeps between the copies (the footprints passed in are plain sizes). The copies
 * are boxes – a fill picks a plain footprint, and the count is a grid estimate, not a nest.
 */
export function fillCount(
  width: number,
  height: number,
  existing: PackItem[],
  bed: BedRect,
  options: { limit?: number; spacing?: number } = {},
): number {
  if (!(width > 0) || !(height > 0)) return 0;
  const spacing = Math.max(0, options.spacing ?? 0);
  const limit = options.limit ?? 1000;
  if (!packShelf([...existing, { id: 'fill-new', width, height }], bed, { spacing })) return 0;
  const { width: bedW, height: bedH } = bedSize(bed);
  const cols = Math.max(1, Math.floor(bedW / (width + spacing)));
  const rows = Math.max(1, Math.floor(bedH / (height + spacing)));
  let n = Math.min(cols * rows - existing.length, limit);
  for (; n > 0; n--) {
    const copies = Array.from({ length: n }, (_, i) => ({ id: `fill-${i}`, width, height }));
    if (packShelf([...existing, ...copies], bed, { spacing })) return n;
  }
  return 0;
}

/** Bed rectangle and polygon of a printer preset, from its `bed_shape` ("0x0,250x0,250x210,0x210"). */
export function bedShapeOf(printerCfg: Record<string, string>): BedShape {
  const pts = (printerCfg.bed_shape || '0x0,200x0,200x200,0x200')
    .split(',')
    .map((p) => p.split('x').map(Number) as [number, number])
    .filter((p) => p.length === 2 && !p.some((n) => Number.isNaN(n)));
  if (!pts.length) pts.push([0, 0], [200, 0], [200, 200], [0, 200]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)], points: pts };
}

/**
 * Clearance kept between two arranged items. With sequential printing the extruder has to reach
 * around every object, so the extruder clearance radius applies; otherwise a small fixed gap.
 */
export function arrangementSpacing(printCfg: Record<string, string>): number {
  const radius = Number(printCfg.extruder_clearance_radius);
  return radius > 0 && toBool(printCfg.complete_objects) ? radius : 6;
}
