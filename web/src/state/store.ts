import { create } from 'zustand';
import * as THREE from 'three';
import {
  api,
  autosaveApi,
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
  type VolumeType,
  type ThumbnailInput,
  type CustomGcode,
} from '../api';
import { parseThumbnailSpec, type ThumbnailSpec } from '../three/thumbnail';
import { importFiles } from '../importFiles';
import { decodeMmu, decodePaint, encodeMmu, encodePaint, remapPaint, subdivideForPainting, type PaintKind } from '../three/paint';
import { decodeVector, resizeVector, toBool, unescapeStringsCstyle } from '../values';
import type { ParsedGcode } from '../gcode/types';
import type { PreviewColorMode } from '../gcode/colorschemes';

/** A sub-volume of an object: additional part, modifier, support enforcer/blocker or negative volume. */
export interface PlaterVolume {
  id: string;
  name: string;
  type: VolumeType;
  /** geometry centred at its own origin; transform is relative to the object */
  geometry: THREE.BufferGeometry;
  modelId?: string;
  uploadError?: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  size: [number, number, number];
  config: Config;
  extruder: number;
  triangles: number;
}

/** One copy of an object: shares geometry, volumes and paint with its siblings, owns its transform. */
export interface PlaterInstance {
  id: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface PlaterObject {
  id: string;
  name: string;
  geometry: THREE.BufferGeometry;
  modelId?: string;
  uploadError?: string;
  /** copies of this object; always at least one, instance 1 is the object's main placement */
  instances: PlaterInstance[];
  /** base size (unscaled bounding box) */
  size: [number, number, number];
  config: Config;
  extruder: number;
  visible: boolean;
  triangles: number;
  volumes: PlaterVolume[];
  /** per-triangle paint of the main mesh (support enforcers/blockers, seam, MMU extruder) */
  paint?: { supports?: Uint8Array; seam?: Uint8Array; mmu?: Uint8Array };
  /** height range modifiers (object Z in mm, from the object's bottom) */
  ranges: LayerRange[];
  /** geometry has been subdivided for painting */
  paintReady?: boolean;
  /** bumped on every paint stroke so the viewer refreshes colours */
  paintVersion?: number;
}

export interface LayerRange {
  id: string;
  minZ: number;
  maxZ: number;
  config: Config;
}

export interface NewVolumeInput {
  name: string;
  type: VolumeType;
  /** geometry in the object's (un-normalized) coordinate frame when imported, or centred for primitives */
  geometry: THREE.BufferGeometry;
  config?: Config;
  extruder?: number;
  /** position relative to the object origin (primitives); imported volumes are derived from geometry */
  position?: [number, number, number];
}

export const VOLUME_LABELS: Record<VolumeType, string> = {
  ModelPart: 'Part',
  ParameterModifier: 'Modifier',
  SupportEnforcer: 'Support enforcer',
  SupportBlocker: 'Support blocker',
  NegativeVolume: 'Negative volume',
};

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
  /** selected sub-volume (belongs to the single selected object) */
  selectedVolumeId?: string;
  /** selected copy of the single selected object; undefined means its first instance */
  selectedInstanceId?: string;
  transformMode: 'translate' | 'rotate' | 'scale';
  /** "Place on face" tool: the next click on an object face lays that face flat on the bed */
  placeOnFace: boolean;
  setPlaceOnFace: (on: boolean) => void;
  /** rotate an object so that the given world-space face normal points down (-Z) */
  placeObjectOnFace: (id: string, worldNormal: [number, number, number]) => void;
  /** undo / redo of plater changes (objects, volumes, transforms, per-object settings) */
  /** painting (support enforcers/blockers, seam) */
  paintMode?: PaintKind;
  paintTool: 'enforcer' | 'blocker' | 'erase';
  /** extruder painted in MMU mode (1-based) */
  paintExtruder: number;
  setPaintExtruder: (n: number) => void;
  brushRadius: number;
  /** height range modifiers */
  addRange: (objectId: string) => void;
  updateRange: (objectId: string, rangeId: string, patch: Partial<LayerRange>) => void;
  removeRange: (objectId: string, rangeId: string) => void;
  startPaint: (objectId: string, kind: PaintKind) => Promise<void>;
  stopPaint: () => void;
  setPaintTool: (t: 'enforcer' | 'blocker' | 'erase') => void;
  setBrushRadius: (r: number) => void;
  beginPaintStroke: (objectId: string) => void;
  applyPaint: (objectId: string, kind: PaintKind, triangles: number[], value: number) => void;
  clearPaint: (objectId: string, kind: PaintKind) => void;
  undoStack: PlaterObject[][];
  redoStack: PlaterObject[][];
  recordHistory: (snapshot?: PlaterObject[]) => void;
  undo: () => void;
  redo: () => void;

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
  /** how toolpaths are coloured in the preview */
  previewColorMode: PreviewColorMode;
  setPreviewColorMode: (m: PreviewColorMode) => void;
  /** colour changes, pauses and custom G-code per layer height (plate level, like PrusaSlicer) */
  customGcodes: CustomGcode[];
  addCustomGcode: (c: CustomGcode) => void;
  updateCustomGcode: (printZ: number, patch: Partial<CustomGcode>) => void;
  removeCustomGcode: (printZ: number) => void;
  setCustomGcodes: (codes: CustomGcode[]) => void;

