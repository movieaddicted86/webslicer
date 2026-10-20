/**
 * MCP tool layer: the setting validation `set_settings` does (scope, key, value), and the owner
 * scoping that keeps one token's projects invisible to another.
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
const { applySettings, coerceOptionValue, loadOwnedProject, scopeOf } = await import('./tools.js');
const { createProject, loadProject } = await import('../plater/project.js');

before(() => ensureDirs());
after(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

function opt(key: string, type: OptionDef['type'], presetTypes: PresetType[], enumValues?: string[]): OptionDef {
  return { key, label: key, tooltip: `${key} tooltip`, category: 'Test', type, default: '', enumValues, presetTypes, technology: 'any' };
}

const schema = {
  slicerVersion: 'test',
  layout: [],
  presetKeys: { print: [], filament: [], printer: [], sla_print: [], sla_material: [] },
  options: {
    layer_height: opt('layer_height', 'float', ['print']),
    fill_density: opt('fill_density', 'percent', ['print']),
    support_material: opt('support_material', 'bool', ['print']),
    brim_type: opt('brim_type', 'enum', ['print'], ['no_brim', 'outer_only']),
    infill_pattern: opt('infill_pattern', 'enum', ['print'], ['grid', 'gyroid']),
    perimeters: opt('perimeters', 'int', ['print']),
    print_notes: opt('print_notes', 'string', ['print']),
    nozzle_diameter: opt('nozzle_diameter', 'floats', ['printer']),
    temperature: opt('temperature', 'ints', ['filament']),
    filament_notes: opt('filament_notes', 'string', ['filament']),
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

test('applySettings writes the overrides into the right slot', () => {
  const project = newProject();
  assert.deepEqual(applySettings(schema, project, 'print', { fill_density: '30%', infill_pattern: 'gyroid' }), { fill_density: '30%', infill_pattern: 'gyroid' });
  assert.deepEqual(project.print.config, { fill_density: '30%', infill_pattern: 'gyroid' });
  assert.deepEqual(project.printer.config, {});

  applySettings(schema, project, 'printer', { nozzle_diameter: '0.6' });
  assert.deepEqual(project.printer.config, { nozzle_diameter: '0.6' });

  // filament[1] grows the list and leaves the first extruder alone
  assert.equal(project.filaments.length, 1);
  applySettings(schema, project, 'filament[1]', { temperature: '215' });
  assert.equal(project.filaments.length, 2);
  assert.deepEqual(project.filaments[0].config, {});
  assert.deepEqual(project.filaments[1].config, { temperature: '215' });
  assert.equal(project.filaments[1].name, project.filaments[0].name);

  // an invalid value in a batch changes nothing at all
  assert.throws(() => applySettings(schema, project, 'print', { layer_height: '0.3', brim_type: 'nope' }), /must be one of/);
  assert.deepEqual(project.print.config, { fill_density: '30%', infill_pattern: 'gyroid' });
  assert.throws(() => applySettings(schema, project, 'print', {}), /must not be empty/);
});

test('a project is only visible to the owner of the token', () => {
  const mine = newProject('robert');
  const other = newProject('haus');

  assert.equal(loadOwnedProject(mine.id, 'robert').id, mine.id);
  const err = (() => {
    try {
      loadOwnedProject(mine.id, 'haus');
    } catch (e) {
      return e as Error & { status?: number };
    }
    return undefined;
  })();
  assert.equal(err?.message, `Project "${mine.id}" not found`);
  assert.equal(err?.status, 404, 'a foreign project is not even admitted to exist');

  assert.throws(() => loadOwnedProject(other.id, 'robert'), /not found/);
  assert.throws(() => loadOwnedProject('not-a-uuid', 'robert'), /not found/);
  assert.throws(() => loadOwnedProject(undefined, 'robert'), /not found/);
  assert.ok(loadProject(mine.id), 'the projects are still on disk');
});
