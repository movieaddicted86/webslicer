/**
 * The preset slice: the printer/print/filament slots, their lists, and every way a preset is
 * selected, edited, saved, transferred or deleted. The slot helpers live here because this is the
 * only layer that knows what a slot is; the UI slice reuses `loadSelection`/`saveSelection` so the
 * stored selection has exactly one format.
 */
import type { StateCreator } from 'zustand';
import { PRESET_TYPES } from '@webslicer/shared';
import {
  api,
  type Config,
  type InstalledPrinter,
  type Mode,
  type PresetSummary,
  type PresetType,
  type ResolvedPreset,
  type Schema,
} from '../../api';
import { presetDiff, transferChanges } from '../../plater/presetDiff';
import { clampExtruder, clampExtruderSlot, clampObjectExtruders } from '../../plater/extruders';
import { resizeVector, unescapeStringsCstyle } from '../../values';
import type { PendingPresetSwitch, PresetSlot, State } from '../types';

export interface PresetSlice {
  presets: { print: PresetSlot; filament: PresetSlot[]; printer: PresetSlot };
  presetLists: Record<PresetType, PresetSummary[]>;
  refreshPresetLists: () => Promise<void>;
  ensureCompatiblePresets: () => Promise<void>;
  selectPreset: (type: PresetType, name: string, extruderIdx?: number) => Promise<void>;
  /**
   * User-initiated preset switch: asks the "Unsaved Changes" dialog when the current preset is
   * modified, otherwise switches right away. Used by `PresetSelect` only.
   */
  requestPresetSwitch: (type: PresetType, name: string, extruderIdx?: number) => Promise<void>;
  /** "Unsaved Changes" → Transfer: switch to the target, then carry the changes over */
  transferChanges: () => Promise<void>;
  /** "Unsaved Changes" → Save: save the changed preset, then switch to the target */
  savePendingPreset: (name: string) => Promise<void>;
  setOption: (type: PresetType, key: string, value: string, extruderIdx?: number) => void;
  resetOption: (type: PresetType, key: string, extruderIdx?: number) => void;
  discardChanges: (type: PresetType, extruderIdx?: number) => void;
  savePresetAs: (type: PresetType, name: string, extruderIdx?: number) => Promise<void>;
  deletePreset: (type: PresetType, name: string) => Promise<void>;
  setExtruderCount: (n: number) => void;
  extruderCount: () => number;
  installPrinters: (list: InstalledPrinter[]) => Promise<void>;
  refreshPhysicalPrinters: () => Promise<void>;
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined;

function emptySlot(name = ''): PresetSlot {
  return { name, saved: {}, current: {}, system: true };
}

function slotFromPreset(p: ResolvedPreset): PresetSlot {
  return {
    name: p.name,
    saved: { ...p.config },
    current: { ...p.config },
    system: p.system,
    inherits: p.inherits,
    vendorId: p.vendorId,
    printerModel: p.printerModel,
    printerVariant: p.printerVariant,
  };
}

/** Whether the current config differs from the saved one (what "unsaved changes" means). */
export function isModified(slot: PresetSlot): boolean {
  const keys = new Set([...Object.keys(slot.saved), ...Object.keys(slot.current)]);
  for (const k of keys) if ((slot.saved[k] ?? '') !== (slot.current[k] ?? '')) return true;
  return false;
}

/** The preset slot of one type; `undefined` for types the plater does not hold. */
function slotOf(presets: State['presets'], type: PresetType, extruderIdx = 0): PresetSlot | undefined {
  if (type === 'filament') return presets.filament[clampExtruderSlot(extruderIdx, presets.filament.length)];
  if (type === 'print' || type === 'printer') return presets[type];
  return undefined;
}

/**
 * Keys the schema knows for a preset type. Without a schema (or an unknown type) every key is
 * allowed: the dialog needs the schema for its labels, so this is a safety net, not a case in use.
 */
function validPresetKeys(schema: Schema | undefined, type: PresetType): string[] | undefined {
  const keys = schema?.presetKeys[type];
  return keys?.length ? keys : undefined;
}

/** Write a full config into one preset slot, keeping `saved` (that is what makes it "modified"). */
function applySlotConfig(set: (fn: (s: State) => Partial<State>) => void, type: PresetType, extruderIdx: number, config: Config) {
  set((s) => {
    const presets = { ...s.presets };
    if (type === 'filament') {
      const fil = [...presets.filament];
      const i = clampExtruderSlot(extruderIdx, fil.length);
      fil[i] = { ...fil[i], current: config };
      presets.filament = fil;
    } else if (type === 'print' || type === 'printer') {
      presets[type] = { ...presets[type], current: config };
    }
    return { presets, sliceDirty: true };
  });
}

/**
 * B2: everything that remembers an extruder index follows the extruder count. Shrinking the count –
 * by `setExtruderCount` or by switching to a printer with fewer extruders – leaves objects, volumes,
 * MMU paint and the paint tool pointing past the end; the next `filament[i]` read is a TypeError and
 * the slice request would carry an extruder the printer does not have.
 */
function extruderClampPatch(s: State, n: number): Pick<State, 'objects' | 'paintExtruder'> {
  return { objects: clampObjectExtruders(s.objects, n), paintExtruder: clampExtruder(s.paintExtruder, n) || 1 };
}

/** The filament slots resized to `n`, new slots copying the last one like PrusaSlicer does. */
function resizedFilaments(filament: PresetSlot[], n: number): PresetSlot[] {
  const fil = [...filament];
  while (fil.length < n) fil.push({ ...fil[fil.length - 1] });
  fil.length = n;
  return fil;
}

const LS_KEY = 'webslicer.selection';

/** The preset selection and mode the browser remembered, as stored by `saveSelection`. */
export function loadSelection(): { print?: string; filament?: string[]; printer?: string; mode?: Mode } {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}');
  } catch {
    return {};
  }
}

