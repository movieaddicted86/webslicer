/**
 * Shelf packing for the server-side plater: fits rectangles (object/instance footprints) into the bed.
 * Pure and dependency-free so it can be unit tested.
 *
 * This is a **port of `web/src/plater/packing.ts`** – both copies must stay in sync (same algorithm,
 * same results); the browser arranges with the same code before slicing, so a project arranged
 * headlessly has to end up with the same layout. No shared package in this phase.
 */

export interface PackItem {
  /** unique key of the item */
  id: string;
  /** footprint including the clearance to the next item */
  width: number;
  height: number;
}

export interface PackedItem {
  id: string;
  /** centre of the item inside the bed */
  x: number;
  y: number;
}

export interface BedRect {
  min: [number, number];
  max: [number, number];
}

/**
 * Pack items into the bed rectangle. Returns the item centres, or `undefined` when a single item
 * is too large for the bed or the items do not fit together.
 */
export function packShelf(items: PackItem[], bed: BedRect): PackedItem[] | undefined {
  const bedW = bed.max[0] - bed.min[0];
  const bedH = bed.max[1] - bed.min[1];
  if (bedW <= 0 || bedH <= 0) return undefined;
  for (const it of items) if (it.width > bedW || it.height > bedH) return undefined;
  const sorted = [...items].sort((a, b) => b.width * b.height - a.width * a.height);
  const rows: Array<{ y: number; h: number; x: number; items: PackItem[] }> = [];
  for (const it of sorted) {
    let row = rows.find((r) => r.x + it.width <= bedW && it.height <= r.h * 1.5);
    if (!row) {
      const y = rows.reduce((acc, r) => acc + r.h, 0);
      row = { y, h: it.height, x: 0, items: [] };
      rows.push(row);
    }
    row.items.push(it);
    row.h = Math.max(row.h, it.height);
    row.x += it.width;
  }
  const totalH = rows.reduce((acc, r) => acc + r.h, 0);
  if (totalH > bedH) return undefined;
  const out: PackedItem[] = [];
  let y = bed.min[1] + (bedH - totalH) / 2;
  for (const row of rows) {
    const rowW = row.items.reduce((acc, i) => acc + i.width, 0);
    let x = bed.min[0] + (bedW - rowW) / 2;
    for (const it of row.items) {
      out.push({ id: it.id, x: x + it.width / 2, y: y + row.h / 2 });
      x += it.width;
    }
    y += row.h;
  }
  return out;
}

/**
 * How many copies of one footprint (including spacing) fit on a bed that already holds `existing`:
 * starts from the grid estimate floor(bedW/w) * floor(bedH/h) minus the existing items, then
 * reduces the count until the shelf packing really fits them all. Never more than `limit`.
 */
export function fillCount(width: number, height: number, existing: PackItem[], bed: BedRect, limit = 1000): number {
  if (!(width > 0) || !(height > 0)) return 0;
  if (!packShelf([...existing, { id: 'fill-new', width, height }], bed)) return 0;
  const bedW = bed.max[0] - bed.min[0];
  const bedH = bed.max[1] - bed.min[1];
  let n = Math.min(Math.floor(bedW / width) * Math.floor(bedH / height) - existing.length, limit);
  for (; n > 0; n--) {
    const copies = Array.from({ length: n }, (_, i) => ({ id: `fill-${i}`, width, height }));
    if (packShelf([...existing, ...copies], bed)) return n;
  }
  return 0;
}

/** Bed rectangle of a printer preset, from its `bed_shape` ("0x0,250x0,250x210,0x210"). */
export function bedShapeOf(printerCfg: Record<string, string>): BedRect {
  const pts = (printerCfg.bed_shape || '0x0,200x0,200x200,0x200')
    .split(',')
    .map((p) => p.split('x').map(Number) as [number, number])
    .filter((p) => p.length === 2 && !p.some((n) => Number.isNaN(n)));
  if (!pts.length) pts.push([0, 0], [200, 0], [200, 200], [0, 200]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] };
}

/**
 * Clearance kept between two arranged items. With sequential printing the extruder has to reach
 * around every object, so the extruder clearance radius applies; otherwise a small fixed gap.
 * Port of `arrangementSpacing` in `web/src/state/store.ts`.
 */
export function arrangementSpacing(printCfg: Record<string, string>): number {
  const radius = Number(printCfg.extruder_clearance_radius);
  const complete = printCfg.complete_objects === '1' || printCfg.complete_objects === 'true';
  return radius > 0 && complete ? radius : 6;
}
