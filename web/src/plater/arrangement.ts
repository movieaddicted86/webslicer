/**
 * Packing the plater's instances into the bed (R-6, extracted from the plater slice; options T-043).
 *
 * Two related jobs: the item list every packing call needs (one hull footprint per instance) and the
 * position updates that put each instance into the slot the arrangement picked for it. The packing
 * itself is pure `@webslicer/shared`; what lives here is the knowledge of what an instance is and
 * where its outline is, plus the arrange settings the user can change (spacing, rotations,
 * alignment) and the fixed footprints of "arrange selection".
 */
import {
  arrangeItems,
  arrangeMarginsOf,
  bedShapeOf,
  multiply,
  placementFromMatrix,
  placementMatrix,
  plateRulesOf,
  translate,
  type BedShape,
  type Config,
  type FixedPackItem,
  type Hull,
  type Matrix4,
  type PackAlignment,
  type PackItem,
  type PackOptions,
  type PackedItem,
  type Turn,
  type Vec3,
} from '@webslicer/shared';
import { instanceFootprint } from './footprint';
import { instanceBounds } from './objects';
import type { PlaterInstance, PlaterObject } from '../state/types';

/** Arrange settings the user changes in the gear popover and the browser remembers (`localStorage`). */
export interface ArrangeSettings {
  /** clearance in mm; `undefined` = the print preset's arrangement spacing */
  spacing?: number;
  /** try an item turned by quarter turns when that packs the bed tighter */
  rotations: boolean;
  /** where the arranged block sits: centred as before, or in the bed corner */
  alignment: PackAlignment;
}

/** The settings a fresh browser starts with – today's layout (T-043, AC-4). */
export const DEFAULT_ARRANGE_SETTINGS: ArrangeSettings = { rotations: false, alignment: 'center' };

