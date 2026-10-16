import { create } from 'zustand';
import * as THREE from 'three';
import {
  api,
  type Config,
  type InstalledPrinter,
  type JobRecord,
  type Mode,
  type PhysicalPrinter,
  type PresetSummary,
  type PresetType,
  type ResolvedPreset,
  type Schema,
  type ServerInfo,
  type SliceRequest,
  type Vendor,
} from '../api';
import { decodeVector, resizeVector, toBool, unescapeStringsCstyle } from '../values';
import type { ParsedGcode } from '../gcode/types';

export interface PlaterObject {
  id: string;
  name: string;
  geometry: THREE.BufferGeometry;
  modelId?: string;
  uploadError?: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  /** base size (unscaled bounding box) */
  size: [number, number, number];
  config: Config;
  extruder: number;
  visible: boolean;
  triangles: number;
}

export interface PresetSlot {
  name: string;
  /** full saved config of the preset */
  saved: Config;
  /** current (possibly modified) config */
  current: Config;
  system: boolean;
  inherits?: string;
  vendorId?: string;
  printerModel?: string;
  printerVariant?: string;
}

export type View = 'plater' | 'preview' | 'print' | 'filament' | 'printer';

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  text: string;
}

interface State {
  ready: boolean;
  fatal?: string;
  info?: ServerInfo;
  schema?: Schema;
  vendors: Vendor[];
  installed: InstalledPrinter[];
  physicalPrinters: PhysicalPrinter[];
  mode: Mode;
  view: View;
  showIncompatible: boolean;

  presets: { print: PresetSlot; filament: PresetSlot[]; printer: PresetSlot };
  presetLists: Record<PresetType, PresetSummary[]>;

  objects: PlaterObject[];
  selectedIds: string[];
  transformMode: 'translate' | 'rotate' | 'scale';

  job?: JobRecord;
  jobLog: string[];
  sliceDirty: boolean;
  binaryGcode: boolean;
  gcodeLoading: boolean;
  gcode?: ParsedGcode;
  gcodeJobId?: string;
  previewLayerRange: [number, number];
  previewShowTravel: boolean;
  previewFeatureVisibility: Record<string, boolean>;

  toasts: Toast[];
  dialog?: 'addPrinter' | 'physicalPrinters' | 'objectSettings' | 'sendToPrinter' | 'savePreset' | 'about';
  dialogPayload?: unknown;

  // actions
  init: () => Promise<void>;
  toast: (kind: Toast['kind'], text: string) => void;
  dismissToast: (id: number) => void;
  setView: (v: View) => void;
  setMode: (m: Mode) => void;
  openDialog: (d: State['dialog'], payload?: unknown) => void;
  closeDialog: () => void;

  refreshPresetLists: () => Promise<void>;
  ensureCompatiblePresets: () => Promise<void>;
  selectPreset: (type: PresetType, name: string, extruderIdx?: number) => Promise<void>;
  setOption: (type: PresetType, key: string, value: string, extruderIdx?: number) => void;
  resetOption: (type: PresetType, key: string, extruderIdx?: number) => void;
  discardChanges: (type: PresetType, extruderIdx?: number) => void;
  savePresetAs: (type: PresetType, name: string, extruderIdx?: number) => Promise<void>;
  deletePreset: (type: PresetType, name: string) => Promise<void>;
  setExtruderCount: (n: number) => void;
  extruderCount: () => number;
  installPrinters: (list: InstalledPrinter[]) => Promise<void>;
  refreshPhysicalPrinters: () => Promise<void>;

  addObjects: (items: Array<{ name: string; geometry: THREE.BufferGeometry }>, opts?: { keepPositions?: boolean }) => Promise<void>;
  updateObject: (id: string, patch: Partial<PlaterObject>) => void;
  removeObjects: (ids: string[]) => void;
  clearObjects: () => void;
  duplicateObjects: (ids: string[]) => Promise<void>;
  select: (ids: string[], additive?: boolean) => void;
  setTransformMode: (m: State['transformMode']) => void;
  arrange: () => void;
  dropToBed: (id: string) => void;

