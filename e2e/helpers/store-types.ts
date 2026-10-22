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
  info?: { warnings?: unknown[]; estimatedTime?: unknown };
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
  autosaveInfo?: { savedAt: string; size: number };
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
  setOption: (type: 'print' | 'filament' | 'printer', key: string, value: string) => void;
  setView: (view: string) => void;
  setMode: (mode: 'simple' | 'advanced' | 'expert') => void;
  selectPreset: (type: 'print' | 'filament' | 'printer', name: string, extruderIdx?: number) => Promise<void>;
  openDialog: (dialog: string, payload?: unknown) => void;
  closeDialog: () => void;
  slice: () => Promise<void>;
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
