/**
 * The option schema: classifies every option the installed slicer knows into preset types, derives
 * its definition (`optionDef.ts`) from the parsed help (`help.ts`) and filters the curated layout
 * tables down to a tab tree. Also owns the on-disk help cache.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getHelpText, getSlicerVersion } from './cli.js';
import { LAYOUT_FFF, KNOWN_OPTIONS } from './layout/index.js';
import { parseHelp, SHORTCUT_KEYS, type RawHelpOption } from './help.js';
import { deriveOption } from './optionDef.js';
import type { LayoutGroup, LayoutPage, OptionDef, PresetType, Schema, TabLayout } from '@webslicer/shared';

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