export function saveSelection(s: State) {
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        print: s.presets.print.name,
        filament: s.presets.filament.map((f) => f.name),
        printer: s.presets.printer.name,
        mode: s.mode,
      }),
    );
  } catch {
    /* ignore */
  }
}

export const createPresetSlice: StateCreator<State, [], [], PresetSlice> = (set, get) => ({
  presets: { print: emptySlot(), filament: [emptySlot()], printer: emptySlot() },
  // W4: the one preset-type list (shared) – the four copies could drift apart
  presetLists: Object.fromEntries(PRESET_TYPES.map((t) => [t, [] as PresetSummary[]])) as Record<PresetType, PresetSummary[]>,
  refreshPresetLists: async () => {
    const s = get();
    const printerName = s.presets.printer.name;
    const printerConfig = s.presets.printer.current;
    const printName = s.presets.print.name;
    const printConfig = s.presets.print.current;
    const [print, filament, printer] = await Promise.all([
      api.listPresets('print', { printerName, printerConfig }),
      api.listPresets('filament', { printerName, printerConfig, printName, printConfig }),
      api.listPresets('printer', {}),
    ]);
    set((st) => ({ presetLists: { ...st.presetLists, print, filament, printer } }));
  },
  requestPresetSwitch: async (type, name, extruderIdx = 0) => {
    const s = get();
    const slot = slotOf(s.presets, type, extruderIdx);
    const pending: PendingPresetSwitch | undefined =
      slot && isModified(slot) && name !== slot.name
        ? { type, extruderIdx, target: name, source: { ...slot, saved: { ...slot.saved }, current: { ...slot.current } } }
        : undefined;
    if (pending) {
      const changes = presetDiff(pending.source.saved, pending.source.current);
      if (changes.length) {
        set({ pendingSwitch: pending, dialog: 'unsavedChanges', dialogPayload: pending });
        return;
      }
    }
    await get().selectPreset(type, name, extruderIdx);
  },
  transferChanges: async () => {
    const pending = get().pendingSwitch;
    set({ pendingSwitch: undefined, dialog: undefined, dialogPayload: undefined });
    if (!pending) return;
    await get().selectPreset(pending.type, pending.target, pending.extruderIdx);
    const valid = validPresetKeys(get().schema, pending.type);
    const newSaved = slotOf(get().presets, pending.type, pending.extruderIdx)?.saved || {};
    const changes = presetDiff(pending.source.saved, pending.source.current);
    const current = transferChanges(newSaved, pending.source.saved, pending.source.current, valid ?? changes.map((c) => c.key));
    applySlotConfig(set, pending.type, pending.extruderIdx, current);
  },
  savePendingPreset: async (name) => {
    const pending = get().pendingSwitch;
    if (!pending) return;
    // save the *changed* preset under the new name, then switch to the target
    const inherits = pending.source.inherits;
    await api.savePreset(pending.type, name, pending.source.current, inherits);
    await get().refreshPresetLists();
    set({ pendingSwitch: undefined, dialog: undefined, dialogPayload: undefined });
    await get().selectPreset(pending.type, pending.target, pending.extruderIdx);
    get().toast('success', `Saved ${pending.type} preset "${name}"`);
  },
  selectPreset: async (type, name, extruderIdx = 0) => {
    const p = await api.getPreset(type, name);
    const slot = slotFromPreset(p);
    const st = get();
    if (type === 'printer') {
      set({ presets: { ...st.presets, printer: slot }, sliceDirty: true });
      // resize filament slots to the new extruder count, and clamp everything that remembers an
      // extruder index exactly like `setExtruderCount` does (B2: a 5 → 1 switch left indices at 5)
      const n = get().extruderCount();
      set((s) => ({ presets: { ...s.presets, filament: resizedFilaments(s.presets.filament, n) }, ...extruderClampPatch(s, n) }));
      await get().ensureCompatiblePresets();
    } else if (type === 'filament') {
      const fil = [...st.presets.filament];
      fil[clampExtruderSlot(extruderIdx, fil.length)] = slot;
      set({ presets: { ...st.presets, filament: fil }, sliceDirty: true });
    } else if (type === 'print') {
      set({ presets: { ...st.presets, print: slot }, sliceDirty: true });
      await get().refreshPresetLists();
    }
    saveSelection(get());
  },
  /**
   * After a printer change (or on startup): make sure print and filament presets are compatible
   * with the printer; otherwise pick the printer's default profiles like PrusaSlicer does.
   */
  ensureCompatiblePresets: async () => {
    await get().refreshPresetLists();
    const printer = get().presets.printer;
    const n = get().extruderCount();
    const lists = get().presetLists;
    const curPrint = get().presets.print.name;
    const isDefault = (name: string) => name.startsWith('- default');
    const printOk = curPrint && !isDefault(curPrint) && lists.print.find((x) => x.name === curPrint)?.compatible !== false;
    if (!printOk) {
      const wanted = printer.current.default_print_profile;
      const preferred = wanted ? lists.print.find((x) => x.name === wanted && x.compatible !== false) : undefined;
      const first = preferred || lists.print.find((x) => x.compatible !== false && !isDefault(x.name));
      if (first && first.name !== curPrint) await get().selectPreset('print', first.name);
      else if (!first && curPrint !== '- default FFF -') await get().selectPreset('print', '- default FFF -');
    }
    const model = get()
      .vendors.flatMap((v) => v.models)
      .find((m) => m.vendorId === printer.vendorId && m.id === printer.printerModel);
    const defaultFilaments = printer.current.default_filament_profile
      ? unescapeStringsCstyle(printer.current.default_filament_profile)
      : [];
    for (let i = 0; i < n; i++) {
      const cur = get().presets.filament[i]?.name;
      const fl = get().presetLists.filament;
      const ok = cur && !isDefault(cur) && fl.find((x) => x.name === cur)?.compatible !== false;
      if (ok) continue;
      const candidates = [...defaultFilaments, ...(model?.defaultMaterials || [])];
      const preferred = candidates.map((d) => fl.find((x) => x.name === d && x.compatible !== false)).find(Boolean);
      const first = preferred || fl.find((x) => x.compatible !== false && !isDefault(x.name));
      if (first && first.name !== cur) await get().selectPreset('filament', first.name, i);
      else if (!first && cur !== '- default FFF -') await get().selectPreset('filament', '- default FFF -', i);
    }
  },
  setOption: (type, key, value, extruderIdx = 0) => {
    // Printer changes (nozzle, notes, bed…) influence which print/filament presets are compatible.
    if (type === 'printer' || type === 'print') {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(
        () =>
          get()
            .refreshPresetLists()
            .catch(() => undefined),
        600,
      );
    }
    set((s) => {
      const presets = { ...s.presets };
      if (type === 'filament') {
        const i = clampExtruderSlot(extruderIdx, presets.filament.length);
        const fil = [...presets.filament];
        fil[i] = { ...fil[i], current: { ...fil[i].current, [key]: value } };
        presets.filament = fil;
      } else if (type === 'print' || type === 'printer') {
        presets[type] = { ...presets[type], current: { ...presets[type].current, [key]: value } };
      }
      return { presets, sliceDirty: true };
    });
  },
  resetOption: (type, key, extruderIdx = 0) => {
    const slot = slotOf(get().presets, type, extruderIdx);
    if (!slot) return;
    get().setOption(type, key, slot.saved[key] ?? '', extruderIdx);
  },
  discardChanges: (type, extruderIdx = 0) => {
    set((s) => {
      const presets = { ...s.presets };
      if (type === 'filament') {
        const i = clampExtruderSlot(extruderIdx, presets.filament.length);
        const fil = [...presets.filament];
        fil[i] = { ...fil[i], current: { ...fil[i].saved } };
        presets.filament = fil;
      } else if (type === 'print' || type === 'printer') {
        presets[type] = { ...presets[type], current: { ...presets[type].saved } };
      }
      return { presets, sliceDirty: true };
    });
  },
  savePresetAs: async (type, name, extruderIdx = 0) => {
    const s = get();
    const slot = slotOf(s.presets, type, extruderIdx);
    if (!slot) return;
    // the slot index is clamped as well: saving from a removed filament slot lands on the last one
    const idx = type === 'filament' ? clampExtruderSlot(extruderIdx, s.presets.filament.length) : 0;
    const inherits = slot.system && !slot.name.startsWith('- default') ? slot.name : slot.inherits;
    await api.savePreset(type, name, slot.current, inherits);
    await get().refreshPresetLists();
    await get().selectPreset(type, name, idx);
    get().toast('success', `Saved ${type} preset "${name}"`);
  },
  deletePreset: async (type, name) => {
    await api.deletePreset(type, name);
    await get().refreshPresetLists();
    const s = get();
    let changed = false;
    if (type === 'print' && s.presets.print.name === name) {
      await get().selectPreset('print', '- default FFF -');
      changed = true;
    }
    if (type === 'printer' && s.presets.printer.name === name) {
      await get().selectPreset('printer', '- default FFF -');
      changed = true;
    }
    if (type === 'filament') {
      for (let i = 0; i < s.presets.filament.length; i++) {
        if (s.presets.filament[i].name === name) {
          await get().selectPreset('filament', '- default FFF -', i);
          changed = true;
        }
      }
    }
    // fall back to the printer's compatible vendor presets instead of the bare defaults
    if (changed) await get().ensureCompatiblePresets();
    get().toast('info', `Deleted ${type} preset "${name}"`);
  },
  extruderCount: () => {
    const nd = get().presets.printer.current.nozzle_diameter || '0.4';
    return Math.max(1, nd.split(',').length);
  },
  setExtruderCount: (n) => {
    const s = get();
    const schema = s.schema;
    if (!schema) return;
    n = Math.max(1, Math.min(16, Math.floor(n)));
    const cur = { ...s.presets.printer.current };
    for (const key of schema.presetKeys.printer) {
      const def = schema.options[key];
      if (def?.perExtruder) cur[key] = resizeVector(def, cur[key], n);
    }
    // B2: objects, volumes, MMU paint and the paint tool may still point at a removed extruder;
    // without this the next `filament[i]` read is a TypeError (and the value is unselectable anyway)
    set({
      presets: { ...s.presets, printer: { ...s.presets.printer, current: cur }, filament: resizedFilaments(s.presets.filament, n) },
      ...extruderClampPatch(s, n),
      sliceDirty: true,
    });
  },
  installPrinters: async (list) => {
    const installed = await api.setInstalledPrinters(list);
    set({ installed });
    await get().refreshPresetLists();
  },
  refreshPhysicalPrinters: async () => {
    set({ physicalPrinters: await api.printers() });
  },
});
