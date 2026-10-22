/**
 * Pin: the schema `buildSchema` derives from the checked-in PrusaSlicer 2.9.6 help output and the
 * vendor bundle keys must stay byte-identical. Any change in the layout tables, the option metadata,
 * the key sets or the help parser fails this test with a diff against `fixtures/schema.json`.
 *
 * Regenerate deliberately (see `fixtures/README.md`): `UPDATE_PINS=1 npx tsx --test …`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSchema } from './schema.js';
import { parseHelp } from './help.js';

const DIR = path.join(import.meta.dirname, 'fixtures');

function fixtures() {
  const helpFff = fs.readFileSync(path.join(DIR, 'help-fff.txt'), 'utf8');
  const helpSla = fs.readFileSync(path.join(DIR, 'help-sla.txt'), 'utf8');
  const keysJson = JSON.parse(fs.readFileSync(path.join(DIR, 'bundle-keys.json'), 'utf8')) as Record<string, string[]>;
  const keys = {
    print: new Set(keysJson.print),
    filament: new Set(keysJson.filament),
    printer: new Set(keysJson.printer),
    sla_print: new Set(keysJson.sla_print),
    sla_material: new Set(keysJson.sla_material),
  };
  return { helpFff, helpSla, keys };
}

/** Fail with a readable first difference instead of printing two megabyte strings. */
function assertJsonEqual(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual, null, 2);
  const e = JSON.stringify(expected, null, 2);
  if (a === e) return;
  const al = a.split('\n');
  const el = e.split('\n');
  const at = al.findIndex((line, i) => line !== el[i]);
  assert.fail(
    `${label} differs from the pin at line ${at + 1}:\n  pin:    ${el[at]}\n  actual: ${al[at]}` +
      `\n(pin ${el.length} lines, actual ${al.length} lines)`,
  );
}

test('pinned schema: buildSchema output is unchanged', () => {
  const { helpFff, helpSla, keys } = fixtures();
  const schema = buildSchema(helpFff, helpSla, 'test', keys);
  const file = path.join(DIR, 'schema.json');
  if (process.env.UPDATE_PINS) {
    fs.writeFileSync(file, JSON.stringify(schema, null, 2) + '\n');
    return;
  }
  assertJsonEqual(schema, JSON.parse(fs.readFileSync(file, 'utf8')), 'schema');
});

test('pinned help parse: canonical keys and types of well-known options', () => {
  const { helpFff, helpSla, keys } = fixtures();
  const known = new Set<string>();
  for (const list of Object.values(keys)) for (const k of list) known.add(k);
  const raw = parseHelp(helpFff, known);
  const byKey = new Map(raw.map((r) => [r.key, r]));
  assert.equal(raw.length, 367);
  assert.equal(parseHelp(helpSla, known).length, 158);
  for (const [key, hint] of [
    ['layer_height', 'N'],
    ['nozzle_diameter', 'N'],
    ['bed_shape', ''],
    ['start_gcode', 'ABCD'],
    ['layer_gcode', 'ABCD'],
  ] as const) {
    assert.equal(byKey.get(key)?.hint, hint, key);
  }
  assert.ok(byKey.has('layer_gcode') && !byKey.has('after_layer_gcode'), 'bundle key wins over the alias');
});
