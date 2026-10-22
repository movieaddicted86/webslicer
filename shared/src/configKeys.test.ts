/**
 * SEC-2 (T-033): the config key rule. Pins the pattern that keeps a client key from writing an
 * extra line into the PrusaSlicer `config.ini` (SEC-1 bypass), and the writer's guard.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG_KEY_PATTERN, assertValidConfigKey, isValidConfigKey } from './configKeys.js';

const VALID = [
  'layer_height',
  'temperature',
  'nozzle_diameter',
  'filament_retract_length',
  'a',
  'a1',
  'enable_dynamic_overhang_speeds',
  // the one indexed key of the bundled 2.9.6 vendor profiles (Sovol.ini) – see CONFIG_KEY_PATTERN
  'dynamic_overhang_speeds[0]',
];

const INVALID = [
  'x\npost_process = echo pwned',
  'x\rpost_process = echo pwned',
  ' post_process',
  'post_process ',
  'post_process=1',
  'post_process\r',
  'post_process;',
  '#post_process',
  '[print]',
  'POST_PROCESS',
  '1layer_height',
  '_layer_height',
  'layer-height',
  'layer height',
  '',
  'ä',
];

test('every sliced option key of the schema shape is accepted', () => {
  for (const key of VALID) assert.equal(isValidConfigKey(key), true, key);
});

test('a key that could inject a line, an assignment or a section is rejected', () => {
  for (const key of INVALID) assert.equal(isValidConfigKey(key), false, JSON.stringify(key));
});

test('the pattern is the documented one plus the bracketed vector index', () => {
  assert.equal(CONFIG_KEY_PATTERN.source, '^[a-z][a-z0-9_]*(\\[\\d+\\])?$');
  // an index does not open the door to a section header or a second line
  for (const key of ['[0]', 'a[b]', 'a[0]\npost_process = x', 'a[0', 'a[]', 'a[0][1]', 'a[0] ', '[print]']) {
    assert.equal(isValidConfigKey(key), false, JSON.stringify(key));
  }
});

test('the writer guard throws with the offending key', () => {
  // the key is quoted and escaped, so a newline stays one visible `\n` in a log line
  assert.throws(() => assertValidConfigKey('x\npost_process = echo pwned'), /invalid config key "x\\npost_process = echo pwned"/);
  assert.doesNotThrow(() => assertValidConfigKey('layer_height'));
});
