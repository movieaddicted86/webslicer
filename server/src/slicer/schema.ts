import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getHelpText, getSlicerVersion } from './cli.js';
import { LAYOUT_FFF, KNOWN_OPTIONS, PRINT_VECTOR_KEYS, PRINTER_VECTOR_KEYS, PRINTER_STRING_VECTOR_KEYS } from './layout/index.js';
import type { LayoutGroup, LayoutPage, OptionDef, OptionType, PresetType, Schema, TabLayout } from '@webslicer/shared';

interface RawHelpOption {
  key: string;
  category: string;
  hint: string; // N / ABCD / X,Y / ''
  descr: string;
}

/** Parse the output of `prusa-slicer --help-fff` / `--help-sla` */
/**
 * Options that are only command-line shortcuts or legacy aliases. They must never end up in a
 * config file: PrusaSlicer expands them into other options on load (e.g. "solid_layers" sets
 * top and bottom solid layers, "extruder" overrides all extruder assignments).
 */
export const SHORTCUT_KEYS = new Set([
  'extruder',
  'solid_layers',
  'solid_min_thickness',
  'duplicate_distance',
  'preset_name',
  'preset_names',
  'colorprint_heights',
  'after_layer_gcode',
]);

/**
 * Parse the output of `prusa-slicer --help-fff` / `--help-sla`.
 * `knownKeys` (keys seen in vendor bundles) decides which of several aliases on one help line
 * ("--after-layer-gcode, --layer-gcode") is the canonical option key.
 */
export function parseHelp(text: string, knownKeys?: Set<string>): RawHelpOption[] {
  const lines = text.split(/\r?\n/);
  // Print options start after the "Print options are processed..." paragraph.
  let start = lines.findIndex((l) => l.startsWith('Print options are processed'));
  if (start < 0) start = 0;
  const out: RawHelpOption[] = [];
  let category = '';
  let cur: RawHelpOption | undefined;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (line.startsWith('\t')) continue; // ordering paragraph
    // " --name HINT, --alias HINT, -x   description" – every alias may carry its own type hint.
    const optMatch =
      /^ ((?:--?[A-Za-z0-9_-]+(?: (?:N|ABCD|X,Y,Z|X,Y))?)(?:, --?[A-Za-z0-9_-]+(?: (?:N|ABCD|X,Y,Z|X,Y))?)*)(?:\s+(.*))?$/.exec(line);
    if (optMatch && !line.startsWith('  ')) {
      const specs = optMatch[1].split(/,\s+(?=-)/).map((s) => s.trim());
      let hint = '';
      const longKeys: string[] = [];
      for (const spec of specs) {
        const [name, h] = spec.split(' ');
        if (h && !hint) hint = h;
        if (name.startsWith('--')) longKeys.push(name.replace(/^--/, '').replace(/-/g, '_'));
      }
      const key = (knownKeys && longKeys.find((k) => knownKeys.has(k))) || longKeys[0] || specs[0].replace(/^-/, '');
      cur = { key, category, hint, descr: (optMatch[2] || '').trim() };
      out.push(cur);
      continue;
    }
    if (/^[^\s].*:$/.test(line) && !line.startsWith(' ')) {
      category = line.slice(0, -1).trim();
      if (category === 'Misc options') category = 'Misc';
      cur = undefined;
      continue;
    }
    if (cur && line.startsWith('   ')) {
      cur.descr = cur.descr ? cur.descr + ' ' + line.trim() : line.trim();
    }
  }
  return out;
}

const FILAMENT_SCALAR_KEYS = new Set([
  'compatible_printers',
  'compatible_printers_condition',
  'compatible_prints',
  'compatible_prints_condition',
  'inherits',
  'filament_vendor',
  'filament_settings_id',
]);

