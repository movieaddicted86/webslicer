/**
 * MCP safety policy (S1-a, T-025): which slicer options an MCP client may set, and how far a value
 * may move away from the value the resolved preset already has.
 *
 * Why this exists: the MCP channel is driven by a model, and a human who later starts the job does
 * not read the G-code. `set_settings` used to accept every key of every scope – including printer
 * options such as `start_gcode`, `z_offset` or `bed_shape` – and only type-coerced the value, so an
 * AI client could prepare G-code that drives the machine outside its limits.
 *
 * Two rules, both pure (schema in, verdict out), so the server and the tests share one copy:
 *
 * - **Allowlist** – process options (layers, shells, infill, support, skirt/brim, speeds, seam,
 *   ironing, patterns, widths) and material options (temperatures, fan, retraction, extrusion
 *   multiplier, volumetric speed, cooling). Never anything in the printer scope, never free text or
 *   coordinates, never G-code or script text (`start_gcode`, every `*_gcode`), never a multiline
 *   option and never the server-only keys of SEC-1.
 * - **Band** – a bounded step around the resolved preset value: temperatures ±25 °C, speeds
 *   ×0.5–×1.5 (an absolute value absolutely, a percent value as percent), `extrusion_multiplier`
 *   ±0.1, `filament_retract_length` ±1 mm. Per-extruder vectors are compared element by element.
 *   `0` – "off" or "auto" for the slicer – stays allowed where PrusaSlicer means that.
 */
import { SERVER_ONLY_KEYS, serverOnlyReason } from '../serverOnly.js';
import type { OptionType, PresetType, Schema } from '../types/index.js';

/** Preset types an MCP client may change at all; printer presets stay closed. */
const MCP_TYPES: ReadonlySet<PresetType> = new Set<PresetType>(['print', 'filament']);

/** Value shapes a client may set: numbers, percents, enums and flags. Free text is never allowed. */
const VALUE_TYPES: ReadonlySet<OptionType> = new Set<OptionType>([
  'float',
  'int',
  'percent',
  'float_or_percent',
  'bool',
  'enum',
  'floats',
  'ints',
  'percents',
  'floats_or_percents',
  'bools',
]);

/**
 * PrusaSlicer option categories made of process options. The category is what the installed slicer
 * reports for its own help text, so a new process option of a known category is covered without a
 * code change; the explicit lists below add the keys that sit in "Misc".
 */
const PROCESS_CATEGORIES: ReadonlySet<string> = new Set([
  'Layers and Perimeters',
  'Infill',
  'Support material',
  'Skirt and brim',
  'Speed',
  'Ironing',
  'Fuzzy Skin',
  'Extrusion Width',
  'Wipe options',
]);

/**
 * Print options of the "Misc" category that belong to the process (PrusaSlicer files skirt,
 * travel and vase options there). Reviewed one by one, all harmless to the machine.
 */
const PRINT_MISC_KEYS: ReadonlySet<string> = new Set([
  'skirts',
  'skirt_distance',
  'skirt_height',
  'min_skirt_length',
  'draft_shield',
  'spiral_vase',
  'travel_speed',
  'max_print_speed',
  'seam_gap_distance',
  'ooze_prevention',
]);

/**
 * Filament options an MCP client may set: what makes the material print differently. Deliberately
 * short – no diameter, density or cost keys, no purge/flush tuning of a multi-material setup.
 */
const MATERIAL_KEYS: ReadonlySet<string> = new Set([
  'temperature',
  'first_layer_temperature',
  'bed_temperature',
  'first_layer_bed_temperature',
  'extrusion_multiplier',
  'filament_max_volumetric_speed',
  'max_fan_speed',
  'min_fan_speed',
  'bridge_fan_speed',
  'disable_fan_first_layers',
  'fan_always_on',
  'fan_below_layer_time',
  'full_fan_speed_layer',
  'cooling',
  'slowdown_below_layer_time',
  'min_print_speed',
  'overhang_fan_speed_0',
  'overhang_fan_speed_1',
  'overhang_fan_speed_2',
  'overhang_fan_speed_3',
  'filament_retract_length',
  'filament_retract_speed',
  'filament_deretract_speed',
  'filament_retract_lift',
  'filament_retract_before_travel',
  'filament_retract_before_wipe',
  'filament_retract_restart_extra',
  'filament_retract_layer_change',
  'filament_wipe',
]);

