/**
 * Offline test of the help parser / bundle loader against captured slicer output.
 * Run: WEBSLICER_FIXTURES=<dir with help-fff.txt, help-sla.txt, profiles/> npx tsx server/src/slicer/schema.test.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHelp, buildSchema } from './schema.js';
import { parseBundle } from './bundles.js';
import { evaluateCondition } from './condition.js';
import { escapeStringsCstyle, unescapeStringsCstyle } from '@webslicer/shared';

const fixtures = process.env.WEBSLICER_FIXTURES;

test('cstyle string vectors roundtrip (now from @webslicer/shared)', () => {
  const v = ['M900 K0.2 ; LA\n', 'plain', '', 'has "quote"'];
  assert.deepEqual(unescapeStringsCstyle(escapeStringsCstyle(v)), v);
  assert.deepEqual(unescapeStringsCstyle('#FF8000;#00FF00'), ['#FF8000', '#00FF00']);
  assert.deepEqual(unescapeStringsCstyle('""'), ['']);
});

test('condition evaluator', () => {
  const cfg: Record<string, string> = {
    printer_notes: 'PRINTER_VENDOR_PRUSA3D\nPRINTER_MODEL_MK4IS\nPG',
    nozzle_diameter: '0.4,0.4',
    printer_model: 'MK4IS',
    single_extruder_multi_material: '0',
  };
  const l = (k: string) => cfg[k];
  assert.equal(evaluateCondition('printer_notes=~/.*PRINTER_VENDOR_PRUSA3D.*/ and nozzle_diameter[0]==0.4', l), true);
  assert.equal(evaluateCondition('nozzle_diameter[0]!=0.4', l), false);
  assert.equal(evaluateCondition('printer_model=="MK4IS" and num_extruders>1', l), true);
  assert.equal(evaluateCondition('! (printer_notes=~/.*PG.*/)', l), false);
  assert.equal(evaluateCondition('printer_model=~/^(MK4IS|MK4S)$/ or single_extruder_multi_material==1', l), true);
  // "=~" is a full match in PrusaSlicer (boost::regex_match): MK4 must not match MK4S
  assert.equal(evaluateCondition('printer_model=~/(MK4|MK3.9)/', l), false);
  assert.equal(evaluateCondition('printer_model=~/(MK4S|MK4IS)/', l), true);
  assert.equal(evaluateCondition('printer_notes=~/.*PRINTER_MODEL_MK4IS.*/', l), true);
  assert.equal(evaluateCondition('', l), true);
  assert.equal(evaluateCondition('this is not valid (', l), true);
});

