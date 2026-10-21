/**
 * Merge print + printer + filament presets into one flat PrusaSlicer config.
 *
 * Pure: schema and request in, an INI section out. Both the REST export routes and the job runner
 * use it, and the 3MF writer takes its result as the project config.
 */
import { escapeStringsCstyle, splitVector, unescapeStringsCstyle, type Schema, type SliceRequest } from '@webslicer/shared';
import type { IniSection } from '../slicer/ini.js';
import { SERVER_ONLY_KEYS } from './serverOnly.js';

/**
 * Merge print + printer + filament presets into one flat PrusaSlicer config.
 * Filament options are per-extruder vectors; one filament preset per extruder.
 *
 * The server-only keys (SEC-1) are dropped here and not at the call sites: this is the one place
 * every path to the slicer goes through – the REST slice route, the project slice, the MCP `slice`
 * tool, the 3MF and config exports and the autosave – so a new caller cannot forget the rule.
 */
export function mergeConfigs(schema: Schema, req: SliceRequest, opts: { forProject?: boolean } = {}): IniSection {
  const merged: IniSection = {};
  const skip = new Set([
    'inherits',
    'compatible_printers',
    'compatible_printers_condition',
    'compatible_prints',
    'compatible_prints_condition',
    ...SERVER_ONLY_KEYS,
  ]);
  // Printer first, then print: a few keys occur in both preset types in vendor bundles
  // (e.g. elefant_foot_compensation on SLA printers) and the print preset owns them.
  for (const [k, v] of Object.entries(req.printer.config)) if (!skip.has(k)) merged[k] = v;
  for (const [k, v] of Object.entries(req.print.config)) if (!skip.has(k)) merged[k] = v;

  const nExtruders = Math.max(1, splitVector(req.printer.config.nozzle_diameter || '0.4').length);
  const filaments = req.filaments.length ? req.filaments : [{ name: '- default FFF -', config: {} }];
  while (filaments.length < nExtruders) filaments.push(filaments[filaments.length - 1]);
  const filamentKeys = new Set<string>();
  for (const f of filaments) for (const k of Object.keys(f.config)) filamentKeys.add(k);
  for (const k of filamentKeys) {
    if (skip.has(k)) continue;
    const opt = schema.options[k];
    const isStrings = opt?.type === 'strings' || k === 'filament_settings_id';
    const vector = opt ? ['floats', 'ints', 'bools', 'strings', 'percents', 'floats_or_percents', 'points'].includes(opt.type) : true;
    if (!vector) {
      merged[k] = filaments[0].config[k] ?? '';
      continue;
    }
    const values = filaments.slice(0, nExtruders).map((f) => {
      const raw = f.config[k] ?? opt?.default ?? '';
      if (isStrings) return unescapeStringsCstyle(raw)[0] ?? '';
      return splitVector(raw)[0] ?? '';
    });
    merged[k] = isStrings ? escapeStringsCstyle(values) : values.join(',');
  }
  merged.print_settings_id = req.print.name;
  merged.printer_settings_id = req.printer.name;
  merged.filament_settings_id = escapeStringsCstyle(filaments.slice(0, nExtruders).map((f) => f.name));
  if (!merged.printer_technology) merged.printer_technology = 'FFF';
  // Slicing honours the UI choice (ASCII by default for the preview); a project keeps the preset value.
  if (merged.binary_gcode !== undefined && !opts.forProject) merged.binary_gcode = req.binaryGcode ? '1' : '0';
  return merged;
}
