/**
 * One option definition from one parsed help entry: value type and default from the help text and
 * its type hint, labels and flags from the curated `KNOWN_OPTIONS`, extruder-vector rules from the
 * key sets.
 */
import { KNOWN_OPTIONS, PRINT_VECTOR_KEYS, PRINTER_STRING_VECTOR_KEYS, PRINTER_VECTOR_KEYS } from './layout/index.js';
import type { RawHelpOption } from './help.js';
import type { OptionDef, OptionType, PresetType } from '@webslicer/shared';

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

export function deriveOption(raw: RawHelpOption, presetTypes: PresetType[]): OptionDef {
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
