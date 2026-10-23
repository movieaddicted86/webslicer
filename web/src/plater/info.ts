/**
 * The object info of the plater (T-042) and the parts a merge carries over.
 *
 * The measurement itself lives in `@webslicer/shared` (`meshStats`, `mergedVolume`); this module only
 * turns plater objects into the triangle soups those helpers take: the main mesh plus every ModelPart
 * volume, each through its own placement.
 */
import {
  meshStats,
  mergedVolume,
  multiply,
  placementMatrix,
  soupBounds,
  type Matrix4,
  type MergedVolume,
  type MeshStats,
  type Vec3,
} from '@webslicer/shared';
import { geometrySoup } from './meshInfo';
import type { PlaterObject } from '../state/types';

/** One piece of an object: its soup in its own frame and the matrix into the object's frame. */
export interface ObjectPart {
  soup: Float32Array;
  matrix: Matrix4;
}

/** The main mesh and every ModelPart volume of an object, with the matrix into the object's frame. */
export function objectParts(o: PlaterObject): ObjectPart[] {
  const parts: ObjectPart[] = [
    { soup: geometrySoup(o.geometry), matrix: placementMatrix({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }) },
  ];
  for (const v of o.volumes) if (v.type === 'ModelPart') parts.push({ soup: geometrySoup(v.geometry), matrix: placementMatrix(v) });
  return parts;
}

/** The whole object as one soup in the object's frame (main mesh and parts at their places). */
export function objectSoup(o: PlaterObject): Float64Array {
  const pieces = objectParts(o).map((p) => applyMatrix(p.soup, p.matrix));
  const total = pieces.reduce((n, p) => n + p.length, 0);
  const out = new Float64Array(total);
  let at = 0;
  for (const p of pieces) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** `M · v` for a whole soup. */
function applyMatrix(soup: Float32Array, m: Matrix4): Float64Array {
  const out = new Float64Array(soup.length);
  for (let i = 0; i < soup.length; i += 3) {
    out[i] = m[0] * soup[i] + m[4] * soup[i + 1] + m[8] * soup[i + 2] + m[12];
    out[i + 1] = m[1] * soup[i] + m[5] * soup[i + 1] + m[9] * soup[i + 2] + m[13];
    out[i + 2] = m[2] * soup[i] + m[6] * soup[i + 1] + m[10] * soup[i + 2] + m[14];
  }
  return out;
}

/** One object's numbers as the info panel shows them; `volume` is cm³. */
export interface ObjectInfo {
  /** bounding-box size of the object in mm, main mesh and parts together */
  size: Vec3;
  /** volume of the material in cm³ – a mirrored object's signed volume is negative */
  volume: number;
  triangles: number;
  /** boundary edges of the welded mesh; 0 means manifold */
  openEdges: number;
  instances: number;
}

/** The numbers of the info panel for one object. */
export function objectInfo(o: PlaterObject): ObjectInfo {
  const soup = objectSoup(o);
  const stats: MeshStats = meshStats(soup);
  const box = soupBounds(soup);
  return {
    size: [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]],
    volume: Math.abs(stats.volume) / 1000,
    triangles: o.triangles,
    openEdges: stats.openEdges,
    instances: o.instances.length,
  };
}

/**
 * The volume a source object becomes inside the merge target (T-042): every part of the source
 * through `M_target⁻¹ · M_instance · M_part`, centred in the target's frame and placed by its centre.
 * Parts that cannot be inverted (a zero scale) are skipped.
 */
export function mergeVolumes(targetInstance: Matrix4, sourceInstance: Matrix4, o: PlaterObject): MergedVolume[] {
  const out: MergedVolume[] = [];
  for (const part of objectParts(o)) {
    const v = mergedVolume(targetInstance, multiply(sourceInstance, part.matrix), part.soup);
    if (v) out.push(v);
  }
  return out;
}
