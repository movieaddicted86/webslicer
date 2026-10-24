/**
 * The preset bundle format: PrusaSlicer's `[print:Name]` / `[filament:Name]` / `[printer:Name]`
 * sections and the `[presets]` selection. The writer and the reader have to agree (the export is only
 * useful if it imports again), and the writer must never put a print host's credentials into a file
 * that is made to be shared.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePresetBundle, serializePresetBundle, type BundlePreset } from './presetBundle.js';

const PRESETS: BundlePreset[] = [
  { type: 'printer', name: 'Original Prusa MK4S HF0.4 nozzle', config: { nozzle_diameter: '0.4', bed_shape: '0x0,250x0,250x210,0x210' } },
  {
    type: 'print',
    name: '0.20mm SPEED – mine',
    // a stored config keeps a line end as a literal `\n` (the store's INI form)
    config: { layer_height: '0.2', start_gcode: 'G28 ; home\\nG1 Z5 F600' },
    inherits: '0.20mm SPEED',
  },
  { type: 'filament', name: 'Prusament PLA (copy)', config: { temperature: '215', filament_type: 'PLA' } },
];

/** Presets by `type/name`, so the test does not pin the writer's section order. */
const byName = (presets: BundlePreset[]) => new Map(presets.map((p) => [`${p.type}/${p.name}`, p]));

test('a bundle round-trips: names, values and inherits come back unchanged', () => {
  const text = serializePresetBundle(PRESETS);
  const parsed = parsePresetBundle(text);
  assert.deepEqual(byName(parsed.presets), byName(PRESETS));
  assert.deepEqual(parsed.invalid, []);
  assert.deepEqual(parsed.physicalPrinters, []);
});

test('the [presets] selection comes back per type', () => {
  const text = serializePresetBundle(PRESETS, { selection: { print: ['0.20mm SPEED – mine'], filament: ['Prusament PLA (copy)'] } });
  const parsed = parsePresetBundle(text);
  assert.deepEqual(parsed.selection, { print: ['0.20mm SPEED – mine'], filament: ['Prusament PLA (copy)'] });
});

test('a physical printer is written without the host address or a key', () => {
  const text = serializePresetBundle(PRESETS, {
    physicalPrinters: [{ name: 'Garage MK4S', hostType: 'prusalink', presetName: 'Original Prusa MK4S HF0.4 nozzle' }],
  });
  assert.match(text, /\[physical_printer:Garage MK4S\]/);
  assert.match(text, /host_type = prusalink/);
  assert.match(text, /printer_preset = Original Prusa MK4S HF0\.4 nozzle/);
  // the credentials of a print host are not a setting of a preset: never in the file
  assert.doesNotMatch(text, /api_key|apiKey|password|http:\/\//);
  // and the reader reports the printer instead of importing it as a preset
  const parsed = parsePresetBundle(text);
  assert.deepEqual(parsed.physicalPrinters, ['Garage MK4S']);
  assert.equal(parsed.presets.length, PRESETS.length);
});

test('vendor and model sections are not presets; abstract and nameless sections are reported', () => {
  const text = [
    '[vendor]',
    'name = Prusa Research',
    '',
    '[printer_model:MK4S]',
    'name = Original Prusa MK4S',
    '',
    '[print:*common*]',
    'layer_height = 0.2',
    '',
    '[print:System Print]',
    'perimeters = 2',
    '',
    '[print:]',
    'perimeters = 3',
  ].join('\n');
  const parsed = parsePresetBundle(text);
  assert.deepEqual(
    parsed.presets.map((p) => p.name),
    ['System Print'],
  );
  assert.deepEqual(
    parsed.invalid.map((p) => [p.type, p.name, p.reason]),
    [
      ['print', '*common*', 'abstract preset section'],
      ['print', '', 'empty preset name'],
    ],
  );
});

test('the writer refuses a config key that would change the meaning of the file (SEC-2)', () => {
  assert.throws(
    () => serializePresetBundle([{ type: 'print', name: 'x', config: { 'x\npost_process = echo pwned': '1' } }]),
    /invalid config key/,
  );
});
