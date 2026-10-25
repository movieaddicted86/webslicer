/**
 * The plate checks of the browser plater: the rules themselves live in `@webslicer/shared` (the
 * server runs the same ones before it queues a job), this module only reads them off the plater's
 * objects.
 *
 * Everything below the adapters is re-exported, so a component keeps importing the rules from here.
 */
import {
  bedShapeOf,
  boxOutside,
  checkFootprints,
  plateRulesOf,
  type Config,
  type InstanceFootprint,
  type PlateIssue,
} from '@webslicer/shared';
import { instanceBounds } from './objects';
import type { PlaterObject } from '../state/types';

export {
  boxOutside,
  checkFootprints,
  plateRulesOf,
  pointInPolygon,
  rectInsidePolygon,
  type InstanceFootprint,
  type PlateIssue,
  type PlateIssueCode,
  type PlateRules,
} from '@webslicer/shared';

/** Footprints of the printable (visible) instances of a plater, in printer coordinates. */
export function footprintsOf(objects: PlaterObject[]): InstanceFootprint[] {
  return objects
    .filter((o) => o.visible)
    .flatMap((o) =>
      o.instances.map((inst) => {
        const box = instanceBounds(o, inst);
        return {
          objectId: o.id,
          objectName: o.name,
          instanceId: inst.id,
          minX: box.min.x,
          minY: box.min.y,
          maxX: box.max.x,
          maxY: box.max.y,
          maxZ: box.max.z,
        };
      }),
    );
}

/** All plate issues of the current plater, read from the printer and print settings. */
export function plateIssues(objects: PlaterObject[], printerCfg: Config, printCfg: Config): PlateIssue[] {
  return checkFootprints(footprintsOf(objects), plateRulesOf(printerCfg, printCfg));
}

/**
 * True when at least one instance of the object leaves the print volume. The bed is the real polygon,
 * not its bounding box, so an object in the notch of an L-shaped bed is outside too.
 *
 * Lives here instead of in `three/Viewer.tsx`: the object list badges a row with it and the plate
 * checks use the same `boxOutside`, and no renderer is involved.
 */
export function objectIsOutside(o: PlaterObject, bedShape: string, maxHeight: number): boolean {
  const bed = bedShapeOf({ bed_shape: bedShape });
  return o.instances.some((inst) => boxOutside(instanceBounds(o, inst), bed.points, maxHeight));
}
