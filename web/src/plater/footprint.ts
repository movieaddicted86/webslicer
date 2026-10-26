/**
 * The plater's footprint builder: the convex hull of an instance on the bed (T-078), plus its top.
 *
 * The hull of a mesh is computed once in the mesh's own frame and cached per geometry (`WeakMap`), so
 * a replaced mesh (cut, remesh) drops its entry with it and a drag only transforms a few points. The
 * maths stays in `@webslicer/shared`: the browser and the server feed the same hull code, which is
 * what keeps the two plate checks agreeing.
 */
import { hullOfFlat, multiply, placementMatrix, transformHull, unionHull, type Hull } from '@webslicer/shared';
import { geometrySoup, type GeometryLike } from './meshInfo';
import { instanceBounds } from './objects';
import type { PlaterInstance, PlaterObject } from '../state/types';

/** Hull of a geometry in the mesh's own frame, cached per geometry object. */
const meshHullCache = new WeakMap<object, Hull>();

function meshHull(geometry: GeometryLike): Hull {
  let hull = meshHullCache.get(geometry);
  if (!hull) {
    hull = hullOfFlat(geometrySoup(geometry));
    meshHullCache.set(geometry, hull);
  }
  return hull;
}

/**
 * The instance's outline on the bed: the mesh hull and every `ModelPart` volume's hull, each placed
 * by the instance matrix (the volume's own placement first). The top stays the bounding box's, as
 * before – a rotated box can only be too tall, never too short.
 */
export function instanceFootprint(o: PlaterObject, inst: PlaterInstance): { hull: Hull; maxZ: number } {
  const im = placementMatrix(inst);
  const hulls: Hull[] = [transformHull(meshHull(o.geometry), im)];
  for (const v of o.volumes || []) {
    if (v.type !== 'ModelPart' || !v.geometry) continue;
    const hull = transformHull(meshHull(v.geometry as GeometryLike), multiply(im, placementMatrix(v)));
    if (hull.length) hulls.push(hull);
  }
  return { hull: unionHull(hulls), maxZ: instanceBounds(o, inst).max.z };
}