function humanize(key: string): string {
  return key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

function deriveOption(raw: RawHelpOption, presetTypes: PresetType[]): OptionDef {
  const descr = raw.descr;
  let tooltip = descr;
  let def = '';
  let enumValues: string[] | undefined;
  let sidetext: string | undefined;
  // Trailing "(sidetext, default: X)" / "(a, b, c; default: X)" / "(default: X)".
  // The sidetext may itself contain parentheses, e.g. "((minimum), default: 3)", so find the
  // balanced opening parenthesis of the trailing block instead of using a simple regex.
  let m: { index: number; prefix: string; def: string } | undefined;
  const trimmed = descr.trimEnd();
  if (trimmed.endsWith(')')) {
    let depth = 0;
    let start = -1;
    for (let i = trimmed.length - 1; i >= 0; i--) {
      const c = trimmed[i];
      if (c === ')') depth++;
      else if (c === '(') {
        depth--;
        if (depth === 0) {
          start = i;
          break;
        }
      }
    }
    if (start >= 0) {
      const inner = trimmed.slice(start + 1, -1);
      const di = inner.lastIndexOf('default: ');
      if (di >= 0) m = { index: start, prefix: inner.slice(0, di), def: inner.slice(di + 'default: '.length) };
    }
  }
  if (m) {
    def = m.def;
    const prefix = m.prefix.trim();
    if (prefix.endsWith(';')) {
      enumValues = prefix
        .slice(0, -1)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (prefix.endsWith(',')) {
      sidetext = prefix.slice(0, -1).trim();
    }
    tooltip = descr.slice(0, m.index).trim();
  }

  const known = KNOWN_OPTIONS[raw.key] || {};
  const isFilament = presetTypes.includes('filament') && !FILAMENT_SCALAR_KEYS.has(raw.key);
  const isPrinterVector = presetTypes.includes('printer') && PRINTER_VECTOR_KEYS.has(raw.key);
  const isPrintVector = presetTypes.includes('print') && PRINT_VECTOR_KEYS.has(raw.key);
  const vector = known.vector ?? (isFilament || isPrinterVector || isPrintVector);

  let scalar: OptionType;
  if (known.type) {
    scalar = known.type;
  } else if (enumValues && enumValues.length) {
    scalar = 'enum';
  } else if (raw.hint === 'N') {
    if (def.includes('%')) scalar = 'float_or_percent';
    else if (/^-?\d+$/.test(def.split(',')[0] || '')) scalar = 'int';
    else scalar = 'float';
  } else if (raw.hint === 'ABCD') {
    scalar = 'string';
  } else if (raw.hint === 'X,Y') {
    scalar = 'point';
  } else if (raw.hint === 'X,Y,Z') {
    scalar = 'point3';
  } else if (def === '' && !m) {
    scalar = 'bool';
  } else if (/^-?\d+(\.\d+)?%(,-?\d+(\.\d+)?%)*$/.test(def)) {
    scalar = 'percent';
  } else if (/^(0|1)(,(0|1))*$/.test(def)) {
    scalar = 'bool';
  } else if (/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?)*$/.test(def)) {
    scalar = /^-?\d+(,-?\d+)*$/.test(def) ? 'int' : 'float';
  } else {
    scalar = 'string';
  }

  let type: OptionType = scalar;
  if (vector && !known.type) {
    const map: Partial<Record<OptionType, OptionType>> = {
      float: 'floats',
      int: 'ints',
      bool: 'bools',
      string: 'strings',
      percent: 'percents',
      float_or_percent: 'floats_or_percents',
      point: 'points',
    };
    type = map[scalar] || scalar;
  }
  if (raw.key === 'bed_shape' || raw.key === 'thumbnails') type = raw.key === 'bed_shape' ? 'points' : 'string';
  if (known.type) type = known.type;
  // Booleans print no default in the CLI help; an empty value is rejected by the slicer.
  if (def === '' && (type === 'bool' || type === 'bools')) def = '0';
  if (def === '' && (type === 'float' || type === 'int' || type === 'floats' || type === 'ints')) def = '0';

  const gcode = known.gcode ?? (/gcode$/.test(raw.key) && type !== 'bool' && raw.key !== 'binary_gcode');
  return {
    key: raw.key,
    label: known.label || humanize(raw.key),
    tooltip,
    category: raw.category,
    type,
    default: def,
    enumValues,
    enumLabels: known.enumLabels,
    sidetext: known.sidetext ?? sidetext,
    mode: known.mode,
    presetTypes,
    perExtruder:
      vector &&
      (presetTypes.includes('filament') || PRINTER_STRING_VECTOR_KEYS.has(raw.key) || PRINTER_VECTOR_KEYS.has(raw.key)) &&
      !raw.key.startsWith('machine_'),
    nullable:
      known.nullable ??
      (raw.key.startsWith('filament_retract') ||
        raw.key.startsWith('filament_travel') ||
        raw.key === 'filament_wipe' ||
        raw.key === 'filament_deretract_speed'),
    multiline: known.multiline ?? (gcode || /notes$/.test(raw.key) || raw.key === 'filament_ramming_parameters'),
    gcode,
    technology: 'any',
  };
}

/** Build the schema from the slicer help, the vendor bundle key sets and the curated layout. */
export function buildSchema(helpFff: string, helpSla: string, version: string, bundleKeys: Record<PresetType, Set<string>>): Schema {
  const known = new Set<string>();
  for (const t of Object.keys(bundleKeys) as PresetType[]) for (const k of bundleKeys[t]) known.add(k);
  const rawFff = parseHelp(helpFff, known);
  const rawSla = parseHelp(helpSla, known);
  const rawByKey = new Map<string, RawHelpOption>();
  for (const r of [...rawFff, ...rawSla]) if (!rawByKey.has(r.key) && !SHORTCUT_KEYS.has(r.key)) rawByKey.set(r.key, r);

  const fffKeys = new Set(rawFff.map((r) => r.key));
  const slaKeys = new Set(rawSla.map((r) => r.key));

  // Determine preset type membership
  const presetKeys: Record<PresetType, string[]> = {
    print: [],
    filament: [],
    printer: [],
    sla_print: [],
    sla_material: [],
  };
  const options: Record<string, OptionDef> = {};
  const assigned = new Set<string>();
  for (const t of ['print', 'filament', 'printer', 'sla_print', 'sla_material'] as PresetType[]) {
    for (const k of bundleKeys[t]) {
      if (!rawByKey.has(k)) continue;
      presetKeys[t].push(k);
      assigned.add(k);
    }
  }
  // Fallback classification for keys not seen in bundles
  for (const r of rawByKey.values()) {
    if (assigned.has(r.key)) continue;
    const k = r.key;
    const known = KNOWN_OPTIONS[k];
    let t: PresetType | undefined = known?.presetType;
    if (!t) {
      if (slaKeys.has(k) && !fffKeys.has(k)) {
        t =
          k.startsWith('material_') || /^(initial_)?exposure_time$/.test(k) || k.startsWith('sla_material') ? 'sla_material' : 'sla_print';
      } else if (
        /^(filament_|start_filament|end_filament|temperature|first_layer_temperature|bed_temperature|first_layer_bed_temperature|fan_|min_fan|max_fan|bridge_fan|disable_fan|full_fan|cooling|slowdown_|min_print_speed|extrusion_multiplier|idle_temperature|chamber_|enable_dynamic_fan|overhang_fan)/.test(
          k,
        )
      ) {
        t = 'filament';
      } else if (
        /^(machine_|retract_|deretract_|wipe$|nozzle_|extruder_offset|extruder_colour|min_layer_height|max_layer_height|bed_shape|max_print_height|z_offset|gcode_flavor|start_gcode|end_gcode|before_layer_gcode|layer_gcode|toolchange_gcode|between_objects_gcode|color_change_gcode|pause_print_gcode|template_custom_gcode|use_|single_extruder|variable_layer|printer_|silent_mode|remaining_times|thumbnails|binary_gcode|cooling_tube|parking_pos|extra_loading|high_current|travel_|autoemit|prefer_clockwise|host_type|print_host|printhost)/.test(
          k,
        )
      ) {
        t = 'printer';
      } else {
        t = 'print';
      }
    }
    presetKeys[t].push(k);
  }
  for (const t of Object.keys(presetKeys) as PresetType[]) presetKeys[t].sort();

  const typesByKey = new Map<string, PresetType[]>();
  for (const t of Object.keys(presetKeys) as PresetType[]) {
    for (const k of presetKeys[t]) typesByKey.set(k, [...(typesByKey.get(k) || []), t]);
  }
  for (const r of rawByKey.values()) {
    options[r.key] = deriveOption(r, typesByKey.get(r.key) || ['print']);
    const inFff = fffKeys.has(r.key);
    const inSla = slaKeys.has(r.key);
    options[r.key].technology = inFff && inSla ? 'any' : inSla ? 'SLA' : 'FFF';
  }

  // Layout: curated FFF layout filtered to existing keys + "Other" pages for leftovers.
  const layout: TabLayout[] = [];
  // Keys placed in any curated tab are never repeated as "Other options" of another tab
  // (vendor bundles sometimes carry print options in printer sections).
  const placedAnywhere = new Set<string>();
  for (const tab of LAYOUT_FFF)
    for (const page of tab.pages) for (const g of page.groups) for (const k of g.keys) if (options[k]) placedAnywhere.add(k);
  for (const tab of LAYOUT_FFF) {
    const used = new Set<string>(placedAnywhere);
    const pages: LayoutPage[] = [];
    for (const page of tab.pages) {
      const groups: LayoutGroup[] = [];
      for (const g of page.groups) {
        const keys = g.keys.filter((k) => options[k] && options[k].presetTypes.includes(tab.presetType));
        keys.forEach((k) => used.add(k));
        if (keys.length) groups.push({ title: g.title, keys });
      }
      if (groups.length) pages.push({ title: page.title, groups });
    }
    const leftovers = presetKeys[tab.presetType].filter((k) => !used.has(k) && !HIDDEN_KEYS.has(k));
    if (leftovers.length) {
      const byCat = new Map<string, string[]>();
      for (const k of leftovers) {
        const c = options[k].category || 'Misc';
        byCat.set(c, [...(byCat.get(c) || []), k]);
      }
      pages.push({
        title: 'Other options',
        groups: [...byCat.entries()].map(([title, keys]) => ({ title, keys })),
      });
    }
    layout.push({ presetType: tab.presetType, title: tab.title, pages });
  }
  // SLA tabs: automatic layout by help category
  for (const t of ['sla_print', 'sla_material'] as PresetType[]) {
    const keys = presetKeys[t].filter((k) => !HIDDEN_KEYS.has(k));
    if (!keys.length) continue;
    const byCat = new Map<string, string[]>();
    for (const k of keys) {
      const c = options[k].category || 'Misc';
      byCat.set(c, [...(byCat.get(c) || []), k]);
    }
    layout.push({
      presetType: t,
      title: t === 'sla_print' ? 'SLA Print Settings' : 'SLA Material Settings',
      pages: [...byCat.entries()].map(([title, ks]) => ({ title, groups: [{ title, keys: ks }] })),
    });
  }

  return { slicerVersion: version, options, layout, presetKeys };
}

/** Keys that are managed by the application and never shown as editable options */
export const HIDDEN_KEYS = new Set([
  'inherits',
  'print_settings_id',
  'filament_settings_id',
  'printer_settings_id',
  'sla_print_settings_id',
  'sla_material_settings_id',
  'physical_printer_settings_id',
  'printer_technology',
  'printer_model',
  'printer_variant',
  'printer_vendor',
  'filament_vendor',
  'default_print_profile',
  'default_filament_profile',
  'default_sla_print_profile',
  'default_sla_material_profile',
  'host_type',
  'print_host',
  'printhost_apikey',
  'printhost_cafile',
  'printhost_port',
  'printhost_user',
  'printhost_password',
  'printhost_authorization_type',
  'wiping_volumes_matrix',
  'wiping_volumes_extruders',
  'wiping_volumes_use_custom_matrix',
  'bed_custom_model',
  'bed_custom_texture',
  'thumbnails',
  'thumbnails_format',
  'gcode_substitutions',
  'filament_ramming_parameters',
  'colorprint_heights',
  'custom_parameters_filament',
  'custom_parameters_print',
  'custom_parameters_printer',
  'preset_name',
  'preset_names',
  'duplicate_distance',
  'extruder',
  'solid_layers',
  'solid_min_thickness',
  'after_layer_gcode',
]);

let schemaCache: Schema | undefined;

export async function getSchema(bundleKeys: Record<PresetType, Set<string>>): Promise<Schema> {
  if (schemaCache) return schemaCache;
  const version = await getSlicerVersion();
  const cacheFile = path.join(config.cacheDir, `schema-${version.replace(/[^A-Za-z0-9.+-]/g, '_')}.json`);
  try {
    if (fs.existsSync(cacheFile)) {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as { fff: string; sla: string };
      schemaCache = buildSchema(cached.fff, cached.sla, version, bundleKeys);
      return schemaCache;
    }
  } catch {
    /* rebuild */
  }
  const fff = await getHelpText('fff');
  let sla = '';
  try {
    sla = await getHelpText('sla');
  } catch {
    sla = '';
  }
  try {
    fs.mkdirSync(config.cacheDir, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify({ fff, sla }));
  } catch {
    /* ignore */
  }
  schemaCache = buildSchema(fff, sla, version, bundleKeys);
  return schemaCache;
}

export function resetSchemaCache() {
  schemaCache = undefined;
}
