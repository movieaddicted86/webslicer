/**
 * The plater slice: the objects on the bed, their instances and volumes, and every transform,
 * arrangement and split action that acts on them.
 *
 * The maths – packing, bounds, the object frame, shell splitting – lives in `web/src/plater/` and
 * `web/src/three/`; this slice owns the state and orchestrates. Painting (`./paint`) and height
 * ranges (`./ranges`) are spread into this creator so the store still composes the six named
 * slices, and this file stays inside the §4 limit. Other slices' state is read through `get()` on
 * the combined store (R-6).
 */
import type { StateCreator } from 'zustand';
import * as THREE from 'three';
import { api, type Config, type LayerRangeInput, type Placement, type Vec3 } from '../../api';
import { decodeMmu, decodePaint, encodeMmu, encodePaint } from '../../three/paint';
import { geometrySize, geometryToStl, objectFrameOffset, shellGeometry } from '../../three/geometry';
import {
  apply as applyMatrix,
  bedShapeOf,
  fillCount,
  mirrorPlacement,
  placementMatrix,
  transferredVolumePlacement,
  type PackItem,
} from '@webslicer/shared';
import { splitShells } from '../../plater/split';
import { mergeVolumes } from '../../plater/info';
import {
  arrangePlan,
  bedAndSpacing,
  fitsOnBed,
  layoutOf,
  packOptionsOf,
  withPlacements,
  type ArrangeSettings,
} from '../../plater/arrangement';
import { loadArrangeSettings, saveArrangeSettings } from '../../plater/arrangeSettings';
import {
  IDENTITY_PLACEMENT,
  instanceBounds,
  makeVolume,
  mintInstanceId,
  mintObjectId,
  mintRangeId,
  mintVolumeId,
  pickedInstanceId,
  selectedInstance,
} from '../../plater/objects';
import { createPaintSlice, type PaintSlice } from './paint';
import { createRangeSlice, type RangeSlice } from './ranges';
import { createCutSlice, type CutSlice } from './cut';
import type { NewVolumeInput, PlaterInstance, PlaterObject, PlaterVolume, State } from '../types';

