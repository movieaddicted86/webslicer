/**
 * The plater's domain types and the composed `State` of the store (R-6).
 *
 * A slice declares what it owns in its own `<X>Slice` interface; `State` below is the whole store,
 * the intersection of all of them plus the fields more than one slice reads. A slice creator is
 * typed `StateCreator<State, [], [], <X>Slice>`, so `set`/`get` see the whole state while the slice
 * still says what it contributes.
 */
import type { StateCreator } from 'zustand';
import type * as THREE from 'three';
import type { Config, JobRecord, LayerRangeInput, Placement, PresetType, Schema, ServerInfo, Vec3, VolumeType } from '../api';
import type { ParsedGcode } from '../gcode/types';
import type { UiSlice } from './slices/ui';
import type { PresetSlice } from './slices/preset';
import type { PlaterSlice } from './slices/plater';
import type { JobSlice } from './slices/job';
import type { PreviewSlice } from './slices/preview';
import type { HistorySlice } from './slices/history';
import type { ToolsSlice } from './slices/tools';
import type { LayoutSlice } from './slices/layout';

/** A sub-volume of an object: additional part, modifier, support enforcer/blocker or negative volume. */
export interface PlaterVolume extends Placement {
  id: string;
  name: string;
  type: VolumeType;
  /** geometry centred at its own origin; transform is relative to the object */
  geometry: THREE.BufferGeometry;
  modelId?: string;
  uploadError?: string;
  size: Vec3;
  config: Config;
  extruder: number;
  triangles: number;
}

/** One copy of an object: shares geometry, volumes and paint with its siblings, owns its transform. */
export interface PlaterInstance extends Placement {
  id: string;
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
  size: Vec3;
  config: Config;
  extruder: number;
  visible: boolean;
  triangles: number;
  volumes: PlaterVolume[];
  /** per-triangle paint of the main mesh (support enforcers/blockers, seam, MMU extruder) */
  paint?: { supports?: Uint8Array; seam?: Uint8Array; mmu?: Uint8Array };
  /** height range modifiers (object Z in mm, from the object's bottom) */
  ranges: LayerRange[];
  /**
   * Variable layer height profile (T-045): flat `[z0, h0, z1, h1, …]` pairs on the object's own Z axis,
   * or `undefined` while the object uses its fixed layer height.
   */
  layerProfile?: number[];
  /** geometry has been subdivided for painting */
  paintReady?: boolean;
  /** bumped on every paint stroke so the viewer refreshes colours */
  paintVersion?: number;
}

/** A height range modifier in the plater: the request form plus the id the UI edits it by. */
export interface LayerRange extends LayerRangeInput {
  id: string;
}

export interface NewVolumeInput {
  name: string;
  type: VolumeType;
  /** geometry in the object's (un-normalized) coordinate frame when imported, or centred for primitives */
  geometry: THREE.BufferGeometry;
  config?: Config;
  extruder?: number;
  /** position relative to the object origin (primitives); imported volumes are derived from geometry */
  position?: Vec3;
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

/** A preset switch the user started while the current preset has unsaved changes. */
export interface PendingPresetSwitch {
  type: PresetType;
  extruderIdx: number;
  /** the preset to switch to (not yet selected) */
  target: string;
  /** the preset that carries the changes */
  source: PresetSlot;
}

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  text: string;
  /** one button on the toast (e.g. "Start empty" on the restore notice); clicking the toast still dismisses it */
  action?: { label: string; run: () => void };
}

/**
 * The state the slices share. Everything here is read (or written) by more than one slice, or is
 * owned by an action that lives in a different slice than the data:
 *
 * - server metadata and the dialog: `init` (ui) fills `info`/`schema`, while the autosave restore
 *   (`importFiles.ts`) and the preset actions open dialogs and read the schema.
 * - the selection fields: the plater owns them, the history slice clears/repairs them on undo.
 * - `gcode`/`gcodeJobId`: the plater clears them, the preview loads them, the job asks for them.
 * - `autosaveError`: `session.ts` writes it when the automatic restore fails, the objects list reads it.
 */
export interface CoreState {
  ready: boolean;
  fatal?: string;
  /**
   * The HTTP status behind `fatal`, when the server answered at all. The start-up screen tells a
   * host-guard refusal (403) apart from every other failure with it.
   */
  fatalStatus?: number;
  info?: ServerInfo;
  schema?: Schema;
  dialog?:
    | 'printers'
    | 'preferences'
    | 'objectSettings'
    | 'sendToPrinter'
    | 'savePreset'
    | 'renamePreset'
    | 'importPresets'
    | 'about'
    | 'library'
    | 'riskNotice'
    | 'unsavedChanges';
  dialogPayload?: unknown;
  /** preset switch waiting for the user's answer in the "Unsaved Changes" dialog */
  pendingSwitch?: PendingPresetSwitch;
  /** selected sub-volume (belongs to the single selected object) */
  selectedVolumeId?: string;
  /** selected copy of the single selected object; undefined means its first instance */
  selectedInstanceId?: string;
  job?: JobRecord;
  gcode?: ParsedGcode;
  gcodeJobId?: string;
  /** the automatic restore of the last session failed; the objects list offers a retry with this message */
  autosaveError?: string;
  /** a settings field a limit issue pointed at (S1-e); the settings view jumps there and clears it */
  settingFocus?: import('./slices/ui').SettingFocus;
}

/** The whole store state: what every slice contributes plus the state they share. */
export type State = CoreState & UiSlice & PresetSlice & PlaterSlice & JobSlice & PreviewSlice & HistorySlice & ToolsSlice & LayoutSlice;

/**
 * A part of a slice: a creator that `createPlaterSlice` spreads into itself (painting, height
 * ranges). Same accessors as any slice creator, without the store argument the parts do not use.
 */
export type SlicePart<S> = (set: Parameters<StateCreator<State, [], [], S>>[0], get: Parameters<StateCreator<State, [], [], S>>[1]) => S;
