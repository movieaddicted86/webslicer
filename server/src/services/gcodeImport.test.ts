/**
 * Import config from a G-code file: the embedded PrusaSlicer config block, split into the presets it
 * describes, through the same validation as a bundle import.
 *
 * The fixtures are real: one file sliced by PrusaSlicer 2.9.6 for an MK4S (only its config block is
 * copied, so the test stays small) and one hostile file that carries the keys SEC-1 and SEC-2 refuse.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-gcodeimport-'));
process.env.DATA_DIR = DATA_DIR;
delete process.env.PRUSASLICER_PROFILES;
delete process.env.PRUSASLICER_RESOURCES;

const { ensureDirs } = await import('../config.js');
const { previewGcodeImport } = await import('./gcodeImport.js');
const { importBundle } = await import('./presetTransfer.js');
const { listUserPresets } = await import('../slicer/presets.js');
const { ValidationError } = await import('../errors.js');

const FIXTURES = path.join(import.meta.dirname, '..', 'slicer', 'fixtures');
const REAL = path.join(FIXTURES, 'config-block.gcode');
const HOSTILE = path.join(FIXTURES, 'hostile-config-block.gcode');
const schema = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'schema.json'), 'utf8')) as never;

before(() => ensureDirs());
after(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

test('a real PrusaSlicer file yields the three presets its config block names', async () => {
  const preview = await previewGcodeImport(REAL, schema);
  assert.equal(preview.fromGcode, true);
  assert.deepEqual(
    preview.presets.map((p) => [p.type, p.name]),
    [
      ['print', '0.20mm SPEED @MK4S HF0.4'],
      ['filament', 'Prusament PLA @HF0.4'],
      ['printer', 'Original Prusa MK4S HF0.4 nozzle'],
    ],
  );
  // the split puts a key under the type the settings view files it under
  const print = presetOf(preview, 'print');
  assert.equal(print.config.layer_height, '0.2');
  assert.ok(Object.keys(printerConfigOf(preview)).includes('nozzle_diameter'));
  assert.equal(printerConfigOf(preview).printer_model, 'MK4S');
  assert.ok(Object.keys(filamentConfigOf(preview)).includes('temperature'));
  // even a genuine PrusaSlicer export names the server-only keys; they are dropped and reported
  assert.deepEqual(preview.rejected.map((r) => [r.key, r.name]).sort(), [
    ['output_filename_format', '0.20mm SPEED @MK4S HF0.4'],
    ['post_process', '0.20mm SPEED @MK4S HF0.4'],
  ]);
  assert.ok(Object.keys(print.config).length > 20);
});

test('the preview imports as the same presets, nothing is read from the G-code itself', async () => {
  const preview = await previewGcodeImport(REAL, schema);
  const result = importBundle(preview.bundle, [], schema);
  assert.deepEqual(
    result.imported.map((p) => [p.type, p.name]),
    [
      ['print', '0.20mm SPEED @MK4S HF0.4'],
      ['filament', 'Prusament PLA @HF0.4'],
      ['printer', 'Original Prusa MK4S HF0.4 nozzle'],
    ],
  );
  assert.equal(listUserPresets('print').find((p) => p.name === '0.20mm SPEED @MK4S HF0.4')?.config.layer_height, '0.2');
  // every imported value is a config value, not a G-code line from the head of the file
  for (const type of ['print', 'filament', 'printer'] as const) {
    for (const preset of listUserPresets(type))
      assert.equal(
        Object.keys(preset.config).some((k) => k === 'G90'),
        false,
      );
  }
});

test('a hostile block loses its forbidden keys and imports the rest', async () => {
  const preview = await previewGcodeImport(HOSTILE, schema);
  assert.deepEqual(preview.rejected.map((r) => r.key).sort(), ['output_filename_format', 'post_process']);
  importBundle(preview.bundle, [], schema);
  const print = userPreset('print', 'Hostile print');
  assert.deepEqual(print, { layer_height: '0.25', perimeters: '2' });
  for (const value of Object.values(print)) assert.doesNotMatch(value, /curl|attacker|cron\.d/);
  // the line whose value hid a command behind a lone carriage return does not become a setting at
  // all: the block reader splits on line ends, so the hidden half never reaches the config
  assert.deepEqual(userPreset('printer', 'Hostile printer'), { nozzle_diameter: '0.4' });
});

test('a file without a config block is a clear client error', async () => {
  const file = path.join(DATA_DIR, 'plain.gcode');
  fs.writeFileSync(file, 'G90\nM83\nG28\nG1 X1 Y1\n');
  await assert.rejects(
    previewGcodeImport(file, schema),
    (e: unknown) => e instanceof ValidationError && /no PrusaSlicer config block/.test(e.message),
  );
});

/** The preview's preset of one type; the test fails with a readable message when it is missing. */
function presetOf(preview: Awaited<ReturnType<typeof previewGcodeImport>>, type: 'print' | 'filament' | 'printer') {
  const preset = preview.presets.find((p) => p.type === type);
  assert.ok(preset, `the preview holds a ${type} preset`);
  return preset;
}

/** The stored config of one user preset (asserted to exist first). */
function userPreset(type: 'print' | 'filament' | 'printer', name: string) {
  const preset = listUserPresets(type).find((p) => p.name === name);
  assert.ok(preset, `the store holds the ${type} preset "${name}"`);
  return preset.config;
}

const printerConfigOf = (preview: Awaited<ReturnType<typeof previewGcodeImport>>) => presetOf(preview, 'printer').config;
const filamentConfigOf = (preview: Awaited<ReturnType<typeof previewGcodeImport>>) => presetOf(preview, 'filament').config;