  toasts: Toast[];
  /** registered by the Viewer: renders G-code preview thumbnails of the plater */
  renderThumbnails?: (specs: ThumbnailSpec[], colors: string[]) => ThumbnailInput[];
  dialog?: 'addPrinter' | 'physicalPrinters' | 'objectSettings' | 'sendToPrinter' | 'savePreset' | 'about' | 'library';
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

  addObjects: (
    items: Array<{
      name: string;
      geometry: THREE.BufferGeometry;
      config?: Config;
      extruder?: number;
      volumes?: NewVolumeInput[];
      instances?: Array<{ position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] }>;
      supportPaint?: string;
      seamPaint?: string;
      mmuPaint?: string;
      ranges?: Array<{ minZ: number; maxZ: number; config: Config }>;
    }>,
    opts?: { keepPositions?: boolean },
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
  /** autosave of the plater on the server (per browser) */
  autosaveInfo?: { savedAt: string; size: number };
  autosaveState: 'idle' | 'saving' | 'saved' | 'error';
  autosaveNow: () => Promise<void>;
  restoreAutosave: () => Promise<void>;
  discardAutosave: () => Promise<void>;
}

let toastId = 0;
let objectId = 0;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let resliceTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Re-slice automatically after colour changes / pauses were edited in the preview,
 * like PrusaSlicer's background G-code export.
 */
function scheduleReslice() {
  clearTimeout(resliceTimer);
  resliceTimer = setTimeout(() => {
    const s = useStore.getState();
    const running = s.job && (s.job.status === 'running' || s.job.status === 'queued');
    if (s.view === 'preview' && s.objects.length && !running) s.slice();
  }, 900);
}

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

/** World matrix of one instance of an object. */
export function instanceMatrix(inst: PlaterInstance): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(inst.rotation[0], inst.rotation[1], inst.rotation[2], 'XYZ'));
  m.compose(new THREE.Vector3(...inst.position), q, new THREE.Vector3(...inst.scale));
  return m;
}

export function volumeMatrix(v: PlaterVolume): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(v.rotation[0], v.rotation[1], v.rotation[2], 'XYZ'));
  m.compose(new THREE.Vector3(...v.position), q, new THREE.Vector3(...v.scale));
  return m;
}