  buildSliceRequest: () => SliceRequest;
  slice: () => Promise<void>;
  cancelSlice: () => Promise<void>;
  loadGcodePreview: (jobId: string) => Promise<void>;
  setPreviewLayerRange: (r: [number, number]) => void;
  setPreviewShowTravel: (b: boolean) => void;
  togglePreviewFeature: (f: string) => void;
  applyProjectConfig: (cfg: Config) => Promise<void>;
}

let toastId = 0;
let objectId = 0;
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

export function isModified(slot: PresetSlot): boolean {
  const keys = new Set([...Object.keys(slot.saved), ...Object.keys(slot.current)]);
  for (const k of keys) if ((slot.saved[k] ?? '') !== (slot.current[k] ?? '')) return true;
  return false;
}

const LS_KEY = 'webslicer.selection';

function loadSelection(): { print?: string; filament?: string[]; printer?: string; mode?: Mode } {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveSelection(s: State) {
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({ print: s.presets.print.name, filament: s.presets.filament.map((f) => f.name), printer: s.presets.printer.name, mode: s.mode }),
    );
  } catch {
    /* ignore */
  }
}

export function objectMatrix(o: PlaterObject): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rotation[0], o.rotation[1], o.rotation[2], 'XYZ'));
  m.compose(new THREE.Vector3(...o.position), q, new THREE.Vector3(...o.scale));
  return m;
}

export function objectBounds(o: PlaterObject): THREE.Box3 {
  const box = new THREE.Box3();
  if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
  box.copy(o.geometry.boundingBox!).applyMatrix4(objectMatrix(o));
  return box;
}

