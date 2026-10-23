/**
 * The painting part of the plater slice (R-6, tools T-046): the paint tool, the brush and the paint
 * strokes. Split out of `plater.ts` to stay inside the §4 file limit (and because painting is one
 * concern); `createPlaterSlice` spreads this creator into itself, so the store keeps composing the six
 * named slices.
 *
 * Which paint tool is open is the tools slice's `activeTool`; `startPaint` opens that tool through the
 * registry, so both ways in (the bar/shortcut and this action) run the same lifecycle.
 */
import { api } from '../../api';
import { remapPaint, subdivideForPainting, type PaintKind } from '../../three/paint';
import { geometryToStl } from '../../three/geometry';
import { clampExtruder } from '../../plater/extruders';
import { paintToolOf } from '../../tools/paintKind';
import type { SlicePart } from '../types';

export interface PaintSlice {
  /** the brush mode of the open paint tool: enforcer, blocker or erase */
  paintTool: 'enforcer' | 'blocker' | 'erase';
  /** extruder painted in MMU mode (1-based) */
  paintExtruder: number;
  setPaintExtruder: (n: number) => void;
  brushRadius: number;
  /** open a paint tool on the object (subdividing the mesh first when needed) */
  startPaint: (objectId: string, kind: PaintKind) => Promise<void>;
  /** close the open tool (the paint panel's Done, Esc, and the L/P shortcuts use it) */
  stopPaint: () => void;
  setPaintTool: (t: 'enforcer' | 'blocker' | 'erase') => void;
  setBrushRadius: (r: number) => void;
  beginPaintStroke: (objectId: string) => void;
  applyPaint: (objectId: string, kind: PaintKind, triangles: number[], value: number) => void;
  clearPaint: (objectId: string, kind: PaintKind) => void;
}

export const createPaintSlice: SlicePart<PaintSlice> = (set, get) => ({
  paintTool: 'enforcer',
  brushRadius: 3,
  startPaint: async (objectId, kind) => {
    const o = get().objects.find((x) => x.id === objectId);
    if (!o) return;
    set({ selectedIds: [objectId], selectedVolumeId: undefined, view: 'plater' });
    // the tool opens through the registry, like a click in the bar: one lifecycle for both ways in
    get().openTool(paintToolOf(kind));
    if (o.paintReady) return;
    // subdivide the mesh so the brush has a useful resolution
    get().recordHistory();
    const maxDim = Math.max(o.size[0], o.size[1], o.size[2]);
    const maxEdge = Math.min(5, Math.max(1, maxDim / 30));
    const { geometry, parent } = subdivideForPainting(o.geometry, maxEdge);
    const tri = geometry.getAttribute('position').count / 3;
    const paint = o.paint
      ? { supports: remapPaint(o.paint.supports, parent), seam: remapPaint(o.paint.seam, parent), mmu: remapPaint(o.paint.mmu, parent) }
      : undefined;
    get().updateObject(objectId, { geometry, triangles: tri, paint, paintReady: true, modelId: undefined, uploadError: undefined });
    try {
      const res = await api.uploadModel(geometryToStl(geometry), o.name);
      get().updateObject(objectId, { modelId: res.id });
    } catch (e) {
      get().updateObject(objectId, { uploadError: (e as Error).message });
      get().toast('error', `Upload of ${o.name} failed: ${(e as Error).message}`);
    }
  },
  stopPaint: () => get().closeTool(),
  setPaintTool: (paintTool) => set({ paintTool }),
  paintExtruder: 1,
  setPaintExtruder: (n) => {
    const count = get().extruderCount();
    set({ paintExtruder: clampExtruder(n, count) || 1 });
  },
  setBrushRadius: (brushRadius) => set({ brushRadius: Math.max(0.2, Math.min(50, brushRadius)) }),
  beginPaintStroke: (objectId) => {
    // history snapshot with copied paint arrays (strokes mutate them in place); the copy is what
    // `recordHistory` does for every snapshot, so all three paint kinds survive (B3)
    if (get().objects.some((o) => o.id === objectId)) get().recordHistory();
  },
  applyPaint: (objectId, kind, triangles, value) => {
    const o = get().objects.find((x) => x.id === objectId);
    if (!o || !triangles.length) return;
    const paint = o.paint ? { ...o.paint } : {};
    let arr = paint[kind];
    if (!arr) {
      arr = new Uint8Array(o.triangles);
      paint[kind] = arr;
    }
    for (const t of triangles) if (t < arr.length) arr[t] = value;
    set((s) => ({
      objects: s.objects.map((x) => (x.id === objectId ? { ...x, paint, paintVersion: (x.paintVersion || 0) + 1 } : x)),
      sliceDirty: true,
    }));
  },
  clearPaint: (objectId, kind) => {
    const o = get().objects.find((x) => x.id === objectId);
    if (!o?.paint?.[kind]) return;
    get().recordHistory();
    const paint = { ...o.paint, [kind]: undefined };
    set((s) => ({
      objects: s.objects.map((x) => (x.id === objectId ? { ...x, paint, paintVersion: (x.paintVersion || 0) + 1 } : x)),
      sliceDirty: true,
    }));
  },
});
