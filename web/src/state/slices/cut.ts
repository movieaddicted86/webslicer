/**
 * The cut tool's store part (T-044): the panel's settings, its open state and the action that cuts the
 * selected instance through the server.
 *
 * The cutting itself is the server's (`POST /api/cut`, PrusaSlicer CLI); this slice sends the model id,
 * the instance matrix and the plane, then turns the two returned models into plater objects at their
 * world position. One undo step restores the uncut object (the snapshot is taken before anything
 * changes). Paint and height ranges cannot survive a cut of the mesh, so they are dropped with an info
 * toast; objects with extra volumes are refused (the button is disabled with the reason).
 */
import * as THREE from 'three';
import { api, type CutPart, type CutResult } from '../../api';
import { loadStoredModel } from '../../three/loaders';
import { geometrySize, triangleCount } from '../../three/geometry';
import { placementMatrix } from '@webslicer/shared';
import { mintInstanceId, mintObjectId, selectedInstance } from '../../plater/objects';
import { cutPlaneWorld, defaultCutSettings, type CutSettings } from '../../plater/cut';
import type { PlaterObject, SlicePart } from '../types';

export interface CutSlice {
  /** the cut panel is open for the selected instance */
  cutOpen: boolean;
  /** the panel's settings (reset for every object the panel opens on) */
  cutSettings: CutSettings;
  /** open the cut panel on the selected instance; false when the selection cannot be cut */
  openCut: () => boolean;
  closeCut: () => void;
  setCutSettings: (patch: Partial<CutSettings>) => void;
  /** cut the selected instance; one undo step */
  cutSelection: () => Promise<void>;
}

/** The object the panel works on: the single selected object, or `undefined`. */
function cutTarget(objects: PlaterObject[], selectedIds: string[]): PlaterObject | undefined {
  return selectedIds.length === 1 ? objects.find((o) => o.id === selectedIds[0]) : undefined;
}

/**
 * The plater object of one cut part. The server stores the part in its own coordinates (X/Y centred,
 * bottom at z = 0) and sends the world position of that origin, which is exactly what an instance
 * placement is – so the geometry goes in unchanged.
 */
function partObject(part: CutPart, source: PlaterObject, geometry: THREE.BufferGeometry): PlaterObject {
  geometry.computeBoundingBox();
  geometry.computeVertexNormals();
  return {
    id: mintObjectId(),
    name: part.name,
    geometry,
    modelId: part.modelId,
    instances: [{ id: mintInstanceId(), position: part.position, rotation: [0, 0, 0], scale: [1, 1, 1] }],
    size: geometrySize(geometry),
    config: { ...source.config },
    extruder: source.extruder,
    visible: true,
    triangles: triangleCount(geometry),
    volumes: [],
    ranges: [],
  };
}

export const createCutSlice: SlicePart<CutSlice> = (set, get) => ({
  cutOpen: false,
  cutSettings: defaultCutSettings(0),
  openCut: () => {
    const s = get();
    const o = cutTarget(s.objects, s.selectedIds);
    if (!o) return false;
    if (o.volumes.length) {
      s.toast('error', 'Cut: remove modifiers and parts first');
      return false;
    }
    set({ cutOpen: true, cutSettings: defaultCutSettings(o.size[2]) });
    return true;
  },
  closeCut: () => set({ cutOpen: false }),
  setCutSettings: (patch) => set((s) => ({ cutSettings: { ...s.cutSettings, ...patch } })),
  cutSelection: async () => {
    const s = get();
    const o = cutTarget(s.objects, s.selectedIds);
    if (!o) return;
    if (!o.modelId) {
      s.toast('error', 'Cut: the model is not uploaded yet');
      return;
    }
    const inst = selectedInstance(s, o);
    const world = cutPlaneWorld(inst, s.cutSettings);
    const snapshot = s.objects;
    let result: CutResult;
    try {
      result = await api.cut({
        modelId: o.modelId,
        transform: placementMatrix(inst),
        plane: world,
        keep: s.cutSettings.keep,
        placeOnCut: s.cutSettings.placeOnCut,
        flipUpper: s.cutSettings.flipUpper,
      });
    } catch (e) {
      s.toast('error', `Cut failed: ${(e as Error).message}`);
      return;
    }
    const parts = [result.upper, result.lower].filter((p): p is CutPart => !!p);
    if (!parts.length) {
      s.toast('info', 'The plane does not cut the object');
      return;
    }
    // the cut parts are new models: nothing of the old one is reused, so the undo snapshot is the
    // plater from before anything changed
    s.recordHistory(snapshot);
    const created: PlaterObject[] = [];
    for (const part of parts) {
      try {
        const geometry = await loadStoredModel(part.modelId);
        created.push(partObject({ ...part, name: `${o.name} (${part === result.upper ? 'upper' : 'lower'})` }, o, geometry));
      } catch (e) {
        s.toast('error', `Cut failed: ${(e as Error).message}`);
        return;
      }
    }
    // the cut instance goes: the object itself when it was its last copy, otherwise just the copy
    const restInstances = o.instances.filter((i) => i.id !== inst.id);
    set((st) => ({
      objects: [
        ...st.objects.flatMap((x) => (x.id === o.id ? (restInstances.length ? [{ ...x, instances: restInstances }] : []) : [x])),
        ...created,
      ],
      selectedIds: created.map((c) => c.id),
      selectedInstanceId: undefined,
      selectedVolumeId: undefined,
      cutOpen: false,
      sliceDirty: true,
    }));
    const dropped = [o.paint ? 'paint' : '', o.ranges.length ? 'height ranges' : ''].filter(Boolean);
    if (dropped.length) s.toast('info', `Cut: ${dropped.join(' and ')} were dropped`);
    s.toast('info', parts.length === 2 ? 'Cut into two parts' : 'Cut: one part kept');
  },
});
