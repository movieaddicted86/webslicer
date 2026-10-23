/**
 * Shelf packing for the plater: fits rectangles (object/instance footprints) into the bed.
 * Pure and dependency-free so it can be unit tested.
 *
 * This is PrusaSlicer's simple arrangement: rows from the back of the bed, largest item first,
 * every row centred horizontally. The browser arranges with it before slicing and the server
 * arranges a project headlessly, so both have to end up with the same layout – which is why the
 * three copies this replaces (`web/src/plater/packing.ts`, `server/src/plater/packing.ts` and the
 * `bedShapeOf`/`arrangementSpacing` pair in `web/src/state/store.ts`) live here now.
 *
 * T-043 adds the arrange options PrusaSlicer offers: a configurable clearance, 90° turns and a
 * "corner" alignment, plus fixed footprints that stay where they are ("arrange selection"). All of
 * them default to the layout above, so callers that pass no options get today's bed exactly.
 */
import { toBool } from '../values.js';

export interface PackItem {
  /** unique key of the item */
  id: string;
  /** footprint (without the arrangement spacing – that is a `PackOptions` concern) */
  width: number;
  height: number;
}

export interface PackedItem {
  id: string;
  /** centre of the item inside the bed */
  x: number;
  y: number;
  /** the packer turned this item by 90° (only set when `rotations` found it necessary) */
  rotated?: boolean;
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

/** A footprint that is already on the bed: its centre in bed coordinates and its plain size. */
export interface FixedPackItem extends PackItem {
  x: number;
  y: number;
}

export type PackAlignment = 'center' | 'corner';

/** Options of an arrangement – shared by the browser's Arrange settings and the headless arrange. */
export interface PackOptions {
  /** clearance kept between two items and around fixed ones, mm (default 0: the sizes are as given) */
  spacing?: number;
  /** try the item turned by 90° when that lets it fit (default false) */
  rotations?: boolean;
  /** where the packed block sits in the bed (default `center`: today's layout) */
  alignment?: PackAlignment;
  /** footprints that keep their place and must not be overlapped (default none) */
  fixed?: FixedPackItem[];
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
        ...(forceTurn || it.rotated ? { rotated: true } : {}),
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
 * How many copies of one footprint fit into a bed that already holds `existing`: starts from the
 * grid estimate floor(bedW/w) * floor(bedH/h) minus the existing items, then reduces the count
 * until the shelf packing really fits them all. Never more than `limit`. `spacing` is the clearance
 * the arrangement keeps between the copies (the footprints passed in are plain sizes).
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
