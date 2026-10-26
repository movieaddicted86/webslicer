/**
 * The plate checks of the browser plater: the rules themselves live in `@webslicer/shared` (the
 * server runs the same ones before it queues a job), this module only reads them off the plater's
 * objects.
 *
 * Everything below the adapters is re-exported, so a component keeps importing the rules from here.
 */
import {
  bedShapeOf,
  checkFootprints,
  hullOutsideBed,
  plateRulesOf,
  type Config,
  type InstanceFootprint,
  type PlateIssue,
} from '@webslicer/shared';
import { instanceFootprint } from './footprint';
import { instanceBounds } from './objects';
import type { PlaterInstance, PlaterObject } from '../state/types';

export {
  checkFootprints,
  hullOutsideBed,
  plateRulesOf,
  pointInPolygon,
  rectInsidePolygon,
  type InstanceFootprint,
  type PlateIssue,
  type PlateIssueCode,
  type PlateRules,
} from '@webslicer/shared';

/**
 * Footprints of the printable (visible) instances of a plater, in printer coordinates: the real hull
 * of every instance on the bed, plus its bounding box for the cheap rejects.
 */
export function footprintsOf(objects: PlaterObject[]): InstanceFootprint[] {
  return objects
    .filter((o) => o.visible)
    .flatMap((o) =>
      o.instances.map((inst) => {
        const box = instanceBounds(o, inst);
        const footprint = instanceFootprint(o, inst);
        return {
          objectId: o.id,
          objectName: o.name,
          instanceId: inst.id,
          minX: box.min.x,
          minY: box.min.y,
          maxX: box.max.x,
          maxY: box.max.y,
          maxZ: footprint.maxZ,
          hull: footprint.hull,
        };
      }),
    );
}

/** All plate issues of the current plater, read from the printer and print settings. */
export function plateIssues(objects: PlaterObject[], printerCfg: Config, printCfg: Config): PlateIssue[] {
  return checkFootprints(footprintsOf(objects), plateRulesOf(printerCfg, printCfg));
}

/** True when the instance's real hull leaves the bed polygon or the instance is too tall. */
export function instanceOutside(o: PlaterObject, inst: PlaterInstance, bed: Array<[number, number]>, maxHeight: number): boolean {
  const { hull, maxZ } = instanceFootprint(o, inst);
  return hullOutsideBed(hull, maxZ, bed, maxHeight);
}

/**
 * True when at least one instance of the object leaves the print volume. The bed is the real polygon,
 * not its bounding box, so an object in the notch of an L-shaped bed is outside too.
 *
 * Lives here instead of in `three/Viewer.tsx`: the object list badges a row with it, and no renderer
 * is involved. It measures the instance's real hull, the same outline the plate check uses.
 */
export function objectIsOutside(o: PlaterObject, bedShape: string, maxHeight: number): boolean {
  const bed = bedShapeOf({ bed_shape: bedShape });
  return o.instances.some((inst) => instanceOutside(o, inst, bed.points, maxHeight));
}
