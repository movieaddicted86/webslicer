/**
 * I-1: the icon table and the vendored PrusaSlicer files drift apart easily – a renamed file or a
 * hand-edited SVG would only show up as a missing picture. These checks keep the table, the
 * generated index and the files on disk in agreement, and stop a near-white or a logo icon from
 * slipping in.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ICON_TABLE } from './table';
import { PRUSA_ICONS } from './prusa';

const DIR = fileURLToPath(new URL('./prusa', import.meta.url));
const FILE = /\.svg$/;
const FORBIDDEN = [/prusaslicer/i, /printables/i, /^connect$/i, /cloud/i, /logo/i];

/** `#F7F7F7`, `#FFF`, `white` and every other near-white colour the artwork used for its dark theme. */
function isNearWhite(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v === 'white' || v === '#fff' || v === '#ffffff') return true;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (!hex) return false;
  const digits = hex[1].length === 3 ? [...hex[1]].map((c) => c + c) : [hex[1].slice(0, 2), hex[1].slice(2, 4), hex[1].slice(4)];
  return digits.every((c) => parseInt(c, 16) >= 240);
}

const vendored = fs
  .readdirSync(DIR)
  .filter((f) => FILE.test(f))
  .map((f) => f.slice(0, -'.svg'.length))
  .sort();

const prusaEntries = Object.entries(ICON_TABLE).filter(([, v]) => v.source === 'prusa') as Array<
  [string, { source: 'prusa'; file: string }]
>;

test('every Prusa icon the table uses is vendored and in the generated index', () => {
  for (const [name, entry] of prusaEntries) {
    assert.ok(fs.existsSync(path.join(DIR, `${entry.file}.svg`)), `${name}: web/src/icons/prusa/${entry.file}.svg is missing`);
    assert.ok(entry.file in PRUSA_ICONS, `${name}: ${entry.file} is not in the generated index – run node scripts/vendor-icons.mjs`);
  }
});

test('the generated index and the files on disk list the same icons', () => {
  assert.deepEqual(Object.keys(PRUSA_ICONS).sort(), vendored);
});

test('a vendored icon carries no hard-coded near-white fill', () => {
  for (const file of vendored) {
    const svg = fs.readFileSync(path.join(DIR, `${file}.svg`), 'utf8');
    for (const match of svg.matchAll(/\b(?:fill|stroke)="([^"]*)"/g)) {
      assert.ok(!isNearWhite(match[1]), `${file}.svg still paints ${match[1]}; it must be currentColor`);
    }
  }
});

test('the table never references a logo, the cloud or printables', () => {
  for (const [name, entry] of prusaEntries) {
    for (const forbidden of FORBIDDEN) {
      assert.ok(!forbidden.test(entry.file), `${name} points at the forbidden icon ${entry.file}.svg`);
    }
  }
});
