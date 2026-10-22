/**
 * The job slice: the slice request built from the plater and the presets, the running job and its
 * log, and the server-side autosave of the plater.
 */
import type { StateCreator } from 'zustand';
import { api, autosaveApi, type Config, type PresetType, type SliceRequest } from '../../api';
import { encodeMmu, encodePaint } from '../../three/paint';
import { decodeVector } from '../../values';
import { parseThumbnailSpec, placementMatrix } from '@webslicer/shared';
import { clientId } from '../client';
import type { State } from '../types';

export interface JobSlice {
  jobLog: string[];
  sliceDirty: boolean;
  binaryGcode: boolean;
  buildSliceRequest: () => SliceRequest;
  slice: () => Promise<void>;
  cancelSlice: () => Promise<void>;
  applyProjectConfig: (cfg: Config) => Promise<void>;
  autosaveState: 'idle' | 'saving' | 'saved' | 'error';
  autosaveNow: () => Promise<void>;
  discardAutosave: () => Promise<void>;
}

export const createJobSlice: StateCreator<State, [], [], JobSlice> = (set, get) => ({
  jobLog: [],
  sliceDirty: true,
  binaryGcode: false,
  buildSliceRequest: () => {
    const s = get();
    const n = s.extruderCount();
    const filaments = s.presets.filament.slice(0, n).map((f) => ({ name: f.name, config: f.current }));
    const objects = s.objects
      .filter((o) => o.visible && o.modelId)
      .map((o) => ({
        modelId: o.modelId!,
        name: o.name,
        transform: placementMatrix(o.instances[0]),
        instances: o.instances.length > 1 ? o.instances.map((i) => placementMatrix(i)) : undefined,
        config: Object.keys(o.config).length ? o.config : undefined,
        extruder: o.extruder || undefined,
        supportPaint: o.paint?.supports && o.paint.supports.some((x) => x) ? encodePaint(o.paint.supports) : undefined,
        seamPaint: o.paint?.seam && o.paint.seam.some((x) => x) ? encodePaint(o.paint.seam) : undefined,
        mmuPaint: o.paint?.mmu && o.paint.mmu.some((x) => x) ? encodeMmu(o.paint.mmu) : undefined,
        ranges: o.ranges.filter((r) => r.maxZ > r.minZ).map((r) => ({ minZ: r.minZ, maxZ: r.maxZ, config: r.config })),
        volumes: o.volumes
          .filter((v) => v.modelId)
          .map((v) => ({
            modelId: v.modelId!,
            name: v.name,
            type: v.type,
            transform: placementMatrix(v),
            config: Object.keys(v.config).length ? v.config : undefined,
            extruder: v.extruder || undefined,
          })),
      }));
    const first = s.objects[0]?.name?.replace(/\.[^.]+$/, '') || 'print';
    return {
      objects,
      print: { name: s.presets.print.name, config: s.presets.print.current },
      filaments,
      printer: { name: s.presets.printer.name, config: s.presets.printer.current },
      outputName: s.objects.length > 1 ? `${first}_and_${s.objects.length - 1}_more` : first,
      binaryGcode: s.binaryGcode,
      customGcodes: s.customGcodes.length ? s.customGcodes : undefined,
    };
  },
  slice: async () => {
    const s = get();
    if (!s.objects.length) {
      get().toast('error', 'Add a model first');
      return;
    }
    const pending = s.objects.filter((o) => (!o.modelId && !o.uploadError) || o.volumes.some((v) => !v.modelId && !v.uploadError));
    if (pending.length) {
      get().toast('info', 'Waiting for model upload…');
      await new Promise((r) => setTimeout(r, 1000));
      return get().slice();
    }
    const req = get().buildSliceRequest();
    if (!req.objects.length) {
      get().toast('error', 'No sliceable objects (upload failed?)');
      return;
    }
    // Previews for the printer display / print host (the slicer CLI cannot render them).
    if (!s.binaryGcode && s.renderThumbnails) {
      const pc = s.presets.printer.current;
      const specs = parseThumbnailSpec(pc.thumbnails, pc.thumbnails_format);
      if (specs.length) {
        try {
          const colDef = s.schema?.options.filament_colour;
          const colors = s.presets.filament.map(
            (f) => (colDef ? decodeVector(colDef, f.current.filament_colour)[0] : f.current.filament_colour) || '',
          );
          req.thumbnails = s.renderThumbnails(specs, colors);
        } catch (e) {
          console.warn('thumbnail rendering failed', e);
        }
      }
    }
    try {
      const job = await api.slice(req);
      set({ job, jobLog: [], sliceDirty: false, view: 'preview' });
      api.jobEvents(job.id, (ev) => {
        if (ev.type === 'log' && ev.line) set((st) => ({ jobLog: [...st.jobLog.slice(-400), ev.line!] }));
        if (ev.type === 'progress')
          set((st) => (st.job ? { job: { ...st.job, percent: ev.percent ?? st.job.percent, message: ev.message ?? st.job.message } } : {}));
        if (ev.job) set({ job: ev.job });
        if (ev.type === 'done' && ev.job) {
          get().toast('success', `Slicing finished: ${ev.job.outputName}`);
          if (ev.job.outputName.endsWith('.gcode'))
            get()
              .loadGcodePreview(ev.job.id)
              .catch((e) => get().toast('error', e.message));
        }
        if (ev.type === 'error') get().toast('error', `Slicing failed: ${ev.message || 'unknown error'}`);
      });
    } catch (e) {
      get().toast('error', `Slice request failed: ${(e as Error).message}`);
    }
  },
  cancelSlice: async () => {
    const j = get().job;
    if (!j) return;
    await api.cancelJob(j.id).catch(() => undefined);
  },
  applyProjectConfig: async (cfg) => {
    const s = get();
    const schema = s.schema;
    if (!schema) return;
    // A few keys occur in several preset types in vendor bundles; the owner order is print > filament > printer.
    const printSet = new Set(schema.presetKeys.print);
    const filamentSet = new Set(schema.presetKeys.filament);
    const pick = (type: PresetType) => {
      const out: Config = {};
      for (const k of schema.presetKeys[type]) {
        if (cfg[k] === undefined) continue;
        if (type === 'printer' && (printSet.has(k) || filamentSet.has(k))) continue;
        if (type === 'filament' && printSet.has(k)) continue;
        out[k] = cfg[k];
      }
      return out;
    };
    const printerName = cfg.printer_settings_id;
    if (printerName)
      await get()
        .selectPreset('printer', printerName)
        .catch(() => undefined);
    const printName = cfg.print_settings_id;
    if (printName)
      await get()
        .selectPreset('print', printName)
        .catch(() => undefined);
    const filNames = cfg.filament_settings_id
      ? decodeVector((schema.options.filament_settings_id || { type: 'strings' }) as never, cfg.filament_settings_id)
      : [];
    for (let i = 0; i < filNames.length; i++)
      await get()
        .selectPreset('filament', filNames[i], i)
        .catch(() => undefined);
    const printerCfg = pick('printer');
    const printCfg = pick('print');
    const filCfg = pick('filament');
    set((st) => ({
      presets: {
        print: { ...st.presets.print, current: { ...st.presets.print.current, ...printCfg } },
        printer: { ...st.presets.printer, current: { ...st.presets.printer.current, ...printerCfg } },
        filament: st.presets.filament.map((f, i) => {
          const c: Config = { ...f.current };
          for (const [k, v] of Object.entries(filCfg)) {
            const def = schema.options[k];
            if (!def) continue;
            const vals = decodeVector(def, v);
            const mine = vals[Math.min(i, vals.length - 1)];
            if (mine !== undefined)
              c[k] =
                def.type === 'strings'
                  ? mine.match(/[ ;\t\\"\r\n]/) || mine === ''
                    ? `"${mine.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
                    : mine
                  : mine;
          }
          return { ...f, current: c };
        }),
      },
      sliceDirty: true,
    }));
    await get().refreshPresetLists();
  },
  autosaveState: 'idle',
  autosaveNow: async () => {
    const s = get();
    if (!s.objects.length) return;
    const req = s.buildSliceRequest();
    if (!req.objects.length) return;
    set({ autosaveState: 'saving' });
    try {
      const r = await autosaveApi.save(clientId(), req);
      set({ autosaveState: 'saved', autosaveInfo: { savedAt: r.savedAt, size: 0 } });
    } catch {
      set({ autosaveState: 'error' });
    }
  },
  discardAutosave: async () => {
    await autosaveApi.remove(clientId()).catch(() => undefined);
    set({ autosaveInfo: undefined });
  },
});