export interface PlaterSlice extends PaintSlice, RangeSlice, CutSlice {
  objects: PlaterObject[];
  selectedIds: string[];
  transformMode: 'translate' | 'rotate' | 'scale';
  /** "Place on face" tool: the next click on an object face lays that face flat on the bed */
  placeOnFace: boolean;
  setPlaceOnFace: (on: boolean) => void;
  /** rotate an object so that the given world-space face normal points down (-Z) */
  placeObjectOnFace: (id: string, worldNormal: Vec3) => void;
  addObjects: (
    items: Array<{
      name: string;
      geometry: THREE.BufferGeometry;
      config?: Config;
      extruder?: number;
      volumes?: NewVolumeInput[];
      instances?: Placement[];
      supportPaint?: string;
      seamPaint?: string;
      mmuPaint?: string;
      ranges?: LayerRangeInput[];
    }>,
    opts?: { keepPositions?: boolean; snapshot?: PlaterObject[] },
  ) => Promise<void>;
  addVolume: (objectId: string, input: NewVolumeInput) => Promise<void>;
  updateVolume: (objectId: string, volumeId: string, patch: Partial<PlaterVolume>) => void;
  removeVolume: (objectId: string, volumeId: string) => void;
  selectVolume: (objectId: string, volumeId?: string) => void;
  uploadVolume: (objectId: string, v: PlaterVolume) => Promise<void>;
  updateObject: (id: string, patch: Partial<Omit<PlaterObject, 'instances'>>) => void;
  /** change the transform of a single instance of an object */
  updateInstance: (objectId: string, instanceId: string, patch: Partial<Pick<PlaterInstance, 'position' | 'rotation' | 'scale'>>) => void;
  selectInstance: (objectId: string, instanceId: string) => void;
  /** add `count` copies of the first instance and arrange them on the bed */
  addInstances: (objectId: string, count?: number) => void;
  /** remove one instance (default: the last); does nothing on the last remaining instance */
  removeInstance: (objectId: string, instanceId?: string) => void;
  /** set the number of instances of an object (1-1000), adding or removing from the end */
  setInstanceCount: (objectId: string, n: number) => void;
  /** add as many copies of the selected instance as fit on the bed */
  fillBedWithInstances: (objectId: string) => void;
  /** turn one instance into an independent object (like Duplicate) and drop it from the original */
  instanceToObject: (objectId: string, instanceId: string) => void;
  /**
   * Mirror the selection along a world axis: the picked instance if there is one, otherwise every
   * instance of the selected objects. One undo step, then the instances drop to the bed.
   */
  mirror: (axis: 0 | 1 | 2) => void;
  /**
   * Split the selected object's connected shells into independent objects, one per shell, each
   * copy of the original keeping exactly its place (keepPositions). One undo step.
   */
  splitToObjects: (objectId: string) => Promise<void>;
  /**
   * Split the selected object's connected shells into parts of the same object: the largest shell
   * stays the main mesh, every other one becomes a ModelPart volume. One undo step.
   */
  splitToParts: (objectId: string) => Promise<void>;
  /**
   * Merge the selected objects into the first one (T-042): every other object becomes ModelPart
   * volumes of it, at exactly their world positions. Settings, paint and ranges of the first object
   * are kept; paint of the others is dropped with an info toast. Only single-instance objects can be
   * merged (the button is disabled otherwise).
   */
  mergeObjects: (ids: string[]) => Promise<void>;
  /** rename an object (empty names are ignored); one undo step */
  renameObject: (id: string, name: string) => void;
  /** rename a sub-volume of an object (empty names are ignored); one undo step */
  renameVolume: (objectId: string, volumeId: string, name: string) => void;
  removeObjects: (ids: string[]) => void;
  clearObjects: () => void;
  duplicateObjects: (ids: string[]) => Promise<void>;
  select: (ids: string[], additive?: boolean) => void;
  setTransformMode: (m: State['transformMode']) => void;
  /** arrange every instance on the bed; false (and no change) when they do not all fit */
  arrange: () => boolean;
  /** arrange only the selected instances around the others (Shift+A); false when it does not fit */
  arrangeSelection: () => boolean;
  /** the Arrange settings from the gear popover (T-043), remembered per browser */
  arrangeSettings: ArrangeSettings;
  setArrangeSettings: (patch: Partial<ArrangeSettings>) => void;
  dropToBed: (id: string) => void;
}

/** The instances Shift+A moves: the picked one when there is one, else every instance of the selection. */
function movingInstanceKeys(s: State): Set<string> {
  const keys = new Set<string>();
  for (const o of s.objects) {
    if (!s.selectedIds.includes(o.id)) continue;
    const picked = pickedInstanceId(s, o);
    for (const inst of o.instances) if (!picked || inst.id === picked) keys.add(`${o.id}:${inst.id}`);
  }
  return keys;
}

