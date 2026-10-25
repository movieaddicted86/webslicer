/**
 * The job slice: the slice request built from the plater and the presets, the running job and its
 * log, and the server-side autosave of the plater.
 */
import type { StateCreator } from 'zustand';
import { api, autosaveApi, type Config, type PresetType, type SliceRequest } from '../../api';
import { encodeMmu, encodePaint } from '../../plater/paintCodec';
import { hasThumbnailRenderer, renderThumbnails } from '../thumbnailRenderer';
import { decodeVector } from '../../values';
import { parseThumbnailSpec, placementMatrix } from '@webslicer/shared';
import { clientId } from '../client';
import { clearCachedRequest, clearPendingFlush, markPendingFlush, writeCachedRequest } from '../sessionCache';
import { currentSliceGuard } from '../sliceGuard';
import type { PlaterObject, PlaterVolume, State } from '../types';

/** Keepalive requests share a 64 KiB budget per page; past it the flush goes to the local cache. */
const KEEPALIVE_LIMIT = 60 * 1024;

export interface JobSlice {
  jobLog: string[];
  sliceDirty: boolean;
  binaryGcode: boolean;
  buildSliceRequest: () => SliceRequest;
  slice: () => Promise<void>;
  cancelSlice: () => Promise<void>;
  applyProjectConfig: (cfg: Config) => Promise<void>;
  autosaveState: 'idle' | 'saving' | 'saved' | 'error';
  /** Write the plater to the server autosave; `keepalive` keeps the request alive while the page goes away. */
  autosaveNow: (opts?: { keepalive?: boolean }) => Promise<boolean>;
  discardAutosave: () => Promise<void>;
}

