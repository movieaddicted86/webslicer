/**
 * The MCP safety rules (S1-a, T-025): the allowlist and the bands around the resolved preset value.
 * Pinned here because the server refuses every `set_settings` call against this module.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MCP_ALLOWLIST, mcpAllowlistOf, mcpBandIssue, mcpBandOf, mcpKeyVerdict, mcpSettableScopes } from './mcpPolicy.js';
import type { OptionDef, OptionType, PresetType, Schema } from '../types/index.js';

function opt(key: string, type: OptionType, presetTypes: PresetType[], category = 'Test'): OptionDef {
  return { key, label: key, tooltip: `${key} tooltip`, category, type, default: '', presetTypes, technology: 'any' };
}

const schema = {
  slicerVersion: 'test',
  layout: [],
  presetKeys: { print: [], filament: [], printer: [], sla_print: [], sla_material: [] },
  options: {
    layer_height: opt('layer_height', 'float', ['print'], 'Layers and Perimeters'),
    perimeters: opt('perimeters', 'int', ['print'], 'Layers and Perimeters'),
    fill_density: opt('fill_density', 'percent', ['print'], 'Infill'),
    infill_pattern: opt('infill_pattern', 'enum', ['print'], 'Infill'),
    support_material: opt('support_material', 'bool', ['print'], 'Support material'),
    bottom_fill_pattern: opt('bottom_fill_pattern', 'enum', ['print'], 'Infill'),
    perimeter_speed: opt('perimeter_speed', 'int', ['print'], 'Speed'),
    external_perimeter_speed: opt('external_perimeter_speed', 'float_or_percent', ['print'], 'Speed'),
    skirt_distance: opt('skirt_distance', 'int', ['print'], 'Misc'),
    custom_parameters_print: opt('custom_parameters_print', 'string', ['print'], 'Misc'),
    notes: opt('notes', 'string', ['print'], 'Misc'),
    start_gcode: opt('start_gcode', 'string', ['print'], 'Layers and Perimeters'),
    layer_gcode: opt('layer_gcode', 'strings', ['print'], 'Infill'),
    temperature: opt('temperature', 'ints', ['filament'], 'Misc'),
    first_layer_temperature: opt('first_layer_temperature', 'ints', ['filament'], 'Misc'),
    bed_temperature: opt('bed_temperature', 'ints', ['filament'], 'Misc'),
    extrusion_multiplier: opt('extrusion_multiplier', 'floats', ['filament'], 'Misc'),
    filament_retract_length: opt('filament_retract_length', 'floats', ['filament'], 'Misc'),
    filament_diameter: opt('filament_diameter', 'floats', ['filament'], 'Misc'),
    max_fan_speed: opt('max_fan_speed', 'ints', ['filament'], 'Misc'),
    nozzle_diameter: opt('nozzle_diameter', 'floats', ['printer'], 'Extruders'),
    z_offset: opt('z_offset', 'float', ['printer'], 'Extruders'),
    bed_shape: opt('bed_shape', 'points', ['printer'], 'Extruders'),
    post_process: opt('post_process', 'strings', ['print'], 'Infill'),
  },
} as never as Schema;

test('a process option and a material option are allowed', () => {
  assert.deepEqual(mcpKeyVerdict(schema, 'print', 'layer_height'), { allowed: true });
  assert.deepEqual(mcpKeyVerdict(schema, 'print', 'fill_density'), { allowed: true });
  assert.deepEqual(mcpKeyVerdict(schema, 'print', 'support_material'), { allowed: true });
  assert.deepEqual(mcpKeyVerdict(schema, 'print', 'skirt_distance'), { allowed: true }, 'a reviewed Misc key');
  assert.deepEqual(mcpKeyVerdict(schema, 'filament', 'temperature'), { allowed: true });
  assert.deepEqual(mcpKeyVerdict(schema, 'filament', 'filament_retract_length'), { allowed: true });
  assert.deepEqual(mcpKeyVerdict(schema, 'filament', 'extrusion_multiplier'), { allowed: true });
});

test('the printer scope is closed, whatever the key', () => {
  for (const key of ['nozzle_diameter', 'z_offset', 'bed_shape', 'layer_height']) {
    const verdict = mcpKeyVerdict(schema, 'printer', key);
    assert.equal(verdict.allowed, false, key);
    assert.match(verdict.allowed === false ? verdict.reason : '', /Printer options/);
  }
});

test('G-code, script, text and coordinate options are refused', () => {
  assert.match(refusal('print', 'start_gcode'), /G-code and script/);
  // the real key is a printer option; the G-code rule still answers first, whatever scope asked
  schema.options.real_start_gcode = { ...opt('start_gcode', 'string', ['printer'], 'Misc'), multiline: true, gcode: true };
  try {
    assert.match(refusal('print', 'real_start_gcode'), /G-code and script/);
    assert.match(refusal('filament', 'real_start_gcode'), /G-code and script/);
  } finally {
    delete schema.options.real_start_gcode;
  }
  assert.match(refusal('print', 'layer_gcode'), /G-code and script/, 'any *_gcode key, not only the schema flag');
  assert.match(refusal('print', 'notes'), /Text and coordinate/);
  assert.match(refusal('print', 'custom_parameters_print'), /Text and coordinate/, 'free text the slicer would pass on');
  assert.match(refusal('print', 'post_process'), /cannot be set: .*command on the server/, 'SEC-1 keeps its own reason');
});

test('a process option outside the category list is not on the allowlist', () => {
  // "Test" is no process category and not in the explicit list
  schema.options.unreviewed_print_key = opt('unreviewed_print_key', 'bool', ['print']);
  schema.options.unreviewed_material_key = opt('unreviewed_material_key', 'int', ['filament']);
  try {
    assert.match(refusal('print', 'unreviewed_print_key'), /Not on the MCP allowlist/);
    assert.match(refusal('filament', 'unreviewed_material_key'), /Not on the MCP allowlist/);
  } finally {
    delete schema.options.unreviewed_print_key;
    delete schema.options.unreviewed_material_key;
  }
});

test('the material allowlist has no diameter, cost or density key', () => {
  assert.equal(mcpKeyVerdict(schema, 'filament', 'filament_diameter').allowed, false);
});

test('the explicit allowlist and the derived list agree', () => {
  const print = mcpAllowlistOf(schema, 'print');
  for (const key of MCP_ALLOWLIST) if (schema.options[key]?.presetTypes.includes('print')) assert.ok(print.includes(key), key);
  assert.ok(!print.includes('start_gcode'));
  assert.ok(!print.includes('nozzle_diameter'));
  assert.deepEqual(mcpAllowlistOf(schema, 'printer'), []);
});

test('a key reports the scopes it may be set in, for the option listing', () => {
  assert.deepEqual(mcpSettableScopes(schema, 'layer_height'), ['print']);
  assert.deepEqual(mcpSettableScopes(schema, 'temperature'), ['filament']);
  assert.deepEqual(mcpSettableScopes(schema, 'start_gcode'), []);
  assert.deepEqual(mcpSettableScopes(schema, 'z_offset'), []);
  assert.deepEqual(mcpSettableScopes(schema, 'no_such_option'), []);
});

test('the bands: temperature, speed, extrusion multiplier, retraction', () => {
  assert.deepEqual(mcpBandOf('temperature'), { kind: 'delta', delta: 25, unit: '°C', zeroAllowed: true });
  assert.deepEqual(mcpBandOf('first_layer_bed_temperature'), { kind: 'delta', delta: 25, unit: '°C', zeroAllowed: true });
  assert.deepEqual(mcpBandOf('perimeter_speed'), { kind: 'factor', min: 0.5, max: 1.5, zeroAllowed: true });
  assert.deepEqual(mcpBandOf('extrusion_multiplier'), { kind: 'delta', delta: 0.1, unit: '', zeroAllowed: false });
  assert.deepEqual(mcpBandOf('filament_retract_length'), { kind: 'delta', delta: 1, unit: 'mm', zeroAllowed: true });
  assert.equal(mcpBandOf('max_fan_speed'), undefined, 'a fan speed is a percent of the fan, not a motion speed');
  assert.equal(mcpBandOf('layer_height'), undefined, 'no band – any value the schema accepts');
});

test('temperature: inside, at and outside the band', () => {
  const base = '215';
  assert.equal(mcpBandIssue('temperature', '190', base), undefined, 'exactly -25');
  assert.equal(mcpBandIssue('temperature', '240', base), undefined, 'exactly +25');
  assert.equal(mcpBandIssue('temperature', '215', base), undefined);
  assert.match(mcpBandIssue('temperature', '189', base)?.allowed ?? '', /190–240 °C/);
  assert.match(mcpBandIssue('temperature', '260', base)?.allowed ?? '', /190–240 °C/);
  assert.equal(mcpBandIssue('temperature', '260', base)?.reason, 'outside the band around the preset value');
});

test('speed: absolute values take an absolute band, percent values the same band in percent', () => {
  assert.equal(mcpBandIssue('perimeter_speed', '45', '60'), undefined, '60 × 0.5');
  assert.equal(mcpBandIssue('perimeter_speed', '90', '60'), undefined, '60 × 1.5');
  assert.equal(mcpBandIssue('perimeter_speed', '44', '60'), undefined, 'inside the band');
  assert.match(mcpBandIssue('perimeter_speed', '29', '60')?.allowed ?? '', /30–90/);
  assert.match(mcpBandIssue('perimeter_speed', '91', '60')?.allowed ?? '', /30–90/);
  assert.equal(mcpBandIssue('external_perimeter_speed', '75%', '50%'), undefined);
  assert.match(mcpBandIssue('external_perimeter_speed', '80%', '50%')?.allowed ?? '', /25%–75%/);
  // S8: an absolute value against a percent base (or the reverse) fails closed
  assert.match(mcpBandIssue('perimeter_speed', '75%', '60')?.reason ?? '', /unit mismatch/);
  assert.match(mcpBandIssue('external_perimeter_speed', '60', '50%')?.reason ?? '', /unit mismatch/);
  assert.equal(mcpBandIssue('perimeter_speed', '5', '0'), undefined, 'a preset speed of 0 means auto');
});

test('extrusion multiplier and retraction length', () => {
  assert.equal(mcpBandIssue('extrusion_multiplier', '0.9', '1'), undefined);
  assert.equal(mcpBandIssue('extrusion_multiplier', '1.1', '1'), undefined);
  assert.match(mcpBandIssue('extrusion_multiplier', '1.2', '1')?.allowed ?? '', /0.9–1.1/);
  assert.match(mcpBandIssue('extrusion_multiplier', '0', '1')?.allowed ?? '', /0.9–1.1/, '0 is not "off" for a multiplier');
  assert.equal(mcpBandIssue('filament_retract_length', '3', '2'), undefined);
  assert.equal(mcpBandIssue('filament_retract_length', '0', '2'), undefined, '0 = no retraction stays allowed');
  assert.match(mcpBandIssue('filament_retract_length', '4', '2')?.allowed ?? '', /1–3 mm/);
});

test('per-extruder vectors are compared element by element', () => {
  assert.equal(mcpBandIssue('temperature', '210,225', '215,215'), undefined);
  assert.equal(mcpBandIssue('temperature', '210,240', '215,215'), undefined);
  const issue = mcpBandIssue('temperature', '210,245', '215,215');
  assert.equal(issue?.key, 'temperature[1]', 'the message names the element that failed');
  assert.equal(issue?.value, '245');
  assert.match(issue?.allowed ?? '', /190–240 °C/, 'the band around the second base element');
  assert.equal(mcpBandIssue('temperature', '215,215,215', '215,215'), undefined, 'a third extruder repeats the last base value');
});

test('S8: a band that cannot be computed fails closed', () => {
  // an empty or missing preset value used to wave every value through
  assert.match(mcpBandIssue('temperature', '300', '')?.reason ?? '', /no value for this option/);
  assert.match(mcpBandIssue('temperature', '300', undefined)?.reason ?? '', /no value for this option/);
  // a preset value that is not a number has no band either
  assert.match(mcpBandIssue('temperature', '300', 'auto')?.reason ?? '', /not a number/);
  // and a value the band cannot read is refused as well
  assert.match(mcpBandIssue('temperature', 'hot', '215')?.reason ?? '', /not a number/);
  assert.equal(mcpBandIssue('layer_height', '99', '0.2'), undefined, 'no band for this key – not judged');
});

function refusal(type: PresetType, key: string): string {
  const verdict = mcpKeyVerdict(schema, type, key);
  assert.equal(verdict.allowed, false, `${key} should be refused`);
  return verdict.allowed === false ? verdict.reason : '';
}
