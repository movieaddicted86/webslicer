/**
 * Packing the plater's instances into the bed (R-6, extracted from the plater slice).
 *
 * Two related jobs: the item list every packing call needs (one footprint per instance, including
 * the arrangement spacing) and the position updates that put each instance into the slot
 * `packShelf` picked for it. The packing itself is pure `@webslicer/shared`; what lives here is the
 * knowledge of what an instance is and where its bounds are.
 */
import { arrangementSpacing, bedShapeOf, packShelf, type BedShape, type Config, type PackItem, type PackedItem } from '@webslicer/shared';
import { instanceBounds } from './objects';
import type { PlaterInstance, PlaterObject } from '../state/types';

/** One instance's packing footprint: its own bounds plus the spacing that has to stay clear. */
export function packItemOf(o: PlaterObject, inst: PlaterInstance, key: string, spacing: number): PackItem {
  const b = instanceBounds(o, inst);
  return { id: key, width: b.max.x - b.min.x + spacing, height: b.max.y - b.min.y + spacing };
}

/** Every instance of every object as a packing item, keyed `obj:inst` (or whatever `keyOf` says). */
export function layoutOf(objects: PlaterObject[], spacing: number, keyOf: (o: PlaterObject, i: PlaterInstance, k: number) => string = (o, i) => `${o.id}:${i.id}`): PackItem[] {
  return objects.flatMap((o) => o.instances.map((i, k) => packItemOf(o, i, keyOf(o, i, k), spacing)));
}

/** An instance with the bounds it currently occupies, as read for one arrangement. */
export interface ArrangedInstance {
  o: PlaterObject;
  inst: PlaterInstance;
  box: { min: { x: number; y: number; z: number }; max: { x: number; y: number } };
  key: string;
}

/** The bed of the active printer and the spacing the print preset asks for. */
export function bedAndSpacing(presets: { print: { current: Config }; printer: { current: Config } }): { bed: BedShape; spacing: number } {
  return { bed: bedShapeOf(presets.printer.current), spacing: arrangementSpacing(presets.print.current) };
}

/** Does every instance still fit when `preview` (an object with its extra instances) joins them? */
export function fitsOnBed(objects: PlaterObject[], preview: PlaterObject, spacing: number, bed: BedShape): boolean {
  return !!packShelf(layoutOf([...objects, preview], spacing, (o, i, k) => `${o.id}:${i.id}:${k}`), bed);
}

/**
 * Where every instance goes so that it lands in its packed slot. `packShelf` returns slot centres,
 * so the instance keeps its own offset from its current footprint centre, and drops onto the bed.
 */
export function placementUpdates(items: ArrangedInstance[], packed: PackedItem[]): Map<string, [number, number, number]> {
  const byKey = new Map(items.map((it) => [it.key, it]));
  const updates = new Map<string, [number, number, number]>();
  for (const p of packed) {
    const it = byKey.get(p.id)!;
    const curCx = (it.box.min.x + it.box.max.x) / 2;
    const curCy = (it.box.min.y + it.box.max.y) / 2;
    updates.set(it.key, [it.inst.position[0] + (p.x - curCx), it.inst.position[1] + (p.y - curCy), it.inst.position[2] - it.box.min.z]);
  }
  return updates;
}

/** Apply packed positions to the plater's objects; instances without an update stay identical. */
export function withPlacements(objects: PlaterObject[], updates: Map<string, [number, number, number]>): PlaterObject[] {
  return objects.map((o) => {
    if (!o.instances.some((i) => updates.has(`${o.id}:${i.id}`))) return o;
    return { ...o, instances: o.instances.map((i) => (updates.has(`${o.id}:${i.id}`) ? { ...i, position: updates.get(`${o.id}:${i.id}`)! } : i)) };
  });
}
