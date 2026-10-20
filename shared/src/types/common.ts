/**
 * Base primitives of the API and domain types (R-2, F-09).
 *
 * Plain tuples and records only – `shared` never imports `three` (lead decision in
 * `tasks/T-011.md`). The browser converts to and from `THREE.Vector3` in its thin adapter under
 * `web/src/three/`, the server uses the values as they are.
 */

/** X/Y/Z triple: a point, a direction or a size. Millimetres unless the field says otherwise. */
export type Vec3 = [number, number, number];

/** How a plater entity sits in the world: position, Euler XYZ in radians, scale. */
export interface Placement {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

/** Axis-aligned bounding box in the coordinate frame of its owner. */
export interface Bounds {
  min: Vec3;
  max: Vec3;
}

/** Slicer configuration: one PrusaSlicer INI section, key → raw value (the server calls it `IniSection`). */
export type Config = Record<string, string>;
