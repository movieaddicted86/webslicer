/**
 * The shape of the store the suite drives through `window.webslicer` (exposed by `main.tsx` for
 * debugging and scripted checks). Only the fields the specs read are declared – the app's own types
 * live in `web/src/state`; duplicating them here would tie the suite to internals it does not need.
 */

export interface E2EPlacement {
  id: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface E2EVolume extends E2EPlacement {
  name: string;
  type: string;
  size: [number, number, number];
  extruder: number;
  modelId?: string;
  uploadError?: string;
}

export interface E2ERange {
  id: string;
  minZ: number;
  maxZ: number;
  config: Record<string, string>;
}

export interface E2EObject {
  id: string;
  name: string;
  triangles: number;
  extruder: number;
  size: [number, number, number];
  modelId?: string;
  uploadError?: string;
  visible: boolean;
  config: Record<string, string>;
  volumes: E2EVolume[];
  instances: E2EPlacement[];
  ranges: E2ERange[];
  paint?: { supports?: Uint8Array; seam?: Uint8Array; mmu?: Uint8Array };
  paintVersion?: number;
  geometry: { clone: () => unknown };
}

export interface E2EPresetSlot {
  name: string;
  saved: Record<string, string>;
  current: Record<string, string>;
  system: boolean;
}

export interface E2EJob {
  id: string;
  status: string;
  outputName: string;
  /** the presets the G-code was sliced for – the send gate compares the printer preset */
  presets?: { printer: string; print?: string; filament?: string[] };
  /** the highest temperatures the request asks for (S1-d) */
  temperatures?: { hotend: number; bed: number };
  /** the configuration-limit warnings the job was sliced with (S1-d) */
  configIssues?: Array<{ rule: string; severity: string; key: string; message: string }>;
  info?: {
    warnings?: unknown[];
    estimatedTime?: unknown;
    /** filament use of the finished job (T-042 compares it before and after a merge) */
    filamentUsedMm?: number[];
    filamentUsedCm3?: number[];
    totalFilamentG?: number;
    /** the G-code preflight of the finished file (S1-c) */
    preflight?: E2EPreflight;
  };
}

/** The stored preflight result of a job: the issues with their line, and how often each rule fired. */
export interface E2EPreflight {
  version: number;
  issues: Array<{ rule: string; severity: string; message: string; line: number; text: string }>;
  counts: Record<string, number>;
}

export interface E2EGcode {
  layerCount: number;
  layerZ: number[];
  segmentCount: number;
  featureTypes: string[];
  types: ArrayLike<number>;
  markerCount: number;
}

export interface E2ECustomGcode {
  type: string;
  printZ: number;
  color?: string;
  extra?: string;
}

/** The Arrange settings the gear popover writes (T-043). */
export interface E2EArrangeSettings {
  /** clearance in mm; absent = the print preset's arrangement spacing */
  spacing?: number;
  rotations: boolean;
  alignment: 'center' | 'corner';
}

export interface E2EState {
  ready: boolean;
  fatal?: string;
  objects: E2EObject[];
  presets: {
    printer: E2EPresetSlot;
    print: E2EPresetSlot;
    filament: E2EPresetSlot[];
  };
  selectedIds: string[];
  selectedInstanceId?: string;
  selectedVolumeId?: string;
  /** an object whose rename was requested (F2), cleared by the objects list (T-042) */
  renameRequest?: string;
  requestRename: (id: string) => void;
  /** rename an object or one of its volumes (T-042) */
  renameObject: (id: string, name: string) => void;
  renameVolume: (objectId: string, volumeId: string, name: string) => void;
  mergeObjects: (ids: string[]) => Promise<void>;
  /** arrange settings of the gear popover, remembered per browser (T-043) */
  arrangeSettings: E2EArrangeSettings;
  setArrangeSettings: (patch: Partial<E2EArrangeSettings>) => void;
  /** arrange only the selected instances around the others (Shift+A, T-043) */
  arrangeSelection: () => boolean;
  transformMode: 'translate' | 'rotate' | 'scale';
  paintMode?: 'supports' | 'seam' | 'mmu';
  paintTool: string;
  brushRadius: number;
  placeOnFace: boolean;
  view: string;
  mode: 'simple' | 'advanced' | 'expert';
  sliceDirty: boolean;
  undoStack: unknown[];
  redoStack: unknown[];
  job?: E2EJob;
  gcode?: E2EGcode;
  gcodeLoading: boolean;
  previewLayerRange: [number, number];
  previewMarkers: Record<string, boolean>;
  previewFeatureVisibility: Record<string, boolean>;
  previewColorMode: string;
  previewShowTravel: boolean;
  previewShowShells: boolean;
  previewMoveCut?: number;
  customGcodes: E2ECustomGcode[];
  dialog?: string;
  dialogPayload?: unknown;
  pendingSwitch?: unknown;
  autosaveState: string;
  /** the messages the app currently shows (T-009 reads the STEP conversion's progress and error) */
  toasts: Array<{ id: number; kind: 'info' | 'error' | 'success'; text: string }>;
  dismissToast: (id: number) => void;
  /** set when the automatic restore of the previous session failed */
  autosaveError?: string;
  installed: unknown[];
  vendors: unknown[];
  physicalPrinters: unknown[];
  presetLists: { printer: Array<{ name: string }> };
  extruderCount: () => number;
  select: (ids: string[]) => void;
  selectVolume: (objectId: string, volumeId: string) => void;
  selectInstance: (objectId: string, instanceId: string) => void;
  updateInstance: (objectId: string, instanceId: string, patch: Partial<Pick<E2EPlacement, 'position' | 'rotation' | 'scale'>>) => void;
  setInstanceCount: (objectId: string, n: number) => void;
  addInstances: (objectId: string, count: number) => void;
  addVolume: (objectId: string, volume: { name: string; type: string; geometry: unknown }) => void;
  mirror: (axis: number) => void;
  dropToBed: (objectId: string) => void;
  clearObjects: () => void;
  removeObjects: (ids: string[]) => void;
  setOption: (type: 'print' | 'filament' | 'printer', key: string, value: string, extruderIdx?: number) => void;
  setView: (view: string) => void;
  setMode: (mode: 'simple' | 'advanced' | 'expert') => void;
  selectPreset: (type: 'print' | 'filament' | 'printer', name: string, extruderIdx?: number) => Promise<void>;
  openDialog: (dialog: string, payload?: unknown) => void;
  closeDialog: () => void;
  slice: () => Promise<void>;
  /** the slice request of the current plate (T-042 exports it as 3MF to check the names round trip) */
  buildSliceRequest: () => unknown;
  setPreviewLayerRange: (range: [number, number]) => void;
  setPreviewMoveCut: (move: number | undefined) => void;
  togglePreviewMarker: (kind: string) => void;
  togglePreviewFeature: (feature: string) => void;
  setPreviewShowTravel: (on: boolean) => void;
  setPreviewShowShells: (on: boolean) => void;
  setPreviewColorMode: (mode: string) => void;
  addCustomGcode: (code: { type: string; printZ: number; color?: string; extruder?: number; extra?: string }) => void;
  setCustomGcodes: (codes: E2ECustomGcode[]) => void;
  refreshPhysicalPrinters: () => Promise<void>;
  refreshPresetLists: () => Promise<void>;
  autosaveNow: () => Promise<void>;
  discardAutosave: () => Promise<void>;
  /** painting (T-035 drives it to prove the paint survives a reload) */
  startPaint: (objectId: string, kind: 'supports' | 'seam') => Promise<void>;
  beginPaintStroke: (objectId: string) => void;
  applyPaint: (objectId: string, kind: 'supports' | 'seam', triangles: number[], value: number) => void;
  stopPaint: () => void;
}

/** The debug handle `main.tsx` puts on the window. */
export interface E2EStore {
  getState: () => E2EState;
  setState: (partial: Partial<E2EState>) => void;
}

declare global {
  interface Window {
    webslicer: E2EStore;
    /** three.js announces every renderer and scene here; the canvas helpers capture them */
    __THREE_DEVTOOLS__: EventTarget;
    /** installed by `installCanvasProbe` before the app loads */
    __wsObserved: { renderers: unknown[]; scenes: unknown[] };
    __wsMain: () => RendererLike;
    __wsScene: () => SceneLike;
    __wsCamera?: { camera: unknown; scene: unknown; proj: number[]; inv: number[] };
  }
}

/** The parts of a `THREE.WebGLRenderer` the resource census reads. */
export interface RendererLike {
  info: { memory: { geometries: number; textures: number }; programs?: unknown[] };
  getClearAlpha: () => number;
  render: (scene: unknown, camera: unknown) => void;
}
/** The parts of a `THREE.Scene` the scene probes traverse. */
export interface SceneLike {
  children: SceneChildLike[];
  traverse: (fn: (o: SceneChildLike) => void) => void;
}

export interface SceneChildLike {
  name: string;
  visible: boolean;
  children: SceneChildLike[];
  parent: SceneChildLike | null;
  userData: { move?: number[] };
  material?: { vertexColors?: boolean } | Array<{ vertexColors?: boolean }>;
  geometry?: {
    attributes: { position: { count: number; array: ArrayLike<number> } };
    drawRange: { start: number; count: number };
    index?: { count: number } | null;
  };
  isLine?: boolean;
  isLineSegments?: boolean;
  isLineLoop?: boolean;
  isPoints?: boolean;
  isMesh?: boolean;
  traverse: (fn: (o: SceneChildLike) => void) => void;
}
