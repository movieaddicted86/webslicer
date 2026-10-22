/**
 * SEC-2 (T-033): a config key that is not a well-formed key never reaches the slicer.
 *
 * The SEC-1 bypass: `mergeConfigs` dropped the server-only keys by an exact name match, and the INI
 * writer wrote the key unescaped – so `"x\npost_process = echo pwned"` became a second line of the
 * `config.ini` PrusaSlicer loads via `--load`, and the slicer ran the command as the service user.
 *
 * The pins below fail on `main` for exactly that reason; the fix is three guards with one rule
 * (`isValidConfigKey` in `shared`): the request validation, the merge's key whitelist and the INI
 * writer's refusal.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDENTITY, isValidConfigKey, type Schema, type SliceRequest } from '@webslicer/shared';
import { mergeConfigs } from './configMerge.js';
import { isAllowedConfigKey } from './configKeys.js';
import { serializeIni } from '../slicer/ini.js';
import { parseSliceRequest } from '../validation/slice.js';

/** The injected keys of the task, in the shape a client sends them. */
const INJECTIONS = [
  'x\npost_process = echo pwned',
  ' post_process',
  'post_process=x',
  'post_process\r',
  'post_process = echo pwned',
  '#post_process',
  '[print]',
  'post_process;rm -rf /',
];

/** A schema that knows `layer_height` and the (server-only) `post_process`. */
const SCHEMA = {
  slicerVersion: 'test',
  layout: [],
  presetKeys: {
    print: ['layer_height', 'post_process', 'print_settings_id'],
    filament: ['temperature'],
    printer: ['nozzle_diameter'],
    sla_print: [],
    sla_material: [],
  },
  options: {
    layer_height: {
      key: 'layer_height',
      label: 'Layer height',
      tooltip: '',
      category: 'Layers',
      type: 'float',
      default: '0.2',
      presetTypes: ['print'],
      technology: 'FFF',
    },
    post_process: {
      key: 'post_process',
      label: 'Post-processing scripts',
      tooltip: '',
      category: 'Misc',
      type: 'strings',
      default: '',
      presetTypes: ['print'],
      technology: 'FFF',
    },
    temperature: {
      key: 'temperature',
      label: 'Temperature',
      tooltip: '',
      category: 'Filament',
      type: 'ints',
      default: '215',
      presetTypes: ['filament'],
      technology: 'FFF',
    },
    nozzle_diameter: {
      key: 'nozzle_diameter',
      label: 'Nozzle diameter',
      tooltip: '',
      category: 'Printer',
      type: 'floats',
      default: '0.4',
      presetTypes: ['printer'],
      technology: 'FFF',
    },
  },
} as never as Schema;

/** A request whose every slot a client can write to carries `config`. */
function request(config: Record<string, string>): SliceRequest {
  return {
    objects: [{ modelId: '11111111-1111-1111-1111-111111111111', name: 'cube', transform: [...IDENTITY], config }],
    print: { name: 'p', config },
    printer: { name: 'pr', config },
    filaments: [{ name: 'f', config }],
  } as SliceRequest;
}

test('an injected key is not merged and not written – for every slot', () => {
  for (const key of INJECTIONS) {
    assert.equal(isValidConfigKey(key), false, JSON.stringify(key));
    const merged = mergeConfigs(SCHEMA, request({ [key]: 'echo pwned', layer_height: '0.1' }));
    assert.deepEqual(
      Object.keys(merged).filter((k) => /post|pwned|rm|print\]/.test(k)),
      [],
      `${JSON.stringify(key)} survived`,
    );
    assert.equal(merged.layer_height, '0.1', 'the legitimate key still merges');
    const ini = serializeIni(merged);
    assert.ok(!/^post_process/m.test(ini), `an injected post_process line was written: ${ini}`);
  }
});

test('the INI writer throws on a malformed key instead of writing a second line', () => {
  for (const key of INJECTIONS) {
    assert.throws(() => serializeIni({ [key]: 'x' }), /invalid config key/, JSON.stringify(key));
  }
  assert.doesNotThrow(() => serializeIni({ layer_height: '0.2' }));
});

test('the writer escapes newlines in a value as before – only the key is refused', () => {
  assert.equal(serializeIni({ start_gcode: 'G28\nG1' }), 'start_gcode = G28\\nG1\n');
});

test('a well-formed key the schema does not know is dropped, not thrown', () => {
  const merged = mergeConfigs(SCHEMA, request({ no_such_option: '1', layer_height: '0.2' }));
  assert.equal(merged.no_such_option, undefined);
  assert.equal(merged.layer_height, '0.2');
});

test('the whitelist is the schema plus the preset keys, minus the server-only keys', () => {
  assert.equal(isAllowedConfigKey(SCHEMA, 'layer_height'), true);
  assert.equal(isAllowedConfigKey(SCHEMA, 'temperature'), true);
  assert.equal(isAllowedConfigKey(SCHEMA, 'nozzle_diameter'), true);
  assert.equal(isAllowedConfigKey(SCHEMA, 'post_process'), false, 'SEC-1 stays');
  assert.equal(isAllowedConfigKey(SCHEMA, 'unknown_option'), false);
  assert.equal(isAllowedConfigKey(SCHEMA, 'Layer_Height'), false, 'the rule is exact, not case-folding');
});

test('the slice request validation answers 400 with the offending key', () => {
  // every config a request carries is checked: print, filament, object
  for (const key of [INJECTIONS[0], INJECTIONS[2], INJECTIONS[3]]) {
    const parsed = parseSliceRequest(request({ [key]: 'echo pwned' }));
    assert.equal(parsed.ok, false, JSON.stringify(key));
    if (!parsed.ok) assert.match(parsed.message, /invalid config key "/, parsed.message);
  }
  // a well-formed but unknown key is not a 400: old projects keep loading
  assert.equal(parseSliceRequest(request({ no_such_option: 'x' })).ok, true);
  const merged = mergeConfigs(SCHEMA, request({ no_such_option: 'x' }));
  assert.equal(merged.no_such_option, undefined);
});