export const createJobSlice: StateCreator<State, [], [], JobSlice> = (set, get) => {
  /**
   * B9: the closed EventSource of the job currently watched. Starting the next slice closed the
   * stream only on a terminal event, so a second slice left the first one connected.
   */
  let stopJobEvents: (() => void) | undefined;
  /** B9: when the current wait for missing model uploads started; `undefined` when nothing waits. */
  let uploadWaitSince: number | undefined;
  /** How long a slice waits for pending model uploads before it gives up instead of looping forever. */
  const UPLOAD_WAIT_MS = 60_000;
  return {
    jobLog: [],
    sliceDirty: true,
    binaryGcode: false,
    buildSliceRequest: () => {
      const s = get();
      const n = s.extruderCount();
      const filaments = s.presets.filament.slice(0, n).map((f) => ({ name: f.name, config: f.current }));
      const objects = s.objects
        .filter((o): o is PlaterObject & { modelId: string } => o.visible && !!o.modelId)
        .map((o) => ({
          modelId: o.modelId,
          name: o.name,
          transform: placementMatrix(o.instances[0]),
          instances: o.instances.length > 1 ? o.instances.map((i) => placementMatrix(i)) : undefined,
          config: Object.keys(o.config).length ? o.config : undefined,
          extruder: o.extruder || undefined,
          supportPaint: o.paint?.supports && o.paint.supports.some((x) => x) ? encodePaint(o.paint.supports) : undefined,
          seamPaint: o.paint?.seam && o.paint.seam.some((x) => x) ? encodePaint(o.paint.seam) : undefined,
          mmuPaint: o.paint?.mmu && o.paint.mmu.some((x) => x) ? encodeMmu(o.paint.mmu) : undefined,
          ranges: o.ranges.filter((r) => r.maxZ > r.minZ).map((r) => ({ minZ: r.minZ, maxZ: r.maxZ, config: r.config })),
          layerProfile: o.layerProfile?.length ? o.layerProfile : undefined,
          volumes: o.volumes
            .filter((v): v is PlaterVolume & { modelId: string } => !!v.modelId)
            .map((v) => ({
              modelId: v.modelId,
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
      // The plate and limit checks gate **every** path into a slice (the Prepare footer, the Preview's
      // button, the re-slice after a colour change, scripted callers): one seam, so no path can skip a
      // check the panel would have shown.
      const guard = currentSliceGuard(s);
      if (guard.blocking.length) {
        get().toast('error', guard.blocking[0].message);
        return;
      }
      const pending = s.objects.filter((o) => (!o.modelId && !o.uploadError) || o.volumes.some((v) => !v.modelId && !v.uploadError));
      if (pending.length) {
        // B9: this used to re-enter itself every second, forever, if an upload never finished. It now
        // waits against a deadline and ends with a clear error instead of an endless toast loop.
        const since = uploadWaitSince ?? Date.now();
        uploadWaitSince = since;
        if (Date.now() - since > UPLOAD_WAIT_MS) {
          uploadWaitSince = undefined;
          get().toast('error', 'Model upload did not finish – check the connection and try again');
          return;
        }
        get().toast('info', 'Waiting for model upload…');
        await new Promise((r) => setTimeout(r, 1000));
        return get().slice();
      }
      uploadWaitSince = undefined;
      const req = get().buildSliceRequest();
      if (!req.objects.length) {
        get().toast('error', 'No sliceable objects (upload failed?)');
        return;
      }
      // Previews for the printer display / print host (the slicer CLI cannot render them).
      if (!s.binaryGcode && hasThumbnailRenderer()) {
        const pc = s.presets.printer.current;
        const specs = parseThumbnailSpec(pc.thumbnails, pc.thumbnails_format);
        if (specs.length) {
          try {
            const colDef = s.schema?.options.filament_colour;
            const colors = s.presets.filament.map(
              (f) => (colDef ? decodeVector(colDef, f.current.filament_colour)[0] : f.current.filament_colour) || '',
            );
            req.thumbnails = renderThumbnails(specs, colors);
          } catch (e) {
            console.warn('thumbnail rendering failed', e);
          }
        }
      }
      try {
        const job = await api.slice(req);
        set({ job, jobLog: [], sliceDirty: false });
        get().setView('preview');
        // B9: the previous job's stream stays open only until the terminal event; a new slice has to
        // close it explicitly, or every slice leaves one EventSource behind
        stopJobEvents?.();
        stopJobEvents = api.jobEvents(job.id, (ev) => {
          const line = ev.line;
          if (ev.type === 'log' && line) set((st) => ({ jobLog: [...st.jobLog.slice(-400), line] }));
          if (ev.type === 'progress')
            set((st) =>
              st.job ? { job: { ...st.job, percent: ev.percent ?? st.job.percent, message: ev.message ?? st.job.message } } : {},
            );
          if (ev.type === 'status' && ev.job?.status === 'cancelled') {
            // the single cancel toast (B6): the server reports the cancelled status, and the SSE stream
            // used to answer an aborted job with a generic "Slicing failed" error event
            set({ job: ev.job });
            get().toast('info', 'Slicing cancelled');
            return;
          }
          if (ev.job) set({ job: ev.job });
          if (ev.type === 'done' && ev.job) {
            get().toast('success', `Slicing finished: ${ev.job.outputName}`);
            if (ev.job.outputName.endsWith('.gcode'))
              get()
                .loadGcodePreview(ev.job.id)
                .catch((e) => get().toast('error', e.message));
          }
          // a cancelled job that arrives as an error event (an older server, or a race) is not a failure
          if (ev.type === 'error' && ev.job?.status !== 'cancelled')
            get().toast('error', `Slicing failed: ${ev.message || 'unknown error'}`);
        });
      } catch (e) {
        get().toast('error', `Slice request failed: ${(e as Error).message}`);
      }
    },
    cancelSlice: async () => {
      const j = get().job;
      if (!j) return;
      try {
        await api.cancelJob(j.id);
      } catch (e) {
        // a cancel that arrives too late (the job already finished) is not an error worth a toast of its
        // own; the job's own event says how it ended
        if (!get().job || get().job?.id !== j.id) return;
        get().toast('error', `Cancel failed: ${(e as Error).message}`);
      }
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
    autosaveNow: async (opts = {}) => {
      const s = get();
      if (!s.objects.length) return false;
      const req = s.buildSliceRequest();
      if (!req.objects.length) return false;
      // A keepalive request dies with the page, and browsers cap the total keepalive body at 64 KiB.
      // A plater past that (paint strings are long) is written to the local cache instead and replayed
      // on the next start, which is still faster than losing it.
      // N8c: the limit is in bytes, not characters – a name with umlauts is twice as many bytes as
      // characters. And the marker goes first: the page may go away during the cache write, and a
      // start that sees no marker would read a file one flush behind.
      const body = JSON.stringify(req);
      const tooLarge = opts.keepalive && new TextEncoder().encode(body).length > KEEPALIVE_LIMIT;
      if (opts.keepalive) markPendingFlush(Date.now());
      if (tooLarge) {
        await writeCachedRequest(Date.now(), req);
        return false;
      }
      set({ autosaveState: 'saving' });
      try {
        await autosaveApi.save(clientId(), req, !!opts.keepalive);
        set({ autosaveState: 'saved', autosaveError: undefined });
        await clearCachedRequest();
        clearPendingFlush();
        return true;
      } catch {
        set({ autosaveState: 'error' });
        return false;
      }
    },
    discardAutosave: async () => {
      await autosaveApi.remove(clientId()).catch(() => undefined);
      await clearCachedRequest();
      clearPendingFlush();
      set({ autosaveError: undefined });
    },
  };
};