/** The explicit part of the allowlist (everything the category rule does not cover). */
export const MCP_ALLOWLIST: ReadonlySet<string> = new Set<string>([...PRINT_MISC_KEYS, ...MATERIAL_KEYS]);

/** The verdict for one key; `reason` is written for a model to read and correct itself. */
export type McpKeyVerdict = { allowed: true } | { allowed: false; reason: string };

/** Whether a client may set `key` in a preset of `type`, and if not, why not. */
export function mcpKeyVerdict(schema: Schema, type: PresetType, key: string): McpKeyVerdict {
  const deny = (reason: string): McpKeyVerdict => ({ allowed: false, reason });
  if (!MCP_TYPES.has(type)) return deny('Printer options cannot be set through MCP');
  const opt = schema.options[key];
  if (!opt) return deny(`Unknown option "${key}"`);
  if (SERVER_ONLY_KEYS.has(key)) return deny(`Option "${key}" cannot be set: ${serverOnlyReason(key)}`);
  // the G-code rule comes before the preset-type rule: `start_gcode` is a printer option, but the
  // reason a client has to learn is that its text ends up in the G-code, not that the scope is odd
  if (opt.multiline || opt.gcode || /_gcode$/.test(key)) return deny('G-code and script options cannot be set through MCP');
  if (!opt.presetTypes.includes(type)) return deny(`Option "${key}" is not a ${type} preset option`);
  if (!VALUE_TYPES.has(opt.type)) return deny('Text and coordinate options cannot be set through MCP');
  if (!isAllowlisted(type, opt.key, opt.category)) return deny('Not on the MCP allowlist');
  return { allowed: true };
}

/** Whether one key of a preset type is on the allowlist (schema category plus the explicit keys). */
export function isMcpAllowedKey(schema: Schema, type: PresetType, key: string): boolean {
  return mcpKeyVerdict(schema, type, key).allowed;
}

function isAllowlisted(type: PresetType, key: string, category: string): boolean {
  if (type === 'print') return PROCESS_CATEGORIES.has(category) || PRINT_MISC_KEYS.has(key);
  return MATERIAL_KEYS.has(key);
}

/** The preset types in which a client may set this key; empty when the key is closed for MCP. */
export function mcpSettableScopes(schema: Schema, key: string): PresetType[] {
  return [...MCP_TYPES].filter((type) => mcpKeyVerdict(schema, type, key).allowed);
}

/** Every key an MCP client may set in a preset type, sorted – the lists of the docs and the tests. */
export function mcpAllowlistOf(schema: Schema, type: PresetType): string[] {
  return Object.keys(schema.options)
    .filter((key) => isMcpAllowedKey(schema, type, key))
    .sort();
}

/** How far a value may move away from the resolved preset value. */
export type McpBand =
  { kind: 'delta'; delta: number; unit: string; zeroAllowed: boolean } | { kind: 'factor'; min: number; max: number; zeroAllowed: boolean };

const TEMPERATURE_KEYS: ReadonlySet<string> = new Set([
  'temperature',
  'first_layer_temperature',
  'bed_temperature',
  'first_layer_bed_temperature',
]);

/** Extra bands of single keys, on top of the speed pattern. */
const DELTA_BANDS: ReadonlyMap<string, McpBand> = new Map<string, McpBand>([
  ['extrusion_multiplier', { kind: 'delta', delta: 0.1, unit: '', zeroAllowed: false }],
  ['filament_retract_length', { kind: 'delta', delta: 1, unit: 'mm', zeroAllowed: true }],
]);