/** Export a BufferGeometry as binary STL */
export function geometryToStl(geometry: THREE.BufferGeometry): ArrayBuffer {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const index = geometry.getIndex();
  const triCount = index ? index.count / 3 : pos.count / 3;
  const buf = new ArrayBuffer(84 + triCount * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, triCount, true);
  let o = 84;
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3(),
    n = new THREE.Vector3();
  for (let i = 0; i < triCount; i++) {
    const ia = index ? index.getX(i * 3) : i * 3;
    const ib = index ? index.getX(i * 3 + 1) : i * 3 + 1;
    const ic = index ? index.getX(i * 3 + 2) : i * 3 + 2;
    a.fromBufferAttribute(pos, ia);
    b.fromBufferAttribute(pos, ib);
    c.fromBufferAttribute(pos, ic);
    n.copy(b).sub(a).cross(c.clone().sub(a)).normalize();
    dv.setFloat32(o, n.x, true);
    dv.setFloat32(o + 4, n.y, true);
    dv.setFloat32(o + 8, n.z, true);
    o += 12;
    for (const v of [a, b, c]) {
      dv.setFloat32(o, v.x, true);
      dv.setFloat32(o + 4, v.y, true);
      dv.setFloat32(o + 8, v.z, true);
      o += 12;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return buf;
}

export function bedShapeOf(printerCfg: Config): { min: [number, number]; max: [number, number]; points: Array<[number, number]> } {
  const pts = (printerCfg.bed_shape || '0x0,200x0,200x200,0x200')
    .split(',')
    .map((p) => p.split('x').map(Number) as [number, number])
    .filter((p) => p.length === 2 && !p.some((n) => Number.isNaN(n)));
  if (!pts.length) pts.push([0, 0], [200, 0], [200, 200], [0, 200]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)], points: pts };
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  vendors: [],
  installed: [],
  physicalPrinters: [],
  mode: 'advanced',
  view: 'plater',
  showIncompatible: false,
  presets: { print: emptySlot(), filament: [emptySlot()], printer: emptySlot() },
  presetLists: { print: [], filament: [], printer: [], sla_print: [], sla_material: [] },
  objects: [],
  selectedIds: [],
  transformMode: 'translate',
  jobLog: [],
  sliceDirty: true,
  binaryGcode: false,
  gcodeLoading: false,
  previewLayerRange: [0, 0],
  previewShowTravel: false,
  previewFeatureVisibility: {},
  toasts: [],

  toast: (kind, text) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 9000 : 4500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setView: (view) => set({ view }),
  setMode: (mode) => {
    set({ mode });
    saveSelection(get());
  },
  openDialog: (dialog, dialogPayload) => set({ dialog, dialogPayload }),
  closeDialog: () => set({ dialog: undefined, dialogPayload: undefined }),

  init: async () => {
    try {
      const [info, schema, vendors, installed, physicalPrinters] = await Promise.all([
        api.info(),
        api.schema(),
        api.vendors(),
        api.installedPrinters(),
        api.printers().catch(() => []),
      ]);
      const sel = loadSelection();
      set({ info, schema, vendors, installed, physicalPrinters, mode: sel.mode || 'advanced' });
      // restore selection
      const printerName = sel.printer || '- default FFF -';
      await get().selectPreset('printer', printerName).catch(() => get().selectPreset('printer', '- default FFF -'));
      // Restore explicit choices; a stored "- default -" entry is replaced by the printer's vendor default picked above.
      if (sel.print && !sel.print.startsWith('- default')) await get().selectPreset('print', sel.print).catch(() => undefined);
      if (sel.filament?.length) {
        for (let i = 0; i < sel.filament.length; i++) {
          if (!sel.filament[i].startsWith('- default')) await get().selectPreset('filament', sel.filament[i], i).catch(() => undefined);
        }
      }
      await get().ensureCompatiblePresets();
      set({ ready: true });
      if (!installed.length) get().openDialog('addPrinter');
    } catch (e) {
      set({ fatal: (e as Error).message });
    }
  },

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

  selectPreset: async (type, name, extruderIdx = 0) => {
    const p = await api.getPreset(type, name);
    const slot = slotFromPreset(p);
    const st = get();
    if (type === 'printer') {
      set({ presets: { ...st.presets, printer: slot }, sliceDirty: true });
      // resize filament slots to extruder count
      const n = get().extruderCount();
      const fil = [...get().presets.filament];
      while (fil.length < n) fil.push({ ...fil[fil.length - 1] });
      fil.length = n;
      set((s) => ({ presets: { ...s.presets, filament: fil } }));
      await get().ensureCompatiblePresets();
    } else if (type === 'filament') {
      const fil = [...st.presets.filament];
      fil[extruderIdx] = slot;
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
      else if (!curPrint) await get().selectPreset('print', '- default FFF -');
    }
    const model = get().vendors.flatMap((v) => v.models).find((m) => m.vendorId === printer.vendorId && m.id === printer.printerModel);
    const defaultFilaments = printer.current.default_filament_profile ? unescapeStringsCstyle(printer.current.default_filament_profile) : [];
    for (let i = 0; i < n; i++) {
      const cur = get().presets.filament[i]?.name;
      const fl = get().presetLists.filament;
      const ok = cur && !isDefault(cur) && fl.find((x) => x.name === cur)?.compatible !== false;
      if (ok) continue;
      const candidates = [...defaultFilaments, ...(model?.defaultMaterials || [])];
      const preferred = candidates.map((d) => fl.find((x) => x.name === d && x.compatible !== false)).find(Boolean);
      const first = preferred || fl.find((x) => x.compatible !== false && !isDefault(x.name));
      if (first && first.name !== cur) await get().selectPreset('filament', first.name, i);
      else if (!cur) await get().selectPreset('filament', '- default FFF -', i);
    }
  },

  setOption: (type, key, value, extruderIdx = 0) => {
    // Printer changes (nozzle, notes, bed…) influence which print/filament presets are compatible.
    if (type === 'printer' || type === 'print') {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => get().refreshPresetLists().catch(() => undefined), 600);
    }
    set((s) => {
      const presets = { ...s.presets };
      if (type === 'filament') {
        const fil = [...presets.filament];
        fil[extruderIdx] = { ...fil[extruderIdx], current: { ...fil[extruderIdx].current, [key]: value } };
        presets.filament = fil;
      } else if (type === 'print' || type === 'printer') {
        presets[type] = { ...presets[type], current: { ...presets[type].current, [key]: value } };
      }
      return { presets, sliceDirty: true };
    });
  },

  resetOption: (type, key, extruderIdx = 0) => {
    const s = get();
    const slot = type === 'filament' ? s.presets.filament[extruderIdx] : type === 'print' || type === 'printer' ? s.presets[type] : undefined;
    if (!slot) return;
    get().setOption(type, key, slot.saved[key] ?? '', extruderIdx);
  },

  discardChanges: (type, extruderIdx = 0) => {
    set((s) => {
      const presets = { ...s.presets };
      if (type === 'filament') {
        const fil = [...presets.filament];
        fil[extruderIdx] = { ...fil[extruderIdx], current: { ...fil[extruderIdx].saved } };
        presets.filament = fil;
      } else if (type === 'print' || type === 'printer') {
        presets[type] = { ...presets[type], current: { ...presets[type].saved } };
      }
      return { presets, sliceDirty: true };
    });
  },

  savePresetAs: async (type, name, extruderIdx = 0) => {
    const s = get();
    const slot = type === 'filament' ? s.presets.filament[extruderIdx] : type === 'print' || type === 'printer' ? s.presets[type] : undefined;
    if (!slot) return;
    const inherits = slot.system && !slot.name.startsWith('- default') ? slot.name : slot.inherits;
    await api.savePreset(type, name, slot.current, inherits);
    await get().refreshPresetLists();
    await get().selectPreset(type, name, extruderIdx);
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
    const fil = [...s.presets.filament];
    while (fil.length < n) fil.push({ ...fil[fil.length - 1] });
    fil.length = n;
    set({ presets: { ...s.presets, printer: { ...s.presets.printer, current: cur }, filament: fil }, sliceDirty: true });
  },

  installPrinters: async (list) => {
    const installed = await api.setInstalledPrinters(list);
    set({ installed });
    await get().refreshPresetLists();
  },

  refreshPhysicalPrinters: async () => {
    set({ physicalPrinters: await api.printers() });
  },

  addObjects: async (items, opts = {}) => {
    const s = get();
    const bed = bedShapeOf(s.presets.printer.current);
    const created: PlaterObject[] = [];
    for (const it of items) {
      const g = it.geometry;
      g.computeBoundingBox();
      const bb = g.boundingBox!;
      // normalize: center XY at origin, min Z at 0
      const cx = (bb.min.x + bb.max.x) / 2;
      const cy = (bb.min.y + bb.max.y) / 2;
      g.translate(-cx, -cy, -bb.min.z);
      g.computeBoundingBox();
      g.computeVertexNormals();
      const size: [number, number, number] = [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z];
      const pos = g.getAttribute('position');
      const tri = g.getIndex() ? g.getIndex()!.count / 3 : pos.count / 3;
      const id = `obj-${++objectId}`;
      created.push({
        id,
        name: it.name,
        geometry: g,
        position: opts.keepPositions ? [cx, cy, 0] : [(bed.min[0] + bed.max[0]) / 2, (bed.min[1] + bed.max[1]) / 2, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        size,
        config: {},
        extruder: 0,
        visible: true,
        triangles: tri,
      });
    }
    set((st) => ({ objects: [...st.objects, ...created], selectedIds: created.map((c) => c.id), sliceDirty: true }));
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
    }
  },

  updateObject: (id, patch) =>
    set((s) => ({ objects: s.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)), sliceDirty: true })),

  removeObjects: (ids) =>
    set((s) => ({
      objects: s.objects.filter((o) => !ids.includes(o.id)),
      selectedIds: s.selectedIds.filter((i) => !ids.includes(i)),
      sliceDirty: true,
    })),

  clearObjects: () => set({ objects: [], selectedIds: [], sliceDirty: true, gcode: undefined, gcodeJobId: undefined }),

  duplicateObjects: async (ids) => {
    const s = get();
    const items = s.objects.filter((o) => ids.includes(o.id));
    const created: PlaterObject[] = items.map((o) => ({
      ...o,
      id: `obj-${++objectId}`,
      position: [o.position[0] + 10, o.position[1] + 10, o.position[2]],
      config: { ...o.config },
    }));
    set((st) => ({ objects: [...st.objects, ...created], selectedIds: created.map((c) => c.id), sliceDirty: true }));
    get().arrange();
  },

  select: (ids, additive = false) =>
    set((s) => ({ selectedIds: additive ? Array.from(new Set([...s.selectedIds, ...ids])) : ids })),

  setTransformMode: (transformMode) => set({ transformMode }),

  dropToBed: (id) => {
    const o = get().objects.find((x) => x.id === id);
    if (!o) return;
    const box = objectBounds(o);
    if (Math.abs(box.min.z) > 1e-6) get().updateObject(id, { position: [o.position[0], o.position[1], o.position[2] - box.min.z] });
  },

  arrange: () => {
    const s = get();
    const bed = bedShapeOf(s.presets.printer.current);
    const spacing = Number(s.presets.print.current.extruder_clearance_radius) > 0 && toBool(s.presets.print.current.complete_objects) ? Number(s.presets.print.current.extruder_clearance_radius) : 6;
    const items = s.objects.map((o) => {
      const box = objectBounds(o);
      return { o, w: box.max.x - box.min.x + spacing, h: box.max.y - box.min.y + spacing, box };
    });
    // Shelf packing, largest first
    items.sort((a, b) => b.w * b.h - a.w * a.h);
    const bedW = bed.max[0] - bed.min[0];
    const bedH = bed.max[1] - bed.min[1];
    const rows: Array<{ y: number; h: number; x: number; items: typeof items }> = [];
    for (const it of items) {
      let row = rows.find((r) => r.x + it.w <= bedW && it.h <= r.h * 1.5);
      if (!row) {
        const y = rows.reduce((acc, r) => acc + r.h, 0);
        row = { y, h: it.h, x: 0, items: [] };
        rows.push(row);
      }
      row.items.push(it);
      row.h = Math.max(row.h, it.h);
      row.x += it.w;
    }
    const totalH = rows.reduce((acc, r) => acc + r.h, 0);
    let y = bed.min[1] + (bedH - totalH) / 2;
    const updates = new Map<string, [number, number, number]>();
    for (const row of rows) {
      const rowW = row.items.reduce((acc, i) => acc + i.w, 0);
      let x = bed.min[0] + (bedW - rowW) / 2;
      for (const it of row.items) {
        const cx = x + it.w / 2;
        const cy = y + row.h / 2;
        const curCx = (it.box.min.x + it.box.max.x) / 2;
        const curCy = (it.box.min.y + it.box.max.y) / 2;
        updates.set(it.o.id, [it.o.position[0] + (cx - curCx), it.o.position[1] + (cy - curCy), it.o.position[2] - it.box.min.z]);
        x += it.w;
      }
      y += row.h;
    }
    set((st) => ({
      objects: st.objects.map((o) => (updates.has(o.id) ? { ...o, position: updates.get(o.id)! } : o)),
      sliceDirty: true,
    }));
  },

  buildSliceRequest: () => {
    const s = get();
    const n = s.extruderCount();
    const filaments = s.presets.filament.slice(0, n).map((f) => ({ name: f.name, config: f.current }));
    const objects = s.objects
      .filter((o) => o.visible && o.modelId)
      .map((o) => ({
        modelId: o.modelId!,
        name: o.name,
        transform: objectMatrix(o).elements.slice(),
        config: Object.keys(o.config).length ? o.config : undefined,
        extruder: o.extruder || undefined,
      }));
    const first = s.objects[0]?.name?.replace(/\.[^.]+$/, '') || 'print';
    return {
      objects,
      print: { name: s.presets.print.name, config: s.presets.print.current },
      filaments,
      printer: { name: s.presets.printer.name, config: s.presets.printer.current },
      outputName: s.objects.length > 1 ? `${first}_and_${s.objects.length - 1}_more` : first,
      binaryGcode: s.binaryGcode,
    };
  },

  slice: async () => {
    const s = get();
    if (!s.objects.length) {
      get().toast('error', 'Add a model first');
      return;
    }
    const pending = s.objects.filter((o) => !o.modelId && !o.uploadError);
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
    try {
      const job = await api.slice(req);
      set({ job, jobLog: [], sliceDirty: false, view: 'preview' });
      api.jobEvents(job.id, (ev) => {
        if (ev.type === 'log' && ev.line) set((st) => ({ jobLog: [...st.jobLog.slice(-400), ev.line!] }));
        if (ev.type === 'progress') set((st) => (st.job ? { job: { ...st.job, percent: ev.percent ?? st.job.percent, message: ev.message ?? st.job.message } } : {}));
        if (ev.job) set({ job: ev.job });
        if (ev.type === 'done' && ev.job) {
          get().toast('success', `Slicing finished: ${ev.job.outputName}`);
          if (ev.job.outputName.endsWith('.gcode')) get().loadGcodePreview(ev.job.id).catch((e) => get().toast('error', e.message));
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

  loadGcodePreview: async (jobId) => {
    set({ gcodeLoading: true });
    try {
      const text = await api.gcodeText(jobId);
      const { parseGcodeInWorker } = await import('../gcode/parserClient');
      const parsed = await parseGcodeInWorker(text);
      const vis: Record<string, boolean> = {};
      for (const f of parsed.featureTypes) vis[f] = true;
      set({ gcode: parsed, gcodeJobId: jobId, previewLayerRange: [0, Math.max(0, parsed.layerCount - 1)], previewFeatureVisibility: vis, view: 'preview' });
    } finally {
      set({ gcodeLoading: false });
    }
  },

  setPreviewLayerRange: (previewLayerRange) => set({ previewLayerRange }),
  setPreviewShowTravel: (previewShowTravel) => set({ previewShowTravel }),
  togglePreviewFeature: (f) => set((s) => ({ previewFeatureVisibility: { ...s.previewFeatureVisibility, [f]: !s.previewFeatureVisibility[f] } })),

  applyProjectConfig: async (cfg) => {
    const s = get();
    const schema = s.schema;
    if (!schema) return;
    const pick = (type: PresetType) => {
      const out: Config = {};
      for (const k of schema.presetKeys[type]) if (cfg[k] !== undefined) out[k] = cfg[k];
      return out;
    };
    const printerName = cfg.printer_settings_id;
    if (printerName) await get().selectPreset('printer', printerName).catch(() => undefined);
    const printName = cfg.print_settings_id;
    if (printName) await get().selectPreset('print', printName).catch(() => undefined);
    const filNames = cfg.filament_settings_id ? decodeVector(schema.options.filament_settings_id || { type: 'strings' } as never, cfg.filament_settings_id) : [];
    for (let i = 0; i < filNames.length; i++) await get().selectPreset('filament', filNames[i], i).catch(() => undefined);
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
            if (mine !== undefined) c[k] = def.type === 'strings' ? (mine.match(/[ ;\t\\"\r\n]/) || mine === '' ? `"${mine.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"` : mine) : mine;
          }
          return { ...f, current: c };
        }),
      },
      sliceDirty: true,
    }));
    await get().refreshPresetLists();
  },
}));
