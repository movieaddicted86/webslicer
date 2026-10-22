/**
 * B5: a preset whose `inherits` forms a cycle (itself or a longer loop) used to make
 * `resolvePreset` recurse forever – the preset list answered 500 until the `.ini` was deleted by
 * hand. The resolver now tracks the chain, `saveUserPreset` refuses to store a cycle (400 at the
 * route) and a cycle already on disk is skipped in the list with a log warning instead of breaking
 * every other preset.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// the data directory has to be redirected before anything reads it (config is evaluated once)
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-presets-'));
process.env.DATA_DIR = DATA_DIR;

const { config, ensureDirs } = await import('../config.js');
const { listPresets, resolvePreset, saveUserPreset, userPresetExists } = await import('./presets.js');
const { ValidationError } = await import('../errors.js');
import type { Schema } from '@webslicer/shared';

const SCHEMA = {
  slicerVersion: 'test',
  layout: [],
  presetKeys: { print: ['layer_height', 'inherits'], filament: [], printer: [], sla_print: [], sla_material: [] },
  options: { layer_height: { key: 'layer_height', label: 'Layer height', tooltip: '', type: 'float', default: '0.2' } },
} as unknown as Schema;

/** Write a user preset file directly, as a broken earlier version could have left it. */
function writeIni(name: string, body: string): void {
  const dir = path.join(config.presetsDir, 'print');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.ini`), body);
}

before(() => {
  ensureDirs();
  fs.rmSync(path.join(config.presetsDir, 'print'), { recursive: true, force: true });
});
after(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

test('B5: a preset inheriting itself resolves instead of recursing forever', () => {
  writeIni('self-cycle', 'layer_height = 0.3\ninherits = self-cycle\n');
  const p = resolvePreset(SCHEMA, 'print', 'self-cycle');
  assert.ok(p, 'the preset still resolves');
  assert.equal(p?.config.layer_height, '0.3');
});

test('B5: a two-preset cycle resolves as well', () => {
  writeIni('cyc-a', 'layer_height = 0.1\ninherits = cyc-b\n');
  writeIni('cyc-b', 'layer_height = 0.4\ninherits = cyc-a\n');
  assert.doesNotThrow(() => resolvePreset(SCHEMA, 'print', 'cyc-a'));
  assert.equal(resolvePreset(SCHEMA, 'print', 'cyc-b')?.config.layer_height, '0.4');
});

test('B5: storing a cycle is refused with a ValidationError (400 at the route)', () => {
  assert.throws(() => saveUserPreset('print', 'new-cycle', { layer_height: '0.2' }, 'new-cycle'), ValidationError);
  assert.equal(userPresetExists('print', 'new-cycle'), false, 'nothing was written');

  writeIni('foreign', 'layer_height = 0.2\ninherits = my-cycle\n');
  assert.throws(() => saveUserPreset('print', 'my-cycle', { layer_height: '0.2' }, 'foreign'), ValidationError);
  assert.equal(userPresetExists('print', 'my-cycle'), false);
});

test('B5: a cycle already on disk is skipped in the list, the others stay', () => {
  writeIni('listing-cycle', 'layer_height = 0.2\ninherits = listing-cycle\n');
  writeIni('listing-good', 'layer_height = 0.25\n');
  const list = listPresets(SCHEMA, 'print');
  assert.ok(
    list.some((p) => p.name === 'listing-good'),
    'the healthy preset is still listed',
  );
  assert.equal(
    list.some((p) => p.name === 'listing-cycle'),
    false,
    'the cycle is skipped instead of breaking the whole list',
  );
});
