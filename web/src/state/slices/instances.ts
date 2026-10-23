/**
 * The plater's instances (q4-web-store): the copies of an object, their transforms, their count and
 * the actions that add, remove, fill, mirror and detach them. Split out of `plater.ts`;
 * `createPlaterSlice` spreads this creator into itself.
 */
import { bedShapeOf, fillCount, mirrorPlacement, type PackItem } from '@webslicer/shared';
import { bedAndSpacing, fitsOnBed, layoutOf, packOptionsOf } from '../../plater/arrangement';
import {
  instanceBounds,
  mintInstanceId,
  mintObjectId,
  mintRangeId,
  mintVolumeId,
  pickedInstanceId,
  selectedInstance,
} from '../../plater/objects';
import type { PlaterInstance, PlaterObject, SlicePart } from '../types';

export interface InstanceSlice {
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
}

export const createInstanceSlice: SlicePart<InstanceSlice> = (set, get) => ({
  updateInstance: (objectId, instId, patch) =>
    set((s) => ({
      objects: s.objects.map((o) =>
        o.id === objectId ? { ...o, instances: o.instances.map((i) => (i.id === instId ? { ...i, ...patch } : i)) } : o,
      ),
      sliceDirty: true,
    })),
  selectInstance: (objectId, instId) => set({ selectedIds: [objectId], selectedInstanceId: instId, selectedVolumeId: undefined }),
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
    // AC-1.1: the new copies go to free bed space; N8b: inside the same undo step
    get().arrange({ record: false });
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
      layerProfile: src.layerProfile?.slice(),
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
});
