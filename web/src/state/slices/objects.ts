/**
 * The plater's object records (q4-web-store): the objects on the bed, the selection and the actions
 * that add, duplicate, rename and remove whole objects. Split out of `plater.ts` along the areas the
 * work package names; `createPlaterSlice` spreads this creator into itself, so the store still
 * composes one plater slice.
 *
 * The per-object parts live next door: instances (`./instances`), volumes (`./volumes`), merging
 * (`./merge`), shell splitting (`./split`) and transforms/arrangement (`./transform`).
 */
import { api, type Config, type LayerRangeInput, type Placement } from '../../api';
import { decodeMmu, decodePaint } from '../../three/paint';
import { geometryToStl } from '../../three/geometry';
import { apply as applyMatrix, bedShapeOf, placementMatrix } from '@webslicer/shared';
import { IDENTITY_PLACEMENT, makeVolume, mintInstanceId, mintObjectId, mintRangeId, mintVolumeId } from '../../plater/objects';
import type { NewVolumeInput, PlaterObject, SlicePart } from '../types';

export interface ObjectSlice {
  objects: PlaterObject[];
  selectedIds: string[];
  addObjects: (
    items: Array<{
      name: string;
      geometry: Parameters<typeof geometryToStl>[0];
      config?: Config;
      extruder?: number;
      volumes?: NewVolumeInput[];
      instances?: Placement[];
      supportPaint?: string;
      seamPaint?: string;
      mmuPaint?: string;
      ranges?: LayerRangeInput[];
      /** variable layer height profile (T-045), restored from a project or the autosave */
      layerProfile?: number[];
    }>,
    opts?: { keepPositions?: boolean; snapshot?: PlaterObject[] },
  ) => Promise<void>;
  updateObject: (id: string, patch: Partial<Omit<PlaterObject, 'instances'>>) => void;
  removeObjects: (ids: string[]) => void;
  clearObjects: () => void;
  duplicateObjects: (ids: string[]) => Promise<void>;
  select: (ids: string[], additive?: boolean) => void;
  /** rename an object (empty names are ignored); one undo step */
  renameObject: (id: string, name: string) => void;
}