/** The instance a selection refers to: the selected one, or the object's first instance. */
export function selectedInstance(state: { selectedIds: string[]; selectedInstanceId?: string }, o: PlaterObject): PlaterInstance {
  const id = state.selectedIds.length === 1 && state.selectedIds[0] === o.id ? state.selectedInstanceId : undefined;
  return o.instances.find((i) => i.id === id) || o.instances[0];
}

/** World-space bounds of one instance (its own scale applies to the object's volumes too). */
export function instanceBounds(o: PlaterObject, inst: PlaterInstance): THREE.Box3 {
  const box = new THREE.Box3();
  if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
  const im = instanceMatrix(inst);
  box.copy(o.geometry.boundingBox!).applyMatrix4(im);
  for (const v of o.volumes || []) {
    if (v.type !== 'ModelPart') continue;
    if (!v.geometry.boundingBox) v.geometry.computeBoundingBox();
    const vb = new THREE.Box3().copy(v.geometry.boundingBox!).applyMatrix4(volumeMatrix(v)).applyMatrix4(im);
    box.union(vb);
  }
  return box;
}

/** World-space bounds of all instances (for whole-object checks). */
export function objectBounds(o: PlaterObject): THREE.Box3 {
  const box = new THREE.Box3();
  for (const inst of o.instances) box.union(instanceBounds(o, inst));
  return box;
}

function geometrySize(g: THREE.BufferGeometry): [number, number, number] {
  if (!g.boundingBox) g.computeBoundingBox();
  const bb = g.boundingBox!;
  return [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z];
}

function triangleCount(g: THREE.BufferGeometry): number {
  return g.getIndex() ? g.getIndex()!.count / 3 : g.getAttribute('position').count / 3;
}

let volumeId = 0;
let rangeId = 0;
let instanceId = 0;

/**
 * Build a PlaterVolume from an input. `offset` is the translation that was applied to the
 * parent object's geometry during normalization; imported volume geometry shares that frame.
 */
