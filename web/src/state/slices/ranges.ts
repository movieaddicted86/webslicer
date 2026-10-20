/**
 * The height-range part of the plater slice (R-6): the layer-height modifiers an object carries.
 * Split out of `plater.ts` to stay inside the §4 file limit; `createPlaterSlice` spreads this
 * creator into itself.
 */
import { mintRangeId, selectedInstance } from '../../plater/objects';
import type { LayerRange, SlicePart } from '../types';

export interface RangeSlice {
  /** height range modifiers */
  addRange: (objectId: string) => void;
  updateRange: (objectId: string, rangeId: string, patch: Partial<LayerRange>) => void;
  removeRange: (objectId: string, rangeId: string) => void;
}

export const createRangeSlice: SlicePart<RangeSlice> = (set, get) => ({
  addRange: (objectId) => {
    const o = get().objects.find((x) => x.id === objectId);
    if (!o) return;
    get().recordHistory();
    const top = o.ranges.reduce((m, r) => Math.max(m, r.maxZ), 0);
    const h = o.size[2] * Math.abs(selectedInstance(get(), o).scale[2]);
    const minZ = Math.min(top, h);
    const maxZ = Math.min(h, minZ + Math.max(2, h / 4));
    const r: LayerRange = {
      id: mintRangeId(),
      minZ: +minZ.toFixed(2),
      maxZ: +maxZ.toFixed(2),
      config: { layer_height: get().presets.print.current.layer_height || '0.2' },
    };
    set((s) => ({ objects: s.objects.map((x) => (x.id === objectId ? { ...x, ranges: [...x.ranges, r] } : x)), sliceDirty: true }));
  },
  updateRange: (objectId, rangeId, patch) => {
    get().recordHistory();
    set((s) => ({
      objects: s.objects.map((x) => (x.id === objectId ? { ...x, ranges: x.ranges.map((r) => (r.id === rangeId ? { ...r, ...patch } : r)) } : x)),
      sliceDirty: true,
    }));
  },
  removeRange: (objectId, rangeId) => {
    get().recordHistory();
    set((s) => ({
      objects: s.objects.map((x) => (x.id === objectId ? { ...x, ranges: x.ranges.filter((r) => r.id !== rangeId) } : x)),
      sliceDirty: true,
    }));
  },
});
