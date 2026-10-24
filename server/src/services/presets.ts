/**
 * Preset use cases: list presets against a context, resolve one, and write/remove a user preset.
 *
 * The preset data itself is `slicer/presets.ts`; this layer adds the request-shaped decisions the
 * route used to make – resolving a context config from its name and filtering a user preset to the
 * keys of its type.
 */
import {
  defaultPresetName,
  deleteUserPreset,
  filamentCatalog,
  getVisibleFilaments,
  listPresets,
  resolvePreset,
  saveUserPreset,
  setVisibleFilaments,
  userPresetExists,
} from '../slicer/presets.js';
import { checkConfigValues, blockingConfigIssues } from '@webslicer/shared';
import { ValidationError } from '../errors.js';
import type { IniSection } from '../slicer/ini.js';
import type { FilamentCatalogEntry, PresetSummary, PresetType, ResolvedPreset, Schema } from '@webslicer/shared';

/** The context a preset list is computed against (`POST /api/presets/:type/list`). */
export interface PresetListQuery {
  printerName?: string;
  printerConfig?: Record<string, unknown>;
  printName?: string;
  printConfig?: Record<string, unknown>;
  all: boolean;
}

/** List the presets of a type; a missing context config is resolved from its name. */
export function listPresetsWithContext(schema: Schema, type: PresetType, query: PresetListQuery): PresetSummary[] {
  let printerConfig = query.printerConfig as IniSection | undefined;
  if (!printerConfig && query.printerName) printerConfig = resolvePreset(schema, 'printer', query.printerName)?.config;
  let printConfig = query.printConfig as IniSection | undefined;
  if (!printConfig && query.printName) printConfig = resolvePreset(schema, 'print', query.printName)?.config;
  return listPresets(schema, type, {
    printerName: query.printerName,
    printerConfig,
    printName: query.printName,
    printConfig,
    all: query.all,
  });
}

/** One preset by name, or undefined. */
export function presetOf(schema: Schema, type: PresetType, name: string): ResolvedPreset | undefined {
  return resolvePreset(schema, type, name);
}

/** The default preset of a type. */
export function defaultPreset(schema: Schema, type: PresetType): ResolvedPreset | undefined {
  return resolvePreset(schema, type, defaultPresetName(type));
}

/** Keep only the keys the type knows – a user preset cannot set a foreign option. */
export function filterPresetConfig(schema: Schema, type: PresetType, config: IniSection): IniSection {
  const allowed = new Set(schema.presetKeys[type]);
  const cfg: IniSection = {};
  for (const [k, v] of Object.entries(config)) if (allowed.has(k)) cfg[k] = v;
  return cfg;
}

/**
 * Store a user preset (filtered to its type) and answer it resolved.
 *
 * The values face the same configuration limits the slice routes apply (S1-d): a blocking value – a
 * hotend above 450 °C, a negative layer height – is refused with 400 and its issues, never stored.
 * Soft-range warnings pass, exactly as they do on a slice.
 */
export function storeUserPreset(
  schema: Schema,
  type: PresetType,
  name: string,
  config: IniSection,
  inherits?: string,
): ResolvedPreset | undefined {
  const filtered = filterPresetConfig(schema, type, config);
  const issues = checkConfigValues(type, filtered);
  const blocking = blockingConfigIssues(issues);
  // the client shows the issues it already knows; a preset save is a second gate, like the slice route
  if (blocking.length) throw new ValidationError(blocking[0].message, { issues });
  saveUserPreset(type, name, filtered, inherits);
  return resolvePreset(schema, type, name);
}

/** Does a stored user preset of this type and name exist? */
export function hasUserPreset(type: PresetType, name: string): boolean {
  return userPresetExists(type, name);
}

/** The system filament presets the wizard offers, with the compatibility flag of the given printer. */
export function filamentCatalogue(schema: Schema, printerName?: string): FilamentCatalogEntry[] {
  const printerConfig = printerName ? resolvePreset(schema, 'printer', printerName)?.config : undefined;
  return filamentCatalog(printerName && printerConfig ? printerName : undefined, printerConfig);
}

/** The system filaments the selector shows; an empty list means "show all". */
export function visibleFilaments(): string[] {
  return getVisibleFilaments();
}

/** Replace the list of system filaments the selector shows. */
export function replaceVisibleFilaments(names: string[]): string[] {
  setVisibleFilaments(names);
  return getVisibleFilaments();
}

/** Remove a user preset. */
export function removeUserPreset(type: PresetType, name: string): boolean {
  return deleteUserPreset(type, name);
}