/** The band of an option key, or `undefined` when any value the schema accepts may be set. */
export function mcpBandOf(key: string): McpBand | undefined {
  if (TEMPERATURE_KEYS.has(key)) return { kind: 'delta', delta: 25, unit: '°C', zeroAllowed: true };
  const delta = DELTA_BANDS.get(key);
  if (delta) return delta;
  // fan speeds are percents of a fan, not motion speeds – only motion/volumetric speeds are banded
  if (/_speed$/.test(key) && !/fan|acceleration/i.test(key)) return { kind: 'factor', min: 0.5, max: 1.5, zeroAllowed: true };
  return undefined;
}

/** One refused setting: what was sent, why, and what would have been accepted. */
export interface McpSettingIssue {
  key: string;
  value: string;
  reason: string;
  /** empty when the reason already says everything (a malformed value, for example) */
  allowed: string;
}

/**
 * The band issue of a value, if it is outside the band around the resolved preset value.
 *
 * `base` is the raw option value of the resolved preset for the same preset slot – a vector stays a
 * vector, so `215,220` is compared element by element. An element missing in the base vector is
 * taken from its last element (PrusaSlicer resizes per-extruder vectors that way); a value without
 * a numeric counterpart (percent against an absolute base, an empty preset) is not judged here.
 */
export function mcpBandIssue(key: string, value: string, base: string | undefined): McpSettingIssue | undefined {
  const band = mcpBandOf(key);
  if (!band) return undefined;
  const values = splitValues(value);
  const bases = splitValues(base ?? '').filter((b) => b !== '');
  if (!bases.length) return undefined;
  for (let i = 0; i < values.length; i++) {
    const v = parseValue(values[i]);
    const b = parseValue(bases[Math.min(i, bases.length - 1)]);
    if (!v || !b) continue;
    if (v.number === 0 && band.zeroAllowed) continue;
    // a preset value of 0 means "off" or "auto" for the slicer: there is no band to measure against
    if (b.number === 0 && band.zeroAllowed) continue;
    const allowed = allowedRange(band, v, b);
    if (!allowed) continue;
    return { key: values.length > 1 ? `${key}[${i}]` : key, value: values[i], reason: 'outside the band around the preset value', allowed };
  }
  return undefined;
}

/** A number of a config value, with its percent flag; `undefined` for anything else. */
interface ParsedValue {
  number: number;
  percent: boolean;
}

function parseValue(text: string | undefined): ParsedValue | undefined {
  const m = /^(-?\d+(?:\.\d+)?)(%)?$/.exec((text ?? '').trim());
  return m ? { number: Number(m[1]), percent: m[2] === '%' } : undefined;
}

/** Plain comma-separated elements; banded options are numeric vectors, so no string codec is needed. */
function splitValues(text: string): string[] {
  return text === '' ? [] : text.split(',').map((v) => v.trim());
}

/** The allowed range as text, or `undefined` when the value is inside it. */
function allowedRange(band: McpBand, value: ParsedValue, base: ParsedValue): string | undefined {
  if (band.kind === 'delta') {
    if (value.percent || base.percent) return undefined; // not a value band is defined for
    const lo = base.number - band.delta;
    const hi = base.number + band.delta;
    if (inRange(value.number, lo, hi)) return undefined;
    const unit = band.unit ? ` ${band.unit}` : '';
    return `${number(lo)}–${number(hi)}${unit} (±${number(band.delta)}${unit} around ${number(base.number)})`;
  }
  if (value.percent !== base.percent) return undefined; // an absolute speed against a percent base
  const lo = base.number * band.min;
  const hi = base.number * band.max;
  if (inRange(value.number, lo, hi)) return undefined;
  const suffix = value.percent ? '%' : '';
  return `${number(lo)}${suffix}–${number(hi)}${suffix} (×${number(band.min)}–×${number(band.max)} of ${number(base.number)}${base.percent ? '%' : ''})`;
}

function inRange(value: number, lo: number, hi: number): boolean {
  return value >= lo && value <= hi;
}

/** Compact number for a message: `190`, `1.1`, `0.25`. */
function number(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}
