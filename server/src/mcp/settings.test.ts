/**
 * MCP tool layer: the setting validation `set_settings` does (scope, key, value, allowlist, band),
 * the dry run `check_settings` shares with it, and the owner scoping that keeps one token's projects
 * invisible to another.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { OptionDef, PresetType, Schema } from '../slicer/schema.js';

// the data directory has to be redirected before anything reads it (config is evaluated once)
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-mcp-tools-'));
process.env.DATA_DIR = DATA_DIR;

const { ensureDirs } = await import('../config.js');
const { applySettings, checkSettings, issueText, scopeOf } = await import('./settings.js');
const { coerceOptionValue } = await import('./optionValues.js');
const { loadOwnedProject } = await import('./projectAccess.js');
const { createProject, loadProject } = await import('../services/projects.js');
type Project = Awaited<ReturnType<typeof createProject>>;

before(() => ensureDirs());
after(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

function opt(key: string, type: OptionDef['type'], presetTypes: PresetType[], extra: Partial<OptionDef> = {}): OptionDef {
  return { key, label: key, tooltip: `${key} tooltip`, category: 'Misc', type, default: '', presetTypes, technology: 'any', ...extra };
}

// categories are the ones the installed PrusaSlicer reports: the allowlist derives from them
const schema = {
  slicerVersion: 'test',
  layout: [],
  presetKeys: {
    print: ['layer_height', 'fill_density', 'infill_pattern', 'perimeters', 'perimeter_speed', 'brim_type', 'start_gcode'],
    filament: ['temperature', 'extrusion_multiplier', 'filament_retract_length'],
    printer: [],
    sla_print: [],
    sla_material: [],
  },
  options: {
    layer_height: opt('layer_height', 'float', ['print'], { category: 'Layers and Perimeters', default: '0.2' }),
    fill_density: opt('fill_density', 'percent', ['print'], { category: 'Infill', default: '20%' }),
    infill_pattern: opt('infill_pattern', 'enum', ['print'], { category: 'Infill', enumValues: ['grid', 'gyroid'], default: 'grid' }),
    support_material: opt('support_material', 'bool', ['print'], { category: 'Support material', default: '0' }),
    brim_type: opt('brim_type', 'enum', ['print'], {
      category: 'Skirt and brim',
      enumValues: ['no_brim', 'outer_only'],
      default: 'no_brim',
    }),
    perimeters: opt('perimeters', 'int', ['print'], { category: 'Layers and Perimeters', default: '3' }),
    perimeter_speed: opt('perimeter_speed', 'int', ['print'], { category: 'Speed', default: '60' }),
    print_notes: opt('print_notes', 'string', ['print'], { category: 'Misc' }),
    start_gcode: opt('start_gcode', 'string', ['print'], { category: 'Layers and Perimeters', multiline: true, gcode: true }),
    nozzle_diameter: opt('nozzle_diameter', 'floats', ['printer'], { category: 'Extruders', default: '0.4' }),
    temperature: opt('temperature', 'ints', ['filament'], { category: 'Misc', default: '215' }),
    extrusion_multiplier: opt('extrusion_multiplier', 'floats', ['filament'], { category: 'Misc', default: '1' }),
    filament_retract_length: opt('filament_retract_length', 'floats', ['filament'], { category: 'Misc', default: '2' }),
    filament_notes: opt('filament_notes', 'string', ['filament'], { category: 'Misc' }),
  },
} as never as Schema;

const DEFAULT_PRINTER = '- default FFF -';
const DEFAULT_PRINT = '- default FFF -';

const newProject = (owner?: string) =>
  createProject({ schema, printer: { name: DEFAULT_PRINTER, config: {} }, print: { name: DEFAULT_PRINT, config: {} }, owner });

test('scope names map to a preset type and a filament index', () => {
  assert.deepEqual(scopeOf('print'), { type: 'print', index: 0 });
  assert.deepEqual(scopeOf(' printer '), { type: 'printer', index: 0 });
  assert.deepEqual(scopeOf('filament'), { type: 'filament', index: 0 });
  assert.deepEqual(scopeOf('filament[2]'), { type: 'filament', index: 2 });
  for (const bad of ['filaments', 'fill_density', 'filament[x]', 'printer[0]', '']) {
    assert.throws(() => scopeOf(bad), /scope must be/);
  }
});

test('set_settings rejects unknown keys, wrong preset types and invalid values', () => {
  assert.throws(() => coerceOptionValue(schema, 'print', 'no_such_option', '1'), /Unknown option/);
  assert.throws(() => coerceOptionValue(schema, 'print', 'temperature', '200'), /not a print preset option/);
  assert.throws(() => coerceOptionValue(schema, 'filament', 'layer_height', '0.2'), /not a filament preset option/);

  assert.throws(() => coerceOptionValue(schema, 'print', 'fill_density', 'lots'), /percents may end/);
  assert.throws(() => coerceOptionValue(schema, 'print', 'layer_height', 'thin'), /expects a number/);
  assert.throws(() => coerceOptionValue(schema, 'print', 'perimeters', '1.5'), /expects an integer/);
  assert.throws(() => coerceOptionValue(schema, 'print', 'brim_type', 'inside'), /must be one of: no_brim, outer_only/);
  assert.throws(() => coerceOptionValue(schema, 'print', 'support_material', 'maybe'), /expects 0\/1/);
  assert.throws(() => coerceOptionValue(schema, 'print', 'print_notes', '   '), /needs a value/);

  assert.equal(coerceOptionValue(schema, 'print', 'layer_height', '0.25'), '0.25');
  assert.equal(coerceOptionValue(schema, 'print', 'fill_density', '30%'), '30%');
  assert.equal(coerceOptionValue(schema, 'print', 'fill_density', '30'), '30');
  assert.equal(coerceOptionValue(schema, 'print', 'brim_type', 'outer_only'), 'outer_only');
  assert.equal(coerceOptionValue(schema, 'print', 'support_material', true), '1');
  assert.equal(coerceOptionValue(schema, 'print', 'support_material', false), '0');
  assert.equal(coerceOptionValue(schema, 'print', 'support_material', 'true'), '1');
  assert.equal(coerceOptionValue(schema, 'printer', 'nozzle_diameter', '0.4,0.4'), '0.4,0.4');
  assert.equal(coerceOptionValue(schema, 'print', 'print_notes', 'hello'), 'hello');
});

test('set_settings refuses the server-only keys instead of dropping them quietly (SEC-1)', () => {
  schema.options.post_process = opt('post_process', 'strings', ['print'], { category: 'Infill' });
  schema.options.output_filename_format = opt('output_filename_format', 'string', ['print'], { category: 'Infill' });
  try {
    // the refusal names the key and the reason, so a model learns the rule from the answer
    assert.throws(
      () => coerceOptionValue(schema, 'print', 'post_process', 'touch /tmp/x'),
      /"post_process" cannot be set: .*command on the server/,
    );
    assert.throws(
      () => coerceOptionValue(schema, 'print', 'output_filename_format', 'x.gcode'),
      /"output_filename_format" cannot be set: .*job directory/,
    );
  } finally {
    delete schema.options.post_process;
    delete schema.options.output_filename_format;
  }
});

test('applySettings writes the overrides into the right slot', async () => {
  const project = await newProject();
  assert.deepEqual(applySettings(schema, project, 'print', { fill_density: '30%', infill_pattern: 'gyroid' }), {
    fill_density: '30%',
    infill_pattern: 'gyroid',
  });
  assert.deepEqual(project.print.config, { fill_density: '30%', infill_pattern: 'gyroid' });

  // the printer scope is closed for MCP (S1-a): even a schema-valid printer key is refused
  assert.throws(() => applySettings(schema, project, 'printer', { nozzle_diameter: '0.6' }), /Printer options cannot be set/);
  assert.deepEqual(project.printer.config, {});

  // filament[1] grows the list and leaves the first extruder alone
  assert.equal(project.filaments.length, 1);
  applySettings(schema, project, 'filament[1]', { temperature: '225' });
  assert.equal(project.filaments.length, 2);
  assert.deepEqual(project.filaments[0].config, {});
  assert.deepEqual(project.filaments[1].config, { temperature: '225' });
  assert.equal(project.filaments[1].name, project.filaments[0].name);

  // an invalid value in a batch changes nothing at all
  assert.throws(() => applySettings(schema, project, 'print', { layer_height: '0.3', brim_type: 'nope' }), /must be one of/);
  assert.deepEqual(project.print.config, { fill_density: '30%', infill_pattern: 'gyroid' });
  assert.throws(() => applySettings(schema, project, 'print', {}), /must not be empty/);
});

test('the allowlist refuses printer, G-code and text keys with a reason', async () => {
  const project = await newProject();
  assert.throws(() => applySettings(schema, project, 'print', { start_gcode: 'G28' }), /G-code and script/);
  assert.throws(() => applySettings(schema, project, 'print', { print_notes: 'hello' }), /Text and coordinate/);
  assert.throws(() => applySettings(schema, project, 'filament', { filament_notes: 'hello' }), /Text and coordinate/);
  assert.throws(() => applySettings(schema, project, 'printer', { nozzle_diameter: '0.6' }), /Printer options/);
  assert.deepEqual(project.print.config, {});
  assert.deepEqual(project.filaments[0].config, {});
});

test('one failing key rejects the whole call and every issue is listed', async () => {
  const project = await newProject();
  const message = refusalOf('print', { fill_density: '30%', start_gcode: 'G28', layer_height: 'thin' }, project);
  assert.match(message, /nothing was changed/);
  assert.match(message, /start_gcode: G28 – G-code and script options cannot be set through MCP/);
  assert.match(message, /layer_height: thin – Option "layer_height" expects a number/);
  assert.deepEqual(project.print.config, {}, 'the valid fill_density in the same call is not applied either');

  const check = checkSettings(schema, project, 'print', { fill_density: '30%', start_gcode: 'G28' });
  assert.equal(check.issues.length, 1);
  assert.deepEqual(check.changed, {}, 'a dry run reports no changes when any key fails');
  assert.match(issueText(check.issues), /start_gcode: G28/);
});

test('the band rejects a temperature 40 °C away and accepts 20 °C (S1-a)', async () => {
  const project = await newProject();
  // the preset default is 215 °C, so 255 is outside ±25 and 235 inside
  assert.throws(() => applySettings(schema, project, 'filament', { temperature: '255' }), /outside the band.*190–240 °C/);
  assert.deepEqual(project.filaments[0].config, {});
  assert.deepEqual(applySettings(schema, project, 'filament', { temperature: '235' }), { temperature: '235' });
});

test('the band stays anchored to the preset, so repeated calls cannot ratchet a value out', async () => {
  const project = await newProject();
  // 215 -> 240 is inside, but 240 -> 265 must fail: the band is measured against the preset 215,
  // not against the override the previous call wrote
  assert.deepEqual(applySettings(schema, project, 'filament', { temperature: '240' }), { temperature: '240' });
  assert.throws(() => applySettings(schema, project, 'filament', { temperature: '265' }), /outside the band.*190–240 °C/);
  assert.deepEqual(project.filaments[0].config, { temperature: '240' }, 'the refused step changed nothing');
});

test('check_settings reports ok without changing the project', async () => {
  const project = await newProject();
  const ok = checkSettings(schema, project, 'filament', { temperature: '235' });
  assert.deepEqual(ok.issues, []);
  assert.deepEqual(ok.changed, { temperature: '235' });
  assert.deepEqual(project.filaments[0].config, {}, 'a dry run writes nothing');

  const bad = checkSettings(schema, project, 'filament', { temperature: '300' });
  assert.equal(bad.issues[0]?.key, 'temperature');
  assert.match(bad.issues[0].allowed, /190–240 °C/);
});

test('set_settings also reports the global limits, and the S1-a bands stay as they are (S1-d)', async () => {
  const project = await newProject();
  // the test schema has no filament_type, so no soft range fires – but a value that is a typo and
  // still inside the band (a preset of 0 has no band, see mcpBandIssue) is caught by the limit
  const inBandTypo = checkSettings(schema, project, 'filament', { temperature: '215' });
  assert.deepEqual(inBandTypo.issues, [], '215 °C is a normal value');

  // the print scope checks layer_height against the nozzle: 0 is a typo whatever the band says
  const check = checkSettings(schema, project, 'print', { layer_height: '0' });
  assert.equal(check.issues.length, 1);
  assert.equal(check.issues[0].key, 'layer_height');
  assert.match(check.issues[0].reason, /greater than 0/);
  assert.equal(check.issues[0].scope, 'print');
  assert.deepEqual(check.changed, {}, 'a limit issue rejects the call like a band issue');
  assert.throws(() => applySettings(schema, project, 'print', { layer_height: '0' }), /greater than 0/);

  // a value inside the band and inside the limit is applied as before
  assert.deepEqual(applySettings(schema, project, 'print', { layer_height: '0.24' }), { layer_height: '0.24' });
});

test('a project is only visible to the owner of the token', async () => {
  const mine = await newProject('robert');
  const other = await newProject('haus');

  assert.equal((await loadOwnedProject(mine.id, 'robert')).id, mine.id);
  const err = await loadOwnedProject(mine.id, 'haus').then(
    () => undefined,
    (e: Error & { status?: number }) => e,
  );
  assert.equal(err?.message, `Project "${mine.id}" not found`);
  assert.equal(err?.status, 404, 'a foreign project is not even admitted to exist');

  await assert.rejects(() => loadOwnedProject(other.id, 'robert'), /not found/);
  await assert.rejects(() => loadOwnedProject('not-a-uuid', 'robert'), /not found/);
  await assert.rejects(() => loadOwnedProject(undefined, 'robert'), /not found/);
  assert.ok(await loadProject(mine.id), 'the projects are still on disk');
});

/** The message of the ValidationError `applySettings` throws for a refused call. */
function refusalOf(scope: string, values: Record<string, string>, project: Project): string {
  try {
    applySettings(schema, project, scope, values);
  } catch (e) {
    return (e as Error).message;
  }
  assert.fail('the call should have been refused');
}