function makeVolume(input: NewVolumeInput, offset: [number, number, number]): PlaterVolume {
  const g = input.geometry;
  g.computeBoundingBox();
  let position: [number, number, number];
  if (input.position) {
    position = input.position;
  } else {
    // centre the geometry at its own origin and remember where it was (object frame)
    const bb = g.boundingBox!;
    const cx = (bb.min.x + bb.max.x) / 2;
    const cy = (bb.min.y + bb.max.y) / 2;
    const cz = (bb.min.z + bb.max.z) / 2;
    g.translate(-cx, -cy, -cz);
    g.computeBoundingBox();
    position = [cx + offset[0], cy + offset[1], cz + offset[2]];
  }
  g.computeVertexNormals();
  return {
    id: `vol-${++volumeId}`,
    name: input.name,
    type: input.type,
    geometry: g,
    position,
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    size: geometrySize(g),
    config: { ...(input.config || {}) },
    extruder: input.extruder || 0,
    triangles: triangleCount(g),
  };
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
    set((s) => ({ customGcodes: s.customGcodes.map((x) => (Math.abs(x.printZ - printZ) <= 1e-4 ? { ...x, ...patch } : x)), sliceDirty: true }));
    scheduleReslice();
  },
  removeCustomGcode: (printZ) => {
    set((s) => {
      const customGcodes = s.customGcodes.filter((x) => Math.abs(x.printZ - printZ) > 1e-4);
      return {
        customGcodes,
        previewColorMode: s.previewColorMode === 'colorprint' && !customGcodes.some((x) => x.type === 'color_change') ? 'feature' : s.previewColorMode,
        sliceDirty: true,
      };
    });
    scheduleReslice();
  },
  setCustomGcodes: (codes) =>
    set((s) => ({
      customGcodes: [...codes].sort((a, b) => a.printZ - b.printZ),
      previewColorMode: codes.some((x) => x.type === 'color_change') ? 'colorprint' : s.previewColorMode === 'colorprint' ? 'feature' : s.previewColorMode,
    })),
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
      // offer to restore the last autosaved plater
      autosaveApi
        .info(clientId())
        .then((info) => {
          if (info && !get().objects.length) set({ autosaveInfo: info });
        })
        .catch(() => undefined);
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
      else if (!first && curPrint !== '- default FFF -') await get().selectPreset('print', '- default FFF -');
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
      else if (!first && cur !== '- default FFF -') await get().selectPreset('filament', '- default FFF -', i);
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
    get().recordHistory();
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
      const offset: [number, number, number] = [-cx, -cy, -bb.min.z];
      created.push({
        id,
        name: it.name,
        geometry: g,
        instances: (it.instances?.length ? it.instances : [{ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }]).map((t) => ({
          id: `inst-${++instanceId}`,
          position: opts.keepPositions ? ([cx + t.position[0], cy + t.position[1], t.position[2]] as [number, number, number]) : ([(bed.min[0] + bed.max[0]) / 2, (bed.min[1] + bed.max[1]) / 2, 0] as [number, number, number]),
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
        ranges: (it.ranges || []).map((r) => ({ id: `rng-${++rangeId}`, minZ: r.minZ, maxZ: r.maxZ, config: { ...r.config } })),
      });
    }
    set((st) => ({ objects: [...st.objects, ...created], selectedIds: created.map((c) => c.id), selectedVolumeId: undefined, selectedInstanceId: undefined, sliceDirty: true }));
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
      objects: s.objects.map((o) => (o.id === objectId ? { ...o, volumes: o.volumes.map((v) => (v.id === vid ? { ...v, ...patch } : v)) } : o)),
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

  updateObject: (id, patch) =>
    set((s) => ({ objects: s.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)), sliceDirty: true })),

  updateInstance: (objectId, instId, patch) =>
    set((s) => ({
      objects: s.objects.map((o) => (o.id === objectId ? { ...o, instances: o.instances.map((i) => (i.id === instId ? { ...i, ...patch } : i)) } : o)),
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
    set({ objects: [], selectedIds: [], selectedVolumeId: undefined, selectedInstanceId: undefined, sliceDirty: true, gcode: undefined, gcodeJobId: undefined, customGcodes: [], previewColorMode: 'feature' });
  },

  duplicateObjects: async (ids) => {
    get().recordHistory();
    const s = get();
    const items = s.objects.filter((o) => ids.includes(o.id));
    const created: PlaterObject[] = items.map((o) => ({
      ...o,
      id: `obj-${++objectId}`,
      // independent copies: every instance gets its own transform (and id), offset like PrusaSlicer's duplicate
      instances: o.instances.map((i) => ({ ...i, id: `inst-${++instanceId}`, position: [i.position[0] + 10, i.position[1] + 10, i.position[2]] })),
      config: { ...o.config },
      volumes: o.volumes.map((v) => ({ ...v, id: `vol-${++volumeId}`, config: { ...v.config } })),
      paint: o.paint ? { supports: o.paint.supports?.slice(), seam: o.paint.seam?.slice(), mmu: o.paint.mmu?.slice() } : undefined,
      ranges: o.ranges.map((r) => ({ ...r, id: `rng-${++rangeId}`, config: { ...r.config } })),
    }));
    set((st) => ({ objects: [...st.objects, ...created], selectedIds: created.map((c) => c.id), selectedVolumeId: undefined, selectedInstanceId: undefined, sliceDirty: true }));
    get().arrange();
  },

  select: (ids, additive = false) =>
    set((s) => ({ selectedIds: additive ? Array.from(new Set([...s.selectedIds, ...ids])) : ids, selectedVolumeId: undefined, selectedInstanceId: undefined })),

  setTransformMode: (transformMode) => set({ transformMode, placeOnFace: false }),

  placeOnFace: false,
  setPlaceOnFace: (placeOnFace) => set({ placeOnFace }),

  paintTool: 'enforcer',
  brushRadius: 3,

  startPaint: async (objectId, kind) => {
    const o = get().objects.find((x) => x.id === objectId);
    if (!o) return;
    set({ selectedIds: [objectId], selectedVolumeId: undefined, paintMode: kind, placeOnFace: false, view: 'plater' });
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
  stopPaint: () => set({ paintMode: undefined }),
  setPaintTool: (paintTool) => set({ paintTool }),
  paintExtruder: 1,
  setPaintExtruder: (paintExtruder) => set({ paintExtruder }),

  addRange: (objectId) => {
    const o = get().objects.find((x) => x.id === objectId);
    if (!o) return;
    get().recordHistory();
    const top = o.ranges.reduce((m, r) => Math.max(m, r.maxZ), 0);
    const h = o.size[2] * selectedInstance(get(), o).scale[2];
    const minZ = Math.min(top, h);
    const maxZ = Math.min(h, minZ + Math.max(2, h / 4));
    const r: LayerRange = {
      id: `rng-${++rangeId}`,
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
  setBrushRadius: (brushRadius) => set({ brushRadius: Math.max(0.2, Math.min(50, brushRadius)) }),

  beginPaintStroke: (objectId) => {
    // history snapshot with copied paint arrays (strokes mutate them in place)
    const s = get();
    const snap = s.objects.map((o) => (o.id === objectId && o.paint ? { ...o, paint: { supports: o.paint.supports?.slice(), seam: o.paint.seam?.slice() } } : o));
    s.recordHistory(snap);
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

  undoStack: [],
  redoStack: [],
  recordHistory: (snapshot) => {
    const s = get();
    const snap = snapshot ?? s.objects;
    if (s.undoStack[s.undoStack.length - 1] === snap) return;
    set({ undoStack: [...s.undoStack.slice(-49), snap], redoStack: [] });
  },
  undo: () => {
    const s = get();
    const snap = s.undoStack[s.undoStack.length - 1];
    if (!snap) return;
    const restored = mergeUploadState(snap, s.objects);
    set({
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, s.objects],
      objects: restored,
      selectedIds: s.selectedIds.filter((id) => restored.some((o) => o.id === id)),
      selectedVolumeId: undefined,
      sliceDirty: true,
    });
  },
  redo: () => {
    const s = get();
    const snap = s.redoStack[s.redoStack.length - 1];
    if (!snap) return;
    const restored = mergeUploadState(snap, s.objects);
    set({
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [...s.undoStack, s.objects],
      objects: restored,
      selectedIds: s.selectedIds.filter((id) => restored.some((o) => o.id === id)),
      selectedVolumeId: undefined,
      sliceDirty: true,
    });
  },

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
    if (Math.abs(box.min.z) > 1e-6) get().updateInstance(id, inst.id, { position: [inst.position[0], inst.position[1], inst.position[2] - box.min.z] });
  },

  arrange: () => {
    get().recordHistory();
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
    const updates = new Map<string, { instId: string; position: [number, number, number] }>();
    for (const row of rows) {
      const rowW = row.items.reduce((acc, i) => acc + i.w, 0);
      let x = bed.min[0] + (bedW - rowW) / 2;
      for (const it of row.items) {
        const cx = x + it.w / 2;
        const cy = y + row.h / 2;
        const curCx = (it.box.min.x + it.box.max.x) / 2;
        const curCy = (it.box.min.y + it.box.max.y) / 2;
        const inst = it.o.instances[0];
        updates.set(it.o.id, {
          instId: inst.id,
          position: [inst.position[0] + (cx - curCx), inst.position[1] + (cy - curCy), inst.position[2] - it.box.min.z],
        });
        x += it.w;
      }
      y += row.h;
    }
    set((st) => ({
      objects: st.objects.map((o) => {
        const up = updates.get(o.id);
        if (!up) return o;
        return { ...o, instances: o.instances.map((i) => (i.id === up.instId ? { ...i, position: up.position } : i)) };
      }),
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
        transform: instanceMatrix(o.instances[0]).elements.slice(),
        instances: o.instances.length > 1 ? o.instances.map((i) => instanceMatrix(i).elements.slice()) : undefined,
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
            transform: volumeMatrix(v).elements.slice(),
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
          const colors = s.presets.filament.map((f) => (colDef ? decodeVector(colDef, f.current.filament_colour)[0] : f.current.filament_colour) || '');
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
      // keep the slider position when re-slicing (e.g. after adding a colour change)
      const prev = get().gcode;
      const prevRange = get().previewLayerRange;
      const keep = prev && prev.layerCount === parsed.layerCount;
      const range: [number, number] = keep ? prevRange : [0, Math.max(0, parsed.layerCount - 1)];
      const oldVis = get().previewFeatureVisibility;
      for (const f of parsed.featureTypes) if (keep && oldVis[f] === false) vis[f] = false;
      set({ gcode: parsed, gcodeJobId: jobId, previewLayerRange: range, previewFeatureVisibility: vis, view: 'preview' });
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

  restoreAutosave: async () => {
    try {
      const blob = await autosaveApi.fetch(clientId());
      await importFiles([new File([blob], 'autosave.3mf')]);
      set({ autosaveInfo: undefined });
      get().toast('success', 'Previous session restored');
    } catch (e) {
      get().toast('error', `Restore failed: ${(e as Error).message}`);
    }
  },

  discardAutosave: async () => {
    await autosaveApi.remove(clientId()).catch(() => undefined);
    set({ autosaveInfo: undefined });
  },
}));

/**
 * History snapshots may predate the mesh uploads; carry the upload bookkeeping
 * (modelId / uploadError) of the current objects over to the restored snapshot.
 */
function mergeUploadState(snapshot: PlaterObject[], current: PlaterObject[]): PlaterObject[] {
  const byId = new Map(current.map((o) => [o.id, o]));
  return snapshot.map((o) => {
    const cur = byId.get(o.id);
    const volumes = o.volumes.map((v) => {
      const cv = cur?.volumes.find((x) => x.id === v.id);
      return cv && (cv.modelId || cv.uploadError) && !v.modelId ? { ...v, modelId: cv.modelId, uploadError: cv.uploadError } : v;
    });
    if (cur && (cur.modelId || cur.uploadError) && !o.modelId) return { ...o, modelId: cur.modelId, uploadError: cur.uploadError, volumes };
    return volumes.some((v, i) => v !== o.volumes[i]) ? { ...o, volumes } : o;
  });
}

/** Stable per-browser id for the server-side autosave */
export function clientId(): string {
  const key = 'webslicer.clientId';
  try {
    let id = localStorage.getItem(key);
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return 'anonymous-client';
  }
}

// Autosave: debounce after plater or settings changes while objects exist.
let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
let lastAutosaveKey = '';
useStore.subscribe((s, prev) => {
  if (!s.ready) return;
  if (s.objects === prev.objects && s.presets === prev.presets) return;
  if (!s.objects.length) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    const st = useStore.getState();
    if (!st.objects.length || st.objects.some((o) => !o.modelId && !o.uploadError)) return;
    // cheap change key: object ids/transforms/config + preset names + modified state
    const key = JSON.stringify([
      st.objects.map((o) => [o.id, o.instances.map((i) => [i.id, i.position, i.rotation, i.scale]), o.config, o.extruder, o.visible, o.volumes.map((v) => [v.id, v.type, v.position, v.rotation, v.scale, v.config])]),
      st.presets.print.name,
      st.customGcodes,
      st.presets.printer.name,
      st.presets.filament.map((f) => f.name),
      isModified(st.presets.print),
      isModified(st.presets.printer),
      st.presets.filament.map(isModified),
    ]);
    if (key === lastAutosaveKey) return;
    lastAutosaveKey = key;
    st.autosaveNow();
  }, 8000);
});