test('help parser and schema (fixtures)', { skip: !fixtures }, () => {
  const fff = fs.readFileSync(path.join(fixtures!, 'help-fff.txt'), 'utf8');
  const sla = fs.readFileSync(path.join(fixtures!, 'help-sla.txt'), 'utf8');
  const raw = parseHelp(fff);
  assert.ok(raw.length > 300, `parsed ${raw.length} options`);
  const byKey = new Map(raw.map((r) => [r.key, r]));
  assert.ok(byKey.has('layer_height'));
  assert.ok(byKey.has('fill_density'));
  assert.ok(byKey.has('start_gcode'));
  assert.equal(byKey.get('nozzle_diameter')?.hint, 'N');

  const keys = { print: new Set<string>(), filament: new Set<string>(), printer: new Set<string>(), sla_print: new Set<string>(), sla_material: new Set<string>() };
  const profiles = path.join(fixtures!, 'profiles');
  let presetCount = 0;
  for (const f of fs.readdirSync(profiles).filter((x) => x.endsWith('.ini'))) {
    const { presets } = parseBundle(path.join(profiles, f), fs.readFileSync(path.join(profiles, f), 'utf8'));
    presetCount += presets.length;
    for (const p of presets) for (const k of Object.keys(p.config)) keys[p.type].add(k);
  }
  assert.ok(presetCount > 500, `presets ${presetCount}`);
  const schema = buildSchema(fff, sla, 'test', keys);
  const o = schema.options;
  assert.equal(o.layer_height.type, 'float');
  assert.equal(o.perimeters.type, 'int');
  assert.equal(o.perimeters.default, '3');
  assert.equal(o.perimeters.sidetext, '(minimum)');
  assert.equal(o.fill_density.default, '20%');
  assert.equal(o.thick_bridges.default, '0');
  assert.equal(o.fill_density.type, 'percent');
  assert.equal(o.seam_position.type, 'enum');
  assert.ok(o.seam_position.enumValues?.includes('aligned'));
  assert.equal(o.thick_bridges.type, 'bool');
  assert.equal(o.nozzle_diameter.type, 'floats');
  assert.equal(o.wipe.type, 'bools');
  assert.equal(o.temperature.type, 'ints');
  assert.equal(o.filament_colour.type, 'strings');
  assert.equal(o.start_filament_gcode.type, 'strings');
  assert.equal(o.start_gcode.type, 'string');
  assert.equal(o.bed_shape.type, 'points');
  // "--after-layer-gcode, --layer-gcode" is one option; the bundle key decides the canonical name
  assert.ok(o.layer_gcode, 'layer_gcode present');
  assert.ok(!o.after_layer_gcode, 'legacy alias dropped');
  assert.ok(!o.solid_layers && !o.extruder, 'shortcut keys dropped');
  assert.ok(schema.presetKeys.printer.includes('layer_gcode'));
  assert.ok(!schema.presetKeys.print.includes('solid_layers'));
  assert.ok(schema.presetKeys.print.includes('layer_height'));
  assert.ok(schema.presetKeys.filament.includes('temperature'));
  assert.ok(schema.presetKeys.printer.includes('nozzle_diameter'));
  const printTab = schema.layout.find((t) => t.presetType === 'print')!;
  const other = printTab.pages.find((p) => p.title === 'Other options');
  console.log('print tab pages:', printTab.pages.map((p) => `${p.title}(${p.groups.reduce((a, g) => a + g.keys.length, 0)})`).join(', '));
  console.log('print leftovers:', other?.groups.flatMap((g) => g.keys).join(', '));
  for (const t of ['filament', 'printer'] as const) {
    const tab = schema.layout.find((x) => x.presetType === t)!;
    const lo = tab.pages.find((p) => p.title === 'Other options');
    console.log(`${t} leftovers:`, lo?.groups.flatMap((g) => g.keys).join(', '));
  }
});

test('bundle inheritance + compatibility (fixtures)', { skip: !fixtures }, () => {
  const file = path.join(fixtures!, 'profiles', 'PrusaResearch.ini');
  const { vendor, presets } = parseBundle(file, fs.readFileSync(file, 'utf8'));
  assert.ok(vendor.models.length > 10);
  const printers = presets.filter((p) => p.type === 'printer');
  const mk4s = printers.find((p) => p.name === 'Original Prusa MK4S HF0.4 nozzle');
  assert.ok(mk4s, 'MK4S printer preset');
  assert.equal(mk4s!.config.printer_model, 'MK4S');
  assert.ok(mk4s!.config.start_gcode?.length > 50, 'inherited start_gcode');
  assert.ok(!mk4s!.config.inherits);
  const prints = presets.filter((p) => p.type === 'print');
  const compatible = prints.filter((p) => evaluateCondition(p.config.compatible_printers_condition, (k) => mk4s!.config[k]));
  console.log(`MK4S: ${compatible.length}/${prints.length} print presets compatible, e.g. ${compatible.slice(0, 3).map((p) => p.name).join(' | ')}`);
  assert.ok(compatible.length > 3 && compatible.length < prints.length);
  const fil = presets.filter((p) => p.type === 'filament');
  const filOk = fil.filter((p) => evaluateCondition(p.config.compatible_printers_condition, (k) => mk4s!.config[k]));
  console.log(`MK4S: ${filOk.length}/${fil.length} filaments compatible, e.g. ${filOk.slice(0, 3).map((p) => p.name).join(' | ')}`);
  assert.ok(filOk.length > 10 && filOk.length < fil.length);
});
