/**
 * Presets, vendor bundles and print hosts as the API hands them out (R-2, F-08).
 */
import type { Config } from './common.js';
import type { PresetType } from './schema.js';

export interface PresetSummary {
  type: PresetType;
  name: string;
  system: boolean;
  vendorId?: string;
  vendorName?: string;
  inherits?: string;
  alias?: string;
  printerModel?: string;
  printerVariant?: string;
  technology?: 'FFF' | 'SLA';
  compatible?: boolean;
  /** filament presets: the first `filament_type` value (`PLA`, `PETG`, …), for the wizard's grouping */
  material?: string;
}

/** A preset with its values: `config` is defaults + preset, `overrides` only what differs. */
export interface ResolvedPreset extends PresetSummary {
  config: Config;
  overrides: Config;
}

/** The body of a preset rename (`PATCH /api/presets/:type/:name`). */
export interface PresetRenameRequest {
  name: string;
}

/** What a rename changed: the preset itself and the references the server owns. */
export interface PresetRenameResult {
  type: PresetType;
  from: string;
  to: string;
  /** how many other user presets' `inherits` were pointed at the new name */
  inheritedBy: number;
  /** how many physical printers were bound to the old name */
  printers: number;
  /** how many stored server projects referenced the old name */
  projects: number;
  /** how many stored autosaves (3MF of a browser session) carried the old settings id */
  autosaves: number;
}

/** One preset of a bundle or G-code config block, as the import preview reports it. */
export interface ImportedPreset {
  type: PresetType;
  name: string;
  config: Config;
}

/** A config key an import dropped, with the reason the client shows. */
export interface RejectedConfigKey {
  type: PresetType;
  name: string;
  key: string;
  reason: string;
}

/** A preset name an import would collide with (a user preset, or a system preset it never overwrites). */
export interface PresetClash {
  type: PresetType;
  /** the name in the bundle */
  name: string;
  /** the name is a system (vendor) preset – an import can only skip it or keep both */
  system: boolean;
}

/** A preset a bundle names but cannot store, with the reason (an unusable name, an empty section). */
export interface RejectedPreset {
  type: PresetType;
  name: string;
  reason: string;
}

/** What the user may do with one clashing preset. */
export type PresetClashChoice = 'skip' | 'overwrite' | 'keep-both';

/** The chosen answer for one clashing preset. */
export interface PresetClashAnswer extends PresetClash {
  choice: PresetClashChoice;
}

/** The choices a client sends back for an import; `system` is informational. */
export type PresetClashChoiceInput = Omit<PresetClash, 'system'> & { system?: boolean; choice: PresetClashChoice };

/**
 * The answer of an import preview (no writes yet): the presets the bundle holds, the names that
 * clash and every key the validation dropped. `bundle` is the INI text the preview was computed
 * from – a G-code file answers the extracted config block, which the client then imports.
 */
export interface PresetImportPreview {
  /** the bundle text the preview was computed from – what the import request sends back */
  bundle: string;
  presets: ImportedPreset[];
  /** presets the bundle names but cannot store (an unusable name, an empty section) */
  invalid: RejectedPreset[];
  clashes: PresetClash[];
  rejected: RejectedConfigKey[];
  /** physical printers the bundle names – exported for the user, not imported */
  physicalPrinters: string[];
  /** a G-code file carries no `[presets]` section; the names were derived from the settings ids */
  fromGcode?: boolean;
}

/** One preset a bundle import wrote. */
export interface ImportedPresetResult {
  type: PresetType;
  name: string;
  /** the new name when "keep both" added a suffix */
  storedAs?: string;
}

/** The answer of a bundle import. */
export interface PresetImportResult {
  imported: ImportedPresetResult[];
  skipped: PresetClash[];
  rejected: RejectedConfigKey[];
}

export interface PrinterModel {
  vendorId: string;
  vendorName: string;
  id: string;
  name: string;
  variants: string[];
  technology: 'FFF' | 'SLA';
  family: string;
  bedModel?: string;
  bedTexture?: string;
  thumbnail?: string;
  defaultMaterials: string[];
}

export interface Vendor {
  id: string;
  name: string;
  configVersion?: string;
  models: PrinterModel[];
  /** Bundle file the vendor was read from. Server-side bookkeeping, `/api/vendors` omits it. */
  file?: string;
}

/** A printer model installed in the UI (vendor + model + variant). */
export interface InstalledPrinter {
  vendorId: string;
  modelId: string;
  variant: string;
}

/**
 * One system filament preset as the configuration wizard offers it: grouped by vendor and material,
 * and marked when no installed printer can use it.
 */
export interface FilamentCatalogEntry {
  name: string;
  vendorId: string;
  vendorName: string;
  /** first `filament_type` value (`PLA`, `PETG`, …), when the preset sets one */
  material?: string;
  /** compatible with at least one installed printer */
  compatible: boolean;
}

/** Print host the sliced G-code can be uploaded to. */
export type HostType = 'octoprint' | 'moonraker' | 'prusalink';

/**
 * The narrow limits of one known machine (S1-d): the global typo catchers are wide on purpose, so a
 * physical printer can say what *it* may take. A job above them is a `send.printer_limit` block.
 */
export interface PrinterSafety {
  /** highest hotend temperature in °C – 240 for a PTFE-lined hotend */
  maxHotend?: number;
  /** highest bed temperature in °C */
  maxBed?: number;
}

export interface PhysicalPrinter {
  id: string;
  name: string;
  type: HostType;
  host: string;
  apiKey?: string;
  /** `apiKey` is never sent back: the API replaces it with this flag. */
  hasApiKey?: boolean;
  presetName?: string;
  /** accept self-signed HTTPS certificates */
  ignoreTls?: boolean;
  /** the machine's own temperature limits (S1-d), optional */
  safety?: PrinterSafety;
}
