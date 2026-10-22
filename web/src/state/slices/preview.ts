/**
 * The preview slice: the parsed G-code, the layer/move sliders, the visibility of features and
 * markers, the colour mode, the colour changes and pauses, and the re-slice that follows them.
 */
import type { StateCreator } from 'zustand';
import { api, type CustomGcode } from '../../api';
import type { PreviewColorMode } from '../../gcode/colorschemes';
import type { MarkerKind } from '../../gcode/types';
import type { State } from '../types';

export interface PreviewSlice {
  gcodeLoading: boolean;
  previewLayerRange: [number, number];
  previewShowTravel: boolean;
  previewFeatureVisibility: Record<string, boolean>;
  /**
   * Highest global move index shown in the top visible layer (PrusaSlicer's horizontal slider);
   * `undefined` means "the whole layer".
   */
  previewMoveCut?: number;
  /** which marker kinds the preview draws */
  previewMarkers: Record<MarkerKind, boolean>;
  /** the plater meshes drawn translucent over the toolpaths */
  previewShowShells: boolean;
  setPreviewMoveCut: (m?: number) => void;
  togglePreviewMarker: (k: MarkerKind) => void;
  setPreviewShowShells: (b: boolean) => void;
  /** how toolpaths are coloured in the preview */
  previewColorMode: PreviewColorMode;
  setPreviewColorMode: (m: PreviewColorMode) => void;
  /** colour changes, pauses and custom G-code per layer height (plate level, like PrusaSlicer) */
  customGcodes: CustomGcode[];
  addCustomGcode: (c: CustomGcode) => void;
  updateCustomGcode: (printZ: number, patch: Partial<CustomGcode>) => void;
  removeCustomGcode: (printZ: number) => void;
  setCustomGcodes: (codes: CustomGcode[]) => void;
  loadGcodePreview: (jobId: string) => Promise<void>;
  setPreviewLayerRange: (r: [number, number]) => void;
  setPreviewShowTravel: (b: boolean) => void;
  togglePreviewFeature: (f: string) => void;
}

export const createPreviewSlice: StateCreator<State, [], [], PreviewSlice> = (set, get) => {
  /** Re-slice after a colour change / pause was edited, like PrusaSlicer's background G-code export. */
  let resliceTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * B9: the preview load that may still apply its result. Two loads can overlap (the re-slice after a
   * colour change plus a manual reload, a slow first request), and the *older* answer used to win by
   * arriving last. Only the newest request is allowed to set the state; the others are dropped.
   */
  let previewLoad = 0;
  const scheduleReslice = () => {
    clearTimeout(resliceTimer);
    resliceTimer = setTimeout(() => {
      const s = get();
      const running = s.job && (s.job.status === 'running' || s.job.status === 'queued');
      if (s.view === 'preview' && s.objects.length && !running) void s.slice();
    }, 900);
  };
  return {
    gcodeLoading: false,
    previewLayerRange: [0, 0],
    previewShowTravel: false,
    previewFeatureVisibility: {},
    previewMoveCut: undefined,
    previewMarkers: { retract: false, deretract: false, seam: false, wipe: false, tool_change: false, color_change: false },
    previewShowShells: false,
    setPreviewMoveCut: (previewMoveCut) => set({ previewMoveCut }),
    togglePreviewMarker: (k) => set((s) => ({ previewMarkers: { ...s.previewMarkers, [k]: !s.previewMarkers[k] } })),
    setPreviewShowShells: (previewShowShells) => set({ previewShowShells }),
    previewColorMode: 'feature',
    setPreviewColorMode: (previewColorMode) => set({ previewColorMode }),
    customGcodes: [],
    addCustomGcode: (c) => {
      set((s) => ({
        customGcodes: [...s.customGcodes.filter((x) => Math.abs(x.printZ - c.printZ) > 1e-4), c].sort((a, b) => a.printZ - b.printZ),
        previewColorMode: c.type === 'color_change' ? 'colorprint' : s.previewColorMode,
        sliceDirty: true,
      }));
      scheduleReslice();
    },
    updateCustomGcode: (printZ, patch) => {
      set((s) => ({
        customGcodes: s.customGcodes.map((x) => (Math.abs(x.printZ - printZ) <= 1e-4 ? { ...x, ...patch } : x)),
        sliceDirty: true,
      }));
      scheduleReslice();
    },
    removeCustomGcode: (printZ) => {
      set((s) => {
        const customGcodes = s.customGcodes.filter((x) => Math.abs(x.printZ - printZ) > 1e-4);
        return {
          customGcodes,
          previewColorMode:
            s.previewColorMode === 'colorprint' && !customGcodes.some((x) => x.type === 'color_change') ? 'feature' : s.previewColorMode,
          sliceDirty: true,
        };
      });
      scheduleReslice();
    },
    setCustomGcodes: (codes) =>
      set((s) => ({
        customGcodes: [...codes].sort((a, b) => a.printZ - b.printZ),
        previewColorMode: codes.some((x) => x.type === 'color_change')
          ? 'colorprint'
          : s.previewColorMode === 'colorprint'
            ? 'feature'
            : s.previewColorMode,
      })),
    loadGcodePreview: async (jobId) => {
      const load = ++previewLoad;
      set({ gcodeLoading: true });
      try {
        const text = await api.gcodeText(jobId);
        const { parseGcodeInWorker } = await import('../../gcode/parserClient');
        const parsed = await parseGcodeInWorker(text);
        // a newer request started while this one was loading; its answer is the one that counts
        if (load !== previewLoad) return;
        const vis: Record<string, boolean> = {};
        for (const f of parsed.featureTypes) vis[f] = true;
        // keep the slider position when re-slicing (e.g. after adding a colour change)
        const prev = get().gcode;
        const prevRange = get().previewLayerRange;
        const keep = prev && prev.layerCount === parsed.layerCount;
        const range: [number, number] = keep ? prevRange : [0, Math.max(0, parsed.layerCount - 1)];
        const oldVis = get().previewFeatureVisibility;
        for (const f of parsed.featureTypes) if (keep && oldVis[f] === false) vis[f] = false;
        set({
          gcode: parsed,
          gcodeJobId: jobId,
          previewLayerRange: range,
          previewMoveCut: undefined,
          previewFeatureVisibility: vis,
          view: 'preview',
        });
      } finally {
        // only the newest load owns the spinner; a superseded one must not clear it for its successor
        if (load === previewLoad) set({ gcodeLoading: false });
      }
    },
    // moving a vertical slider resets the horizontal one to "end of layer"
    setPreviewLayerRange: (previewLayerRange) => set({ previewLayerRange, previewMoveCut: undefined }),
    setPreviewShowTravel: (previewShowTravel) => set({ previewShowTravel }),
    togglePreviewFeature: (f) =>
      set((s) => ({ previewFeatureVisibility: { ...s.previewFeatureVisibility, [f]: !s.previewFeatureVisibility[f] } })),
  };
};