interface Box3Like {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

/** An instance with the bounds and outline it currently occupies, as read for one arrangement. */
export interface ArrangedInstance {
  o: PlaterObject;
  inst: PlaterInstance;
  box: Box3Like;
  /** the real outline on the bed – what the arrangement nests */
  hull: Hull;
  key: string;
  /** the same instance turned by `turn` quarter turns, computed only when the packer turned it */
  turned: (turn: Turn) => { inst: PlaterInstance; box: Box3Like };
}

/** A position change for one instance; `rotation` is set when the arrangement turned it. */
export interface PlacementUpdate {
  position: Vec3;
  rotation?: Vec3;
}

/** One instance's footprint: its box for the callers that need a size, its hull for the nesting. */
export function packItemOf(o: PlaterObject, inst: PlaterInstance, key: string): PackItem {
  const b = instanceBounds(o, inst);
  return { id: key, width: b.max.x - b.min.x, height: b.max.y - b.min.y, hull: instanceFootprint(o, inst).hull };
}

/** Every instance of every object as a packing item, keyed `obj:inst` (or whatever `keyOf` says). */
export function layoutOf(
  objects: PlaterObject[],
  keyOf: (o: PlaterObject, i: PlaterInstance, k: number) => string = (o, i) => `${o.id}:${i.id}`,
): PackItem[] {
  return objects.flatMap((o) => o.instances.map((i, k) => packItemOf(o, i, keyOf(o, i, k))));
}

/** Every instance with its current bounds and outline, ready for a packing run. */
export function arrangedInstances(
  objects: PlaterObject[],
  keyOf: (o: PlaterObject, i: PlaterInstance, k: number) => string = (o, i) => `${o.id}:${i.id}`,
): ArrangedInstance[] {
  return objects.flatMap((o) =>
    o.instances.map((inst, k) => {
      const box = instanceBounds(o, inst);
      const hull = instanceFootprint(o, inst).hull;
      let turned: { turn: Turn; inst: PlaterInstance; box: Box3Like } | undefined;
      return {
        o,
        inst,
        box,
        hull,
        key: keyOf(o, inst, k),
        turned: (turn: Turn) => {
          if (!turned || turned.turn !== turn) {
            const inst2 = turnedInstance(o, inst, box, turn);
            turned = { turn, inst: inst2, box: instanceBounds(o, inst2) };
          }
          return turned;
        },
      };
    }),
  );
}

/**
 * The pack options of one arrangement: the user's spacing (else the margin the plate rules ask for,
 * which also covers a brim), the skirt/brim bed-edge reserve and the bed polygon – all from the same
 * rules the plate check uses.
 */
export function packOptionsOf(
  presets: { print: { current: Config }; printer: { current: Config } },
  settings: ArrangeSettings,
): PackOptions {
  const bed = bedShapeOf(presets.printer.current);
  const margins = arrangeMarginsOf(plateRulesOf(presets.printer.current, presets.print.current));
  return {
    spacing: settings.spacing ?? margins.spacing,
    rotations: settings.rotations,
    alignment: settings.alignment,
    edgeReserve: margins.edgeReserve,
    bedPolygon: bed.points,
  };
}

/** The bed of the active printer and the spacing its plate rules ask for (the popover's placeholder). */
export function bedAndSpacing(presets: { print: { current: Config }; printer: { current: Config } }): { bed: BedShape; spacing: number } {
  return {
    bed: bedShapeOf(presets.printer.current),
    spacing: arrangeMarginsOf(plateRulesOf(presets.printer.current, presets.print.current)).spacing,
  };
}

/** Does every instance still fit when `preview` (an object with its extra instances) joins them? */
export function fitsOnBed(objects: PlaterObject[], preview: PlaterObject, bed: BedShape, options: PackOptions): boolean {
  return !!arrangeItems(
    layoutOf([...objects, preview], (o, i, k) => `${o.id}:${i.id}:${k}`),
    bed,
    options,
  );
}

/**
 * Where the instances go for one arrangement. Without `moving` every instance is placed; with it
 * only the keys in the set move and the other instances are fixed obstacles that stay untouched.
 * Returns `undefined` when the items do not fit (the caller reports it and changes nothing).
 */
export function arrangePlan(
  objects: PlaterObject[],
  bed: BedShape,
  options: PackOptions,
  moving?: ReadonlySet<string>,
): Map<string, PlacementUpdate> | undefined {
  const instances = arrangedInstances(objects);
  const selected = moving ? instances.filter((it) => moving.has(it.key)) : instances;
  if (!selected.length) return undefined;
  const fixed = moving ? instances.filter((it) => !moving.has(it.key)).map(fixedItemOf) : undefined;
  const packed = arrangeItems(selected.map(footprintOf), bed, {
    ...options,
    bedPolygon: bed.points,
    ...(fixed && fixed.length ? { fixed } : {}),
  });
  return packed ? placementUpdates(selected, packed) : undefined;
}

/** Apply packed positions (and turns) to the plater's objects; untouched instances stay identical. */
export function withPlacements(objects: PlaterObject[], updates: Map<string, PlacementUpdate>): PlaterObject[] {
  return objects.map((o) => {
    if (!o.instances.some((i) => updates.has(`${o.id}:${i.id}`))) return o;
    return {
      ...o,
      instances: o.instances.map((i) => {
        const update = updates.get(`${o.id}:${i.id}`);
        return update ? { ...i, position: update.position, ...(update.rotation ? { rotation: update.rotation } : {}) } : i;
      }),
    };
  });
}

/** One footprint without the spacing – the packer adds it itself – plus the real outline. */
function footprintOf(it: ArrangedInstance): PackItem {
  return { id: it.key, width: it.box.max.x - it.box.min.x, height: it.box.max.y - it.box.min.y, hull: it.hull };
}

/** An unselected instance as a fixed footprint: its footprint, outline and current centre. */
function fixedItemOf(it: ArrangedInstance): FixedPackItem {
  return {
    ...footprintOf(it),
    x: (it.box.min.x + it.box.max.x) / 2,
    y: (it.box.min.y + it.box.max.y) / 2,
  };
}

/**
 * Where every instance goes so that it lands in its packed slot. `packShelf` returns slot centres,
 * so the instance keeps its own offset from its current footprint centre, and drops onto the bed.
 */
export function placementUpdates(items: ArrangedInstance[], packed: PackedItem[]): Map<string, PlacementUpdate> {
  const byKey = new Map(items.map((it) => [it.key, it]));
  const updates = new Map<string, PlacementUpdate>();
  for (const p of packed) {
    const it = byKey.get(p.id);
    if (!it) continue;
    const target = p.turn ? it.turned(p.turn) : it;
    const curCx = (target.box.min.x + target.box.max.x) / 2;
    const curCy = (target.box.min.y + target.box.max.y) / 2;
    updates.set(it.key, {
      position: [
        target.inst.position[0] + (p.x - curCx),
        target.inst.position[1] + (p.y - curCy),
        target.inst.position[2] - target.box.min.z,
      ],
      ...(p.turn ? { rotation: [...target.inst.rotation] as Vec3 } : {}),
    });
  }
  return updates;
}

/** A quarter turn around Z, composed in the world like `three.js` does for an Euler rotation. */
const QUARTER_TURN = placementMatrix({ position: [0, 0, 0], rotation: [0, 0, Math.PI / 2], scale: [1, 1, 1] });

/**
 * The instance turned by `turn` quarter turns around Z through its footprint centre, so it stays
 * where it is – the same turn the packer applied to the outline it placed.
 */
function turnedInstance(o: PlaterObject, inst: PlaterInstance, box: Box3Like, turn: Turn): PlaterInstance {
  const cx = (box.min.x + box.max.x) / 2;
  const cy = (box.min.y + box.max.y) / 2;
  const around = multiply(translate(cx, cy, 0), multiply(turnMatrix(turn), translate(-cx, -cy, 0)));
  return { ...inst, ...placementFromMatrix(multiply(around, placementMatrix(inst))) };
}

/** `k` quarter turns about Z as one matrix (each multiplication is exact for these angles). */
function turnMatrix(k: Turn): Matrix4 {
  let m = QUARTER_TURN;
  for (let i = 1; i < k; i++) m = multiply(m, QUARTER_TURN);
  return m;
}
