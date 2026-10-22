/**
 * The plater's object math (R-6). Everything here works on the plater's own types with three.js
 * boxes; the algorithms themselves live in `@webslicer/shared` and `../three/matrix` is the only
 * place where a shared matrix/bounds turns into a THREE object.
 */
import * as THREE from 'three';
import { instanceBounds as sharedInstanceBounds, placementMatrix, type Placement } from '@webslicer/shared';
import { fromBox3, toBox3 } from '../three/matrix';
import { geometrySize, triangleCount } from '../three/geometry';
import type { NewVolumeInput, PlaterInstance, PlaterObject, PlaterVolume } from '../state/types';

/** Placement used for a mesh that arrives without an item transform (STL, OBJ, plain 3MF). */
export const IDENTITY_PLACEMENT: Placement = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};

/** The instance a selection refers to: the selected one, or the object's first instance. */
export function selectedInstance(state: { selectedIds: string[]; selectedInstanceId?: string }, o: PlaterObject): PlaterInstance {
  const id = state.selectedIds.length === 1 && state.selectedIds[0] === o.id ? state.selectedInstanceId : undefined;
  return o.instances.find((i) => i.id === id) || o.instances[0];
}

/**
 * The instance the user picked explicitly, if any: clicking an instance in the view, its row in the
 * object list or one of the instance buttons sets this. Selecting the object row alone does not, which
 * is what tells Del apart ("remove this copy" versus "remove the object", AC-4.4).
 */
export function pickedInstanceId(state: { selectedIds: string[]; selectedInstanceId?: string }, o: PlaterObject): string | undefined {
  if (state.selectedIds.length !== 1 || state.selectedIds[0] !== o.id) return undefined;
  const id = state.selectedInstanceId;
  return id && o.instances.some((i) => i.id === id) ? id : undefined;
}

/** World-space bounds of one instance (its own scale applies to the object's volumes too). */
export function instanceBounds(o: PlaterObject, inst: PlaterInstance): THREE.Box3 {
  if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
  const im = placementMatrix(inst);
  let box = sharedInstanceBounds(fromBox3(o.geometry.boundingBox!), im);
  for (const v of o.volumes || []) {
    if (v.type !== 'ModelPart') continue;
    if (!v.geometry.boundingBox) v.geometry.computeBoundingBox();
    // the volume matrix first, then the instance's – Box3.applyMatrix4 chained did the same two hulls
    const vb = sharedInstanceBounds(sharedInstanceBounds(fromBox3(v.geometry.boundingBox!), placementMatrix(v)), im);
    box = {
      min: [Math.min(box.min[0], vb.min[0]), Math.min(box.min[1], vb.min[1]), Math.min(box.min[2], vb.min[2])],
      max: [Math.max(box.max[0], vb.max[0]), Math.max(box.max[1], vb.max[1]), Math.max(box.max[2], vb.max[2])],
    };
  }
  return toBox3(box);
}

/** next id of a plater object, same `obj-N` pattern as volumes, ranges and instances */
let objectId = 0;
let volumeId = 0;
let rangeId = 0;
let instanceId = 0;

export function mintObjectId(): string {
  return `obj-${++objectId}`;
}

export function mintVolumeId(): string {
  return `vol-${++volumeId}`;
}

export function mintRangeId(): string {
  return `rng-${++rangeId}`;
}

export function mintInstanceId(): string {
  return `inst-${++instanceId}`;
}

/**
 * Build a PlaterVolume from an input. `offset` is the translation that was applied to the
 * parent object's geometry during normalization; imported volume geometry shares that frame.
 */
export function makeVolume(input: NewVolumeInput, offset: [number, number, number]): PlaterVolume {
  const g = input.geometry;
  g.computeBoundingBox();
  let position: [number, number, number];
  if (input.position) {
    position = input.position;
  } else {
    // centre the geometry at its own origin and remember where it was (object frame)
    const bb = g.boundingBox!;
    const cx = (bb.min.x + bb.max.x) / 2;
    const cy = (bb.min.y + bb.max.y) / 2;
    const cz = (bb.min.z + bb.max.z) / 2;
    g.translate(-cx, -cy, -cz);
    g.computeBoundingBox();
    position = [cx + offset[0], cy + offset[1], cz + offset[2]];
  }
  g.computeVertexNormals();
  return {
    id: mintVolumeId(),
    name: input.name,
    type: input.type,
    geometry: g,
    position,
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    size: geometrySize(g),
    config: { ...(input.config || {}) },
    extruder: input.extruder || 0,
    triangles: triangleCount(g),
  };
}

/**
 * History snapshots may predate the mesh uploads; carry the upload bookkeeping
 * (modelId / uploadError) of the current objects over to the restored snapshot.
 */
export function mergeUploadState(snapshot: PlaterObject[], current: PlaterObject[]): PlaterObject[] {
  const byId = new Map(current.map((o) => [o.id, o]));
  return snapshot.map((o) => {
    const cur = byId.get(o.id);
    const vols = o.volumes.map((v) => {
      const cv = cur?.volumes.find((x) => x.id === v.id);
      return cv && (cv.modelId || cv.uploadError) && !v.modelId ? { ...v, modelId: cv.modelId, uploadError: cv.uploadError } : v;
    });
    if (cur && (cur.modelId || cur.uploadError) && !o.modelId)
      return { ...o, modelId: cur.modelId, uploadError: cur.uploadError, volumes: vols };
    return vols.some((v, i) => v !== o.volumes[i]) ? { ...o, volumes: vols } : o;
  });
}