export const createPlaterSlice: StateCreator<State, [], [], PlaterSlice> = (set, get) => ({
  ...createPaintSlice(set, get),
  ...createRangeSlice(set, get),
  ...createCutSlice(set, get),
  objects: [],
  selectedIds: [],
  transformMode: 'translate',
  arrangeSettings: loadArrangeSettings(),
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
  uploadVolume: async (objectId, v) => {
    try {
      const res = await api.uploadModel(geometryToStl(v.geometry), v.name);
      get().updateVolume(objectId, v.id, { modelId: res.id });
    } catch (e) {
      get().updateVolume(objectId, v.id, { uploadError: (e as Error).message });
      get().toast('error', `Upload of ${v.name} failed: ${(e as Error).message}`);
    }
  },
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
  updateObject: (id, patch) => set((s) => ({ objects: s.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)), sliceDirty: true })),
  updateInstance: (objectId, instId, patch) =>
    set((s) => ({
      objects: s.objects.map((o) =>
        o.id === objectId ? { ...o, instances: o.instances.map((i) => (i.id === instId ? { ...i, ...patch } : i)) } : o,
      ),
      sliceDirty: true,
    })),
  selectInstance: (objectId, instId) => set({ selectedIds: [objectId], selectedInstanceId: instId, selectedVolumeId: undefined }),
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
  setTransformMode: (transformMode) => set({ transformMode, placeOnFace: false }),
  placeOnFace: false,
  setPlaceOnFace: (placeOnFace) => set({ placeOnFace }),
  placeObjectOnFace: (id, worldNormal) => {
    const o = get().objects.find((x) => x.id === id);
    if (!o) return;
    get().recordHistory();
    const n = new THREE.Vector3(...worldNormal).normalize();
    if (n.lengthSq() < 0.5) return;
    const down = new THREE.Vector3(0, 0, -1);
    const q = new THREE.Quaternion().setFromUnitVectors(n, down);
    const inst = selectedInstance(get(), o);
    const cur = new THREE.Quaternion().setFromEuler(new THREE.Euler(inst.rotation[0], inst.rotation[1], inst.rotation[2], 'XYZ'));
    const next = q.multiply(cur);
    const e = new THREE.Euler().setFromQuaternion(next, 'XYZ');
    get().updateInstance(id, inst.id, { rotation: [e.x, e.y, e.z] });
    get().dropToBed(id);
    set({ placeOnFace: false });
  },
  dropToBed: (id) => {
    const s = get();
    const o = s.objects.find((x) => x.id === id);
    if (!o) return;
    const inst = selectedInstance(s, o);
    const box = instanceBounds(o, inst);
    if (Math.abs(box.min.z) > 1e-6)
      get().updateInstance(id, inst.id, { position: [inst.position[0], inst.position[1], inst.position[2] - box.min.z] });
  },
  arrange: () => {
    const s = get();
    const updates = arrangePlan(s.objects, bedShapeOf(s.presets.printer.current), packOptionsOf(s.presets, s.arrangeSettings));
    if (!updates) {
      // nothing fits: report it and leave the plater untouched (checked before recording history)
      s.toast('error', 'Not all objects fit on the bed');
      return false;
    }
    get().recordHistory();
    set((st) => ({ objects: withPlacements(st.objects, updates), sliceDirty: true }));
    return true;
  },
  arrangeSelection: () => {
    const s = get();
    const moving = movingInstanceKeys(s);
    if (!moving.size) {
      s.toast('info', 'Select the objects to arrange first');
      return false;
    }
    const updates = arrangePlan(s.objects, bedShapeOf(s.presets.printer.current), packOptionsOf(s.presets, s.arrangeSettings), moving);
    if (!updates) {
      s.toast('error', 'The selected objects do not fit on the bed');
      return false;
    }
    get().recordHistory();
    set((st) => ({ objects: withPlacements(st.objects, updates), sliceDirty: true }));
    return true;
  },
  setArrangeSettings: (patch) => {
    set((s) => ({ arrangeSettings: { ...s.arrangeSettings, ...patch } }));
    saveArrangeSettings(get().arrangeSettings);
  },
  addInstances: (objectId, count = 1) => {
    const s0 = get();
    const o = s0.objects.find((x) => x.id === objectId);
    if (!o || !Number.isFinite(count) || count < 1) return;
    const add = Math.min(Math.floor(count), 1000 - o.instances.length);
    if (add < 1) {
      s0.toast('info', `${o.name} already has the maximum of 1000 instances`);
      return;
    }
    const template = selectedInstance(s0, o);
    const added: PlaterInstance[] = Array.from({ length: add }, () => ({
      id: mintInstanceId(),
      position: [...template.position] as [number, number, number],
      rotation: [...template.rotation] as [number, number, number],
      scale: [...template.scale] as [number, number, number],
    }));
    const preview = { ...o, instances: [...o.instances, ...added] };
    const bed = bedShapeOf(s0.presets.printer.current);
    if (
      !fitsOnBed(
        s0.objects.filter((x) => x.id !== objectId),
        preview,
        bed,
        packOptionsOf(s0.presets, s0.arrangeSettings),
      )
    ) {
      // the copies would be born off the bed; refuse instead of leaving an unprintable plater
      s0.toast('error', `Not enough room on the bed for ${add > 1 ? `${add} more instances` : 'another instance'} of ${o.name}`);
      return;
    }
    get().recordHistory();
    set((s) => ({
      objects: s.objects.map((x) => (x.id === objectId ? { ...x, instances: [...x.instances, ...added] } : x)),
      selectedIds: [objectId],
      selectedInstanceId: added[0].id,
      selectedVolumeId: undefined,
      sliceDirty: true,
    }));
    // AC-1.1: the new copies go to free bed space
    get().arrange();
  },
  removeInstance: (objectId, instId) => {
    const s = get();
    const o = s.objects.find((x) => x.id === objectId);
    if (!o || o.instances.length <= 1) return; // AC-1.2: the last instance stays
    const target = instId ? o.instances.find((i) => i.id === instId) : o.instances[o.instances.length - 1];
    if (!target) return;
    get().recordHistory();
    const kept = o.instances.filter((i) => i.id !== target.id);
    set((s2) => ({
      objects: s2.objects.map((x) => (x.id === objectId ? { ...x, instances: x.instances.filter((i) => i.id !== target.id) } : x)),
      selectedInstanceId: s2.selectedInstanceId === target.id ? kept[kept.length - 1].id : s2.selectedInstanceId,
      sliceDirty: true,
    }));
  },
  setInstanceCount: (objectId, n) => {
    const s = get();
    const o = s.objects.find((x) => x.id === objectId);
    if (!o) return;
    if (!Number.isInteger(n) || n < 1 || n > 1000) return; // AC-2.1: invalid input changes nothing
    if (n === o.instances.length) return;
    if (n < o.instances.length) {
      get().recordHistory();
      const kept = o.instances.slice(0, n);
      set((s2) => ({
        objects: s2.objects.map((x) => (x.id === objectId ? { ...x, instances: x.instances.slice(0, n) } : x)),
        selectedInstanceId: kept.some((i) => i.id === s2.selectedInstanceId) ? s2.selectedInstanceId : kept[kept.length - 1].id,
        sliceDirty: true,
      }));
      return;
    }
    get().addInstances(objectId, n - o.instances.length);
  },
  fillBedWithInstances: (objectId) => {
    const s = get();
    const o = s.objects.find((x) => x.id === objectId);
    if (!o) return;
    const { bed, spacing: presetSpacing } = bedAndSpacing(s.presets);
    const spacing = s.arrangeSettings.spacing ?? presetSpacing;
    // every instance currently on the bed is an occupied slot, `fillCount` returns the copies that still fit
    const items: PackItem[] = layoutOf(s.objects);
    const box = instanceBounds(o, selectedInstance(s, o));
    const capacity = Math.max(0, Math.min(1000 - o.instances.length, 1000 - items.length));
    const n = fillCount(box.max.x - box.min.x, box.max.y - box.min.y, items, bed, { limit: capacity, spacing });
    if (n < 1) {
      s.toast('info', 'No room left for another copy');
      return;
    }
    get().addInstances(objectId, n);
  },
  instanceToObject: (objectId, instId) => {
    const s = get();
    const o = s.objects.find((x) => x.id === objectId);
    const inst = o?.instances.find((i) => i.id === instId);
    if (!o || !inst) return;
    get().recordHistory();
    const src = o;
    // AC-4.5: a deep copy like Duplicate, but only this instance's transform is kept
    const created: PlaterObject = {
      ...src,
      id: mintObjectId(),
      instances: [{ id: mintInstanceId(), position: [...inst.position], rotation: [...inst.rotation], scale: [...inst.scale] }],
      config: { ...src.config },
      volumes: src.volumes.map((v) => ({ ...v, id: mintVolumeId(), config: { ...v.config } })),
      paint: src.paint ? { supports: src.paint.supports?.slice(), seam: src.paint.seam?.slice(), mmu: src.paint.mmu?.slice() } : undefined,
      ranges: src.ranges.map((r) => ({ ...r, id: mintRangeId(), config: { ...r.config } })),
    };
    // the original keeps its other instances; with only one it disappears (like PrusaSlicer's split)
    const rest = src.instances.filter((i) => i.id !== inst.id);
    set((st) => ({
      objects: [...st.objects.filter((x) => x.id !== objectId || rest.length > 0), created].map((x) =>
        x.id === objectId ? { ...x, instances: rest } : x,
      ),
      selectedIds: [created.id],
      selectedInstanceId: created.instances[0].id,
      selectedVolumeId: undefined,
      sliceDirty: true,
    }));
  },
  mirror: (axis) => {
    const s = get();
    // AC-3: a picked instance is mirrored on its own, otherwise every instance of the selection
    const targets = new Map<string, PlaterInstance>();
    for (const o of s.objects) {
      if (!s.selectedIds.includes(o.id)) continue;
      const only = pickedInstanceId(s, o);
      for (const inst of o.instances) {
        if (only && inst.id !== only) continue;
        targets.set(`${o.id}:${inst.id}`, { id: inst.id, ...mirrorPlacement(inst, axis) });
      }
    }
    if (!targets.size) return;
    get().recordHistory();
    // the mirror keeps the instance position, but its rotated mesh can now reach below the bed
    const dropped = new Map<string, PlaterInstance>();
    for (const o of s.objects) {
      for (const inst of o.instances) {
        const next = targets.get(`${o.id}:${inst.id}`);
        if (!next) continue;
        const box = instanceBounds({ ...o, instances: [next] }, next);
        dropped.set(
          `${o.id}:${inst.id}`,
          Math.abs(box.min.z) > 1e-6 ? { ...next, position: [next.position[0], next.position[1], next.position[2] - box.min.z] } : next,
        );
      }
    }
    set((st) => ({
      objects: st.objects.map((o) => {
        if (!o.instances.some((i) => targets.has(`${o.id}:${i.id}`))) return o;
        return { ...o, instances: o.instances.map((i) => dropped.get(`${o.id}:${i.id}`) ?? i) };
      }),
      sliceDirty: true,
    }));
  },
  splitToObjects: async (objectId) => {
    const s = get();
    const o = s.objects.find((x) => x.id === objectId);
    if (!o) return;
    // AC-3 of the work package: modifiers and parts would have to be carried onto every shell, so
    // the button is disabled for objects with volumes (the tooltip says why)
    if (o.volumes.length) return;
    const positions = o.geometry.getAttribute('position').array as Float32Array;
    const shells = splitShells(positions);
    if (shells.length < 2) {
      s.toast('info', 'The object consists of a single part');
      return;
    }
    const snapshot = s.objects;
    // geometry in the object frame; addObjects translates it by the same offset again, which is
    // exactly what it does when the object was imported, so the shells land where they sat.
    // Paint is per triangle, so every shell carries the paint of the triangles that moved into it.
    const shellPaint = (tris: Uint32Array) => {
      const pick = (arr?: Uint8Array): Uint8Array | undefined => {
        if (!arr) return undefined;
        const out = new Uint8Array(tris.length);
        for (let i = 0; i < tris.length; i++) out[i] = arr[tris[i]];
        return out.some((v) => v) ? out : undefined;
      };
      const supports = pick(o.paint?.supports);
      const seam = pick(o.paint?.seam);
      const mmu = pick(o.paint?.mmu);
      return { supports: supports && encodePaint(supports), seam: seam && encodePaint(seam), mmu: mmu && encodeMmu(mmu) };
    };
    const items = shells.map((tris, i) => {
      const paint = shellPaint(tris);
      return {
        name: `${o.name} (${i + 1})`,
        geometry: shellGeometry(positions, tris),
        config: o.config,
        extruder: o.extruder,
        ranges: o.ranges.map((r) => ({ minZ: r.minZ, maxZ: r.maxZ, config: r.config })),
        supportPaint: paint.supports,
        seamPaint: paint.seam,
        mmuPaint: paint.mmu,
        instances: o.instances.map((inst) => ({
          position: [...inst.position] as [number, number, number],
          rotation: [...inst.rotation] as [number, number, number],
          scale: [...inst.scale] as [number, number, number],
        })),
      };
    });
    // one undo step for the whole action: the original goes, the shells arrive (the snapshot of
    // `addObjects` has to be the plater from before the removal, hence the explicit one)
    set((st) => ({
      objects: st.objects.filter((x) => x.id !== objectId),
      selectedIds: st.selectedIds.filter((id) => id !== objectId),
      selectedVolumeId: undefined,
      selectedInstanceId: undefined,
    }));
    await get().addObjects(items, { keepPositions: true, snapshot });
    s.toast('info', `Split into ${shells.length} objects`);
  },
  splitToParts: async (objectId) => {
    const s = get();
    const o = s.objects.find((x) => x.id === objectId);
    if (!o) return;
    const positions = o.geometry.getAttribute('position').array as Float32Array;
    const shells = splitShells(positions);
    if (shells.length < 2) {
      s.toast('info', 'The object consists of a single part');
      return;
    }
    s.recordHistory();
    const [main, ...rest] = shells;
    const mainGeometry = shellGeometry(positions, main);
    // paint follows the triangle indices; shells that become parts lose theirs
    const remap = (arr?: Uint8Array): Uint8Array | undefined => {
      if (!arr) return undefined;
      const out = new Uint8Array(main.length);
      for (let i = 0; i < main.length; i++) out[i] = arr[main[i]];
      return out.some((v) => v) ? out : undefined;
    };
    let dropped = false;
    for (const kind of ['supports', 'seam', 'mmu'] as const) {
      if (o.paint?.[kind] && !remap(o.paint[kind])) dropped = true;
    }
    const offset = objectFrameOffset(o);
    const volumes: PlaterVolume[] = rest.flatMap((tris, i) => {
      // a volume is centred at its own origin and placed at its centre in the object frame
      const geometry = shellGeometry(positions, tris);
      geometry.computeBoundingBox();
      const bb = geometry.boundingBox;
      if (!bb) return [];
      const centre: [number, number, number] = [(bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, (bb.min.z + bb.max.z) / 2];
      geometry.translate(-centre[0], -centre[1], -centre[2]);
      geometry.computeVertexNormals();
      return [
        {
          id: mintVolumeId(),
          name: `Part ${i + 2}`,
          type: 'ModelPart',
          geometry,
          position: [centre[0] + offset[0], centre[1] + offset[1], centre[2] + offset[2]],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          size: geometrySize(geometry),
          config: {},
          extruder: 0,
          triangles: tris.length,
        },
      ];
    });
    const paint = o.paint ? { supports: remap(o.paint.supports), seam: remap(o.paint.seam), mmu: remap(o.paint.mmu) } : undefined;
    set((st) => ({
      objects: st.objects.map((x) =>
        x.id === objectId
          ? {
              ...x,
              geometry: mainGeometry,
              triangles: main.length,
              volumes: [...x.volumes, ...volumes],
              paint,
              modelId: undefined,
              uploadError: undefined,
            }
          : x,
      ),
      selectedVolumeId: undefined,
      sliceDirty: true,
    }));
    if (dropped) s.toast('info', 'Paint on the parts that became volumes was dropped');
    try {
      const res = await api.uploadModel(geometryToStl(mainGeometry), o.name);
      get().updateObject(objectId, { modelId: res.id });
    } catch (e) {
      get().updateObject(objectId, { uploadError: (e as Error).message });
      get().toast('error', `Upload of ${o.name} failed: ${(e as Error).message}`);
    }
    for (const v of volumes) await get().uploadVolume(objectId, v);
    s.toast('info', `Split into 1 object and ${volumes.length} parts`);
  },
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
  renameObject: (id, name) => {
    const o = get().objects.find((x) => x.id === id);
    const next = name.trim();
    if (!o || !next || next === o.name) return;
    get().recordHistory();
    set((s) => ({ objects: s.objects.map((x) => (x.id === id ? { ...x, name: next } : x)), sliceDirty: true }));
  },
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
