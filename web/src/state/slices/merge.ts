/**
 * The plater's merge (q4-web-store): merging several objects into the first one. Split out of
 * `plater.ts`; `createPlaterSlice` spreads this creator into itself.
 */
import * as THREE from 'three';
import { placementMatrix, transferredVolumePlacement } from '@webslicer/shared';
import { geometrySize } from '../../three/geometry';
import { mergeVolumes } from '../../plater/info';
import { mintVolumeId } from '../../plater/objects';
import type { PlaterVolume, SlicePart } from '../types';

export interface MergeSlice {
  /**
   * Merge the selected objects into the first one (T-042): every other object becomes ModelPart
   * volumes of it, at exactly their world positions. Settings, paint and ranges of the first object
   * are kept; paint of the others is dropped with an info toast. Only single-instance objects can be
   * merged (the button is disabled otherwise).
   */
  mergeObjects: (ids: string[]) => Promise<void>;
}

export const createMergeSlice: SlicePart<MergeSlice> = (set, get) => ({
  mergeObjects: async (ids) => {
    const s = get();
    // the plater order decides which object is the target; its settings stay the object's own
    const sources = s.objects.filter((o) => ids.includes(o.id));
    if (sources.length < 2) return;
    if (sources.some((o) => o.instances.length !== 1)) {
      s.toast('error', 'Only objects with a single instance can be merged');
      return;
    }
    const [target, ...rest] = sources;
    const targetInstance = placementMatrix(target.instances[0]);
    s.recordHistory();
    const volumes: PlaterVolume[] = [];
    let droppedPaint = false;
    let droppedRanges = false;
    for (const src of rest) {
      const sourceInstance = placementMatrix(src.instances[0]);
      // every volume of the source keeps its type and settings, moved into the target's frame
      for (const v of src.volumes) {
        const placement = transferredVolumePlacement(targetInstance, sourceInstance, v);
        if (!placement) continue;
        volumes.push({ ...v, id: mintVolumeId(), config: { ...v.config }, ...placement, modelId: undefined, uploadError: undefined });
      }
      // the source's own mesh becomes a ModelPart at exactly its world position
      for (const mv of mergeVolumes(targetInstance, sourceInstance, { ...src, volumes: [] })) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(Array.from(mv.vertices), 3));
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        volumes.push({
          id: mintVolumeId(),
          name: src.name,
          type: 'ModelPart',
          geometry,
          position: [...mv.placement.position],
          rotation: [...mv.placement.rotation],
          scale: [...mv.placement.scale],
          size: geometrySize(geometry),
          config: { ...src.config },
          extruder: src.extruder,
          triangles: mv.vertices.length / 9,
        });
      }
      // the target's paint is per triangle of its main mesh; the others' paint cannot follow a merge
      if (src.paint && ['supports', 'seam', 'mmu'].some((kind) => src.paint?.[kind as 'supports' | 'seam' | 'mmu']?.some((v) => v))) {
        droppedPaint = true;
      }
      if (src.ranges.some((r) => r.maxZ > r.minZ)) droppedRanges = true;
    }
    set((st) => ({
      objects: st.objects
        .filter((o) => o.id === target.id || !ids.includes(o.id))
        // the target's own mesh is unchanged and already uploaded; only the new parts are uploaded below
        .map((o) => (o.id === target.id ? { ...o, volumes: [...o.volumes, ...volumes] } : o)),
      selectedIds: [target.id],
      selectedVolumeId: undefined,
      selectedInstanceId: undefined,
      sliceDirty: true,
    }));
    if (droppedPaint) s.toast('info', 'Paint of the merged objects was dropped; only the first object keeps its paint');
    if (droppedRanges) s.toast('info', 'Height ranges of the merged objects were dropped; only the first object keeps them');
    // the target's mesh is unchanged, but its parts are new files on the server
    for (const v of volumes) await get().uploadVolume(target.id, v);
  },
});
