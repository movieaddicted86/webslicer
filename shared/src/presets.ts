/**
 * The preset types in their fixed order (W4): the shelves of the preset store, the `:type` of the
 * preset API and the sections of a vendor bundle.
 *
 * Declared once: it used to be written out four times – `routes/api.ts`, `slicer/bundles.ts`,
 * `slicer/schema.ts` and the store's initial `presetLists` – and the copies could drift apart.
 */
import type { PresetType } from './types/schema.js';

/** Every preset type, ordered FFF first, SLA after. */
export const PRESET_TYPES: readonly PresetType[] = ['print', 'filament', 'printer', 'sla_print', 'sla_material'];

/** The same list as a runtime check for a `:type` from a request or a file section. */
export function isPresetType(value: unknown): value is PresetType {
  return typeof value === 'string' && (PRESET_TYPES as readonly string[]).includes(value);
}
