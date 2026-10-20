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
}

/** A preset with its values: `config` is defaults + preset, `overrides` only what differs. */
export interface ResolvedPreset extends PresetSummary {
  config: Config;
  overrides: Config;
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

/** Print host the sliced G-code can be uploaded to. */
export type HostType = 'octoprint' | 'moonraker' | 'prusalink';

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
}
