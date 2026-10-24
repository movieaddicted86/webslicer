/**
 * The config block of a G-code file: read from the tail, split into preset sections, never executed.
 *
 * PrusaSlicer embeds the *merged* config, so the split has to file each key under the type the
 * settings view files it under (print first, then filament, then printer) and take the preset names
 * from the `*_settings_id` keys. A file without a block is a clear error, not an empty import.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GCODE_TAIL_BYTES, readGcodeConfig, sectionsOfGcodeConfig } from './gcodeConfig.js';
import { ValidationError } from '../errors.js';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-gcodecfg-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

/** The preset keys the fake schema knows; the split is driven by them, not by a fixed list. */
const KEYS = {
  print: ['layer_height', 'perimeters', 'start_gcode'],
  filament: ['temperature', 'filament_type'],
  printer: ['nozzle_diameter', 'bed_shape'],
} as const;
const keysOf = (type: 'print' | 'filament' | 'printer') => KEYS[type];

/** A G-code file with a head, then the config block – the block only sits at the end in real files. */
function gcode(block: string | undefined, headBytes = 0): string {
  const file = path.join(TMP, `file-${Math.random().toString(36).slice(2)}.gcode`);
  const head = headBytes ? `; filler\n${'G1 X1 Y1 F1000\n'.repeat(Math.ceil(headBytes / 18))}` : 'G1 X0 Y0\n';
  const tail = block === undefined ? 'G1 X2 Y2\n' : `; prusament PLA\n${block}\n; some trailer\n`;
  fs.writeFileSync(file, head + tail);
  return file;
}

const block = [
  '; prusaslicer_config = begin',
  '; bed_shape = 0x0,250x0,250x210,0x210',
  '; filament_settings_id = "Prusament PLA"',
  '; filament_type = PLA',
  '; layer_height = 0.2',
  '; nozzle_diameter = 0.4,0.4',
  '; perimeters = 3',
  '; print_settings_id = 0.20mm SPEED',
  '; printer_settings_id = Prusa MK4S 0.4 nozzle',
  '; start_gcode = G28 ; home\\nG1 Z5 F600',
  '; temperature = 215',
  '; prusaslicer_config = end',
  '; perimeters = 99',
].join('\n');

test('the block is read from the end of the file and its values come back as INI values', async () => {
  const cfg = await readGcodeConfig(gcode(block));
  assert.equal(cfg.layer_height, '0.2');
  assert.equal(cfg.temperature, '215');
  assert.equal(cfg.print_settings_id, '0.20mm SPEED');
  // a line after the end marker is not part of the block
  assert.equal(cfg.perimeters, '3');
});

test('a file without a config block is a client error, not an empty import', async () => {
  await assert.rejects(
    readGcodeConfig(gcode(undefined)),
    (e: unknown) => e instanceof ValidationError && /no PrusaSlicer config block/.test(e.message),
  );
});

test('only the tail is read: a block is found in a large file whose head was never loaded', async () => {
  const file = gcode(block, 3 * GCODE_TAIL_BYTES);
  assert.ok(fs.statSync(file).size > GCODE_TAIL_BYTES, 'the file is larger than the tail window');
  assert.equal((await readGcodeConfig(file)).layer_height, '0.2');
});

test('the merged config is split per type; the settings ids become the preset names', () => {
  const blockCfg = {
    layer_height: '0.2',
    perimeters: '3',
    start_gcode: 'G28',
    temperature: '215',
    filament_type: 'PLA',
    nozzle_diameter: '0.4',
    bed_shape: '0x0,250x0',
    print_settings_id: '0.20mm SPEED',
    filament_settings_id: '"Prusament PLA"',
    printer_settings_id: 'Prusa MK4S 0.4 nozzle',
    physical_printer_settings_id: '',
    unknown_option: 'dropped by the keys the schema knows',
  };
  const sections = sectionsOfGcodeConfig(blockCfg, keysOf);
  assert.deepEqual(
    sections.map((s) => [s.type, s.name, Object.keys(s.config).sort()]),
    [
      ['print', '0.20mm SPEED', ['layer_height', 'perimeters', 'start_gcode']],
      ['filament', 'Prusament PLA', ['filament_type', 'temperature']],
      ['printer', 'Prusa MK4S 0.4 nozzle', ['bed_shape', 'nozzle_diameter']],
    ],
  );
});

test('a type without a usable name falls back to a name the user can rename', () => {
  const sections = sectionsOfGcodeConfig({ layer_height: '0.2', temperature: '215' }, keysOf, 'Imported settings');
  assert.deepEqual(
    sections.map((s) => [s.type, s.name]),
    [
      ['print', 'Imported settings'],
      ['filament', 'Imported settings'],
    ],
  );
  // a type the block says nothing about does not become an empty preset
  assert.equal(
    sections.some((s) => s.type === 'printer'),
    false,
  );
});
