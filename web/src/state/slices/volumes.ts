/**
 * The plater's sub-volumes (q4-web-store): parts, modifiers, support enforcers/blockers and negative
 * volumes of an object, and their uploads. Split out of `plater.ts`; `createPlaterSlice` spreads this
 * creator into itself.
 *
 * The menu's primitives and file imports come through `plater/meshOps` (the three.js seam), so this
 * slice and the component stay free of three.js imports.
 */
import { bedShapeOf } from '@webslicer/shared';
import { uploadMesh } from '../upload';
import { createPrimitive, loadModelFile, type PrimitiveShape } from '../../plater/meshOps';
import { makeVolume } from '../../plater/objects';
import { VOLUME_LABELS, type NewVolumeInput, type PlaterVolume, type SlicePart } from '../types';

export interface VolumeSlice {
  /** add a sub-volume to an object and upload its mesh; one undo step */
  addVolume: (objectId: string, input: NewVolumeInput) => Promise<void>;
  /** add a primitive sub-volume, sized and placed like PrusaSlicer's Add volume menu */
  addPrimitiveVolume: (objectId: string, type: NewVolumeInput['type'], shape: PrimitiveShape) => Promise<void>;
  /** load a mesh file as a sub-volume of the given type */
  addVolumeFromFile: (objectId: string, file: File, type: NewVolumeInput['type']) => Promise<void>;
  updateVolume: (objectId: string, volumeId: string, patch: Partial<PlaterVolume>) => void;
  removeVolume: (objectId: string, volumeId: string) => void;
  selectVolume: (objectId: string, volumeId?: string) => void;
  uploadVolume: (objectId: string, v: PlaterVolume) => Promise<void>;
  /** rename a sub-volume of an object (empty names are ignored); one undo step */
  renameVolume: (objectId: string, volumeId: string, name: string) => void;
}

export const createVolumeSlice: SlicePart<VolumeSlice> = (set, get) => ({
  uploadVolume: (objectId, v) =>
    uploadMesh(
      v.geometry,
      v.name,
      (patch) => get().updateVolume(objectId, v.id, patch),
      (text) => get().toast('error', text),
    ),
  addVolume: async (objectId, input) => {
    const o = get().objects.find((x) => x.id === objectId);
    if (!o) return;
    get().recordHistory();
    const v = makeVolume(input, [0, 0, 0]);
    set((s) => ({
      objects: s.objects.map((x) => (x.id === objectId ? { ...x, volumes: [...x.volumes, v] } : x)),
      selectedIds: [objectId],
      selectedVolumeId: v.id,
      sliceDirty: true,
    }));
    await get().uploadVolume(objectId, v);
  },
  addPrimitiveVolume: async (objectId, type, shape) => {
    const s = get();
    const o = s.objects.find((x) => x.id === objectId);
    if (!o) return;
    const bed = bedShapeOf(s.presets.printer.current);
    const side = Math.max(5, 0.1 * Math.max(bed.max[0] - bed.min[0], bed.max[1] - bed.min[1]));
    const geometry = createPrimitive(shape, side, [o.size[0], o.size[1], o.size[2]]);
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    if (!bb) return;
    const h = bb.max.z - bb.min.z;
    // modifiers etc. start at the object centre; slabs and new parts sit on the bed
    const position: [number, number, number] = shape === 'slab' || type === 'ModelPart' ? [0, 0, h / 2] : [0, 0, o.size[2] / 2];
    await get().addVolume(objectId, { name: `${VOLUME_LABELS[type]} ${shape}`, type, geometry, position });
  },
  addVolumeFromFile: async (objectId, file, type) => {
    try {
      const models = await loadModelFile(file);
      for (const m of models) await get().addVolume(objectId, { name: m.name, type, geometry: m.geometry });
    } catch (e) {
      get().toast('error', (e as Error).message);
    }
  },
  updateVolume: (objectId, vid, patch) =>
    set((s) => ({
      objects: s.objects.map((o) =>
        o.id === objectId ? { ...o, volumes: o.volumes.map((v) => (v.id === vid ? { ...v, ...patch } : v)) } : o,
      ),
      sliceDirty: true,
    })),
  removeVolume: (objectId, vid) => {
    get().recordHistory();
    set((s) => ({
      objects: s.objects.map((o) => (o.id === objectId ? { ...o, volumes: o.volumes.filter((v) => v.id !== vid) } : o)),
      selectedVolumeId: s.selectedVolumeId === vid ? undefined : s.selectedVolumeId,
      sliceDirty: true,
    }));
  },
  selectVolume: (objectId, vid) => set({ selectedIds: [objectId], selectedVolumeId: vid }),
  renameVolume: (objectId, volumeId, name) => {
    const o = get().objects.find((x) => x.id === objectId);
    const v = o?.volumes.find((x) => x.id === volumeId);
    const next = name.trim();
    if (!o || !v || !next || next === v.name) return;
    get().recordHistory();
    set((s) => ({
      objects: s.objects.map((x) =>
        x.id === objectId ? { ...x, volumes: x.volumes.map((vv) => (vv.id === volumeId ? { ...vv, name: next } : vv)) } : x,
      ),
      sliceDirty: true,
    }));
  },
});