export const createObjectSlice: SlicePart<ObjectSlice> = (set, get) => ({
  objects: [],
  selectedIds: [],
  addObjects: async (items, opts = {}) => {
    // a caller that already changed the plater passes its own snapshot, so the undo step spans both
    get().recordHistory(opts.snapshot);
    const s = get();
    const bed = bedShapeOf(s.presets.printer.current);
    const created: PlaterObject[] = [];
    for (const it of items) {
      const g = it.geometry;
      g.computeBoundingBox();
      // Snapshot the box as numbers: `g.boundingBox` is the geometry's live Box3, and the recompute
      // below would overwrite what the offset has to be measured against.
      const box = g.boundingBox;
      if (!box) continue;
      const lo: [number, number, number] = [box.min.x, box.min.y, box.min.z];
      const hi: [number, number, number] = [box.max.x, box.max.y, box.max.z];
      // normalize: center XY at origin, min Z at 0
      const c: [number, number, number] = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]];
      g.translate(-c[0], -c[1], -c[2]);
      g.computeBoundingBox();
      g.computeVertexNormals();
      const size: [number, number, number] = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
      const pos = g.getAttribute('position');
      const index = g.getIndex();
      const tri = index ? index.count / 3 : pos.count / 3;
      const id = mintObjectId();
      const offset: [number, number, number] = [-c[0], -c[1], -c[2]];
      created.push({
        id,
        name: it.name,
        geometry: g,
        // Instances place `geometry`, which was just moved by the offset c. A project import brings object
        // coordinates (object at its own origin) plus one transform per build item, so the copy has to go
        // back where the file had it: the instance matrix is T_j · Translate(c) and its position is
        // therefore M_j · c – rotation and scale stay those of M_j. (A raw mesh comes in world-baked and
        // carries no item transform, so M_j is the identity there and the copy lands at the bed centre.)
        instances: (it.instances?.length ? it.instances : [IDENTITY_PLACEMENT]).map((t) => ({
          id: mintInstanceId(),
          position: opts.keepPositions
            ? applyMatrix(placementMatrix(t), c[0], c[1], c[2])
            : ([(bed.min[0] + bed.max[0]) / 2, (bed.min[1] + bed.max[1]) / 2, 0] as [number, number, number]),
          rotation: [...t.rotation] as [number, number, number],
          scale: [...t.scale] as [number, number, number],
        })),
        size,
        config: { ...(it.config || {}) },
        extruder: it.extruder || 0,
        visible: true,
        triangles: tri,
        volumes: (it.volumes || []).map((v) => makeVolume(v, offset)),
        paint:
          it.supportPaint || it.seamPaint || it.mmuPaint
            ? { supports: decodePaint(it.supportPaint, tri), seam: decodePaint(it.seamPaint, tri), mmu: decodeMmu(it.mmuPaint, tri) }
            : undefined,
        ranges: (it.ranges || []).map((r) => ({ id: mintRangeId(), minZ: r.minZ, maxZ: r.maxZ, config: { ...r.config } })),
        layerProfile: it.layerProfile?.length ? it.layerProfile.slice() : undefined,
      });
    }
    set((st) => ({
      objects: [...st.objects, ...created],
      selectedIds: created.map((c) => c.id),
      selectedVolumeId: undefined,
      selectedInstanceId: undefined,
      sliceDirty: true,
    }));
    if (!opts.keepPositions) get().arrange();
    // upload meshes
    for (const o of created) {
      try {
        const res = await api.uploadModel(geometryToStl(o.geometry), o.name);
        get().updateObject(o.id, { modelId: res.id });
      } catch (e) {
        get().updateObject(o.id, { uploadError: (e as Error).message });
        get().toast('error', `Upload of ${o.name} failed: ${(e as Error).message}`);
      }
      for (const v of o.volumes) await get().uploadVolume(o.id, v);
    }
  },
  updateObject: (id, patch) => set((s) => ({ objects: s.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)), sliceDirty: true })),
  removeObjects: (ids) => {
    get().recordHistory();
    set((s) => ({
      objects: s.objects.filter((o) => !ids.includes(o.id)),
      selectedIds: s.selectedIds.filter((i) => !ids.includes(i)),
      selectedVolumeId: undefined,
      selectedInstanceId: undefined,
      sliceDirty: true,
    }));
  },
  clearObjects: () => {
    get().recordHistory();
    set({
      objects: [],
      selectedIds: [],
      selectedVolumeId: undefined,
      selectedInstanceId: undefined,
      sliceDirty: true,
      gcode: undefined,
      gcodeJobId: undefined,
      customGcodes: [],
      previewColorMode: 'feature',
    });
  },
  duplicateObjects: async (ids) => {
    get().recordHistory();
    const s = get();
    const items = s.objects.filter((o) => ids.includes(o.id));
    const created: PlaterObject[] = items.map((o) => ({
      ...o,
      id: mintObjectId(),
      // independent copies: every instance gets its own transform (and id), offset like PrusaSlicer's duplicate
      instances: o.instances.map((i) => ({
        ...i,
        id: mintInstanceId(),
        position: [i.position[0] + 10, i.position[1] + 10, i.position[2]],
      })),
      config: { ...o.config },
      volumes: o.volumes.map((v) => ({ ...v, id: mintVolumeId(), config: { ...v.config } })),
      paint: o.paint ? { supports: o.paint.supports?.slice(), seam: o.paint.seam?.slice(), mmu: o.paint.mmu?.slice() } : undefined,
      ranges: o.ranges.map((r) => ({ ...r, id: mintRangeId(), config: { ...r.config } })),
      layerProfile: o.layerProfile?.slice(),
    }));
    set((st) => ({
      objects: [...st.objects, ...created],
      selectedIds: created.map((c) => c.id),
      selectedVolumeId: undefined,
      selectedInstanceId: undefined,
      sliceDirty: true,
    }));
    get().arrange();
  },
  select: (ids, additive = false) =>
    set((s) => ({
      selectedIds: additive ? Array.from(new Set([...s.selectedIds, ...ids])) : ids,
      selectedVolumeId: undefined,
      selectedInstanceId: undefined,
    })),
  renameObject: (id, name) => {
    const o = get().objects.find((x) => x.id === id);
    const next = name.trim();
    if (!o || !next || next === o.name) return;
    get().recordHistory();
    set((s) => ({ objects: s.objects.map((x) => (x.id === id ? { ...x, name: next } : x)), sliceDirty: true }));
  },
});
