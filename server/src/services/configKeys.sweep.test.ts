/**
 * SEC-2 (T-033): the key rule does not reject a key the slicer itself ships.
 *
 * The whitelist and the INI writer refuse keys outside `CONFIG_KEY_PATTERN`, so the pattern has to
 * accept every key the bundled PrusaSlicer 2.9.6 vendor profiles carry – otherwise a preset would be
 * silently emptied on its way to the slicer. The fixture `bundle-keys.json` is that key set: the
 * config keys of every print, filament, printer, SLA print and SLA material preset, per type.
 *
 * The *only* exception found is `dynamic_overhang_speeds[0]` (`Sovol.ini`, a vector element), which is
 * why the pattern allows one bracketed numeric index – the sweep is the reason, and this test is the
 * reason the index stays.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SERVER_ONLY_KEYS, isValidConfigKey, type PresetType } from '@webslicer/shared';
import { isAllowedConfigKey, knownConfigKeys } from '../services/configKeys.js';

const DIR = path.join(import.meta.dirname, '..', 'slicer', 'fixtures');
const keysJson = JSON.parse(fs.readFileSync(path.join(DIR, 'bundle-keys.json'), 'utf8')) as Record<PresetType, string[]>;
const schema = JSON.parse(fs.readFileSync(path.join(DIR, 'schema.json'), 'utf8')) as {
  options: Record<string, unknown>;
  presetKeys: Record<PresetType, string[]>;
};

test('every key of every bundled system preset passes the key rule', () => {
  const rejected: string[] = [];
  for (const [type, keys] of Object.entries(keysJson) as Array<[PresetType, string[]]>) {
    for (const key of keys) if (!isValidConfigKey(key)) rejected.push(`${type}: ${JSON.stringify(key)}`);
  }
  assert.deepEqual(rejected, [], `keys the rule rejects (${rejected.length})`);
  // and the set is the real one, not a stub: the 2.9.6 bundles have ~600 keys over the five types
  const total = Object.values(keysJson).reduce((n, keys) => n + keys.length, 0);
  assert.ok(total > 500, `only ${total} keys in the fixture`);
});

test('every option and preset key of the pinned schema is a well-formed key', () => {
  const bad = [...Object.keys(schema.options), ...Object.values(schema.presetKeys).flat()].filter((key) => !isValidConfigKey(key));
  assert.deepEqual([...new Set(bad)], []);
});

test('the whitelist keeps every schema key except the server-only ones', () => {
  const known = knownConfigKeys(schema as never);
  const dropped = [...known].filter((key) => !isAllowedConfigKey(schema as never, key));
  assert.deepEqual(dropped.sort(), [...SERVER_ONLY_KEYS].sort());
});
