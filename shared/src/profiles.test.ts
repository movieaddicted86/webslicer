/**
 * The profile repository's `index.idx`, its engine range and the fixed URL rules.
 *
 * The numbers are from the real upstream file (`live/PrusaResearch/index.idx`, 2.0.2 on top): the
 * newest line sits first, a `min_slic3r_version`/`max_slic3r_version` pair opens a range for the lines
 * below it, and the next `min_slic3r_version` closes it again. PrusaSlicer reads the file that way, so
 * the parser has to agree, otherwise the updater would offer a bundle the engine cannot load.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUNDLE_VERSION_PATTERN,
  PROFILE_ASSET_PATTERN,
  VENDOR_ID_PATTERN,
  configVersionOf,
  engineCompatible,
  newestCompatible,
  newestEntry,
  parseIndex,
  profilePageUrl,
  profileUrl,
} from './profiles.js';

/** The head of the real `live/PrusaResearch/index.idx`, shortened. */
const INDEX = [
  '3.0.0 A line above the first marker has no bounds.',
  'min_slic3r_version = 2.8.0-alpha0',
  '2.0.2 Added filament profile for Prusament Woodfill. Updated FW version notification.',
  '2.0.1 Updated FW version notifications.',
  '2.0.0 Updated version for PS2.8.0.',
  'max_slic3r_version = 2.7.9',
  'min_slic3r_version = 2.7.5-rc',
  '1.14.2 Updated FW version notification.',
  '1.14.1 Updated FW version notifications.',
  'min_slic3r_version = 2.7.3-beta1',
  '1.13.6 Updated FW version notification.',
  '',
  '# a comment line',
  'not a version line',
  '1.0.0',
].join('\n');

test('the index is read newest first, with the description of each line', () => {
  const entries = parseIndex(INDEX);
  assert.equal(entries[0].version, '3.0.0');
  const newestBounded = entries[1];
  assert.equal(newestBounded.version, '2.0.2');
  assert.match(newestBounded.description, /Prusament Woodfill/);
  assert.equal(newestBounded.minEngine, '2.8.0-alpha0');
  // the last line has no description
  assert.equal(entries[entries.length - 1].version, '1.0.0');
  assert.equal(entries[entries.length - 1].description, '');
});

test('each bound applies to the lines below it until the same key is set again', () => {
  const entries = parseIndex(INDEX);
  const byVersion = new Map(entries.map((e) => [e.version, e]));
  // above the max line: only a lower bound
  assert.deepEqual(byVersion.get('2.0.0'), { version: '2.0.0', description: 'Updated version for PS2.8.0.', minEngine: '2.8.0-alpha0' });
  // 1.14.2 sits inside the retired range
  assert.equal(byVersion.get('1.14.2')?.minEngine, '2.7.5-rc');
  assert.equal(byVersion.get('1.14.2')?.maxEngine, '2.7.9');
  // a later `min` replaces the lower bound only – the upper bound stays, as in PrusaSlicer's own reader
  assert.equal(byVersion.get('1.13.6')?.minEngine, '2.7.3-beta1');
  assert.equal(byVersion.get('1.13.6')?.maxEngine, '2.7.9');
  // the first line, above every marker: no bounds at all
  assert.equal(byVersion.get('3.0.0')?.minEngine, undefined);
  assert.equal(byVersion.get('3.0.0')?.maxEngine, undefined);
  // the last line inherits both bounds of the ranges above it
  assert.equal(byVersion.get('1.0.0')?.minEngine, '2.7.3-beta1');
});

test('a version runs on the engine when both bounds allow it (inclusive)', () => {
  const entry = { version: '1.14.2', minEngine: '2.7.5-rc', maxEngine: '2.7.9' };
  assert.equal(engineCompatible(entry, '2.7.9'), true);
  assert.equal(engineCompatible(entry, '2.7.5-rc'), true);
  assert.equal(engineCompatible(entry, '2.8.0'), false);
  assert.equal(engineCompatible(entry, '2.7.4'), false);
  assert.equal(engineCompatible({ version: '2.0.0', minEngine: '2.8.0-alpha0' }, '2.9.6'), true);
  assert.equal(engineCompatible({ version: '2.0.0', minEngine: '2.8.0-alpha0' }, '2.7.9'), false);
  assert.equal(engineCompatible({ version: '1.0.0' }, 'unknown'), true);
});

test('a released engine skips a pre-release bundle, an alpha engine loads anything', () => {
  const alpha = { version: '2.0.0-alpha1' };
  assert.equal(engineCompatible(alpha, '2.9.6'), false);
  assert.equal(engineCompatible(alpha, '2.9.6-alpha2'), true);
  assert.equal(engineCompatible({ version: '2.0.0' }, '2.9.6'), true);
});

test('the newest compatible bundle is offered, not the newest overall', () => {
  // the 3.0.0 line above every marker runs on any engine; a realistic file starts with the marker
  const entries = parseIndex(INDEX.split('\n').slice(1).join('\n'));
  assert.equal(newestEntry(entries)?.version, '2.0.2');
  // 2.9.6 runs the 2.8 range, so the newest line is offered
  assert.equal(newestCompatible(entries, '2.9.6')?.version, '2.0.2');
  // 2.7.9 is inside the retired range: the newest runnable version is 1.14.2, not 2.0.2
  assert.equal(newestCompatible(entries, '2.7.9')?.version, '1.14.2');
  // a version below every lower bound has nothing to run
  assert.equal(newestCompatible(parseIndex('min_slic3r_version = 2.8.0\n2.0.0 x'), '2.7.0'), undefined);
  // an empty index offers nothing
  assert.equal(newestCompatible(parseIndex(''), '2.9.6'), undefined);
});

test('the vendor folder and file names are fixed and refuse anything else', () => {
  assert.equal(
    profileUrl('PrusaResearch', '1.14.2.ini'),
    'https://raw.githubusercontent.com/prusa3d/PrusaSlicer-settings/master/live/PrusaResearch/1.14.2.ini',
  );
  assert.equal(profilePageUrl('PrusaResearch'), 'https://github.com/prusa3d/PrusaSlicer-settings/tree/master/live/PrusaResearch');
  assert.throws(() => profileUrl('../etc', 'x.ini'));
  assert.throws(() => profileUrl('PrusaResearch', '../../etc/passwd'));
  assert.throws(() => profileUrl('PrusaResearch', 'a/b.ini'));
  assert.throws(() => profilePageUrl('a b'));
  assert.equal(VENDOR_ID_PATTERN.test('PrusaResearch'), true);
  assert.equal(VENDOR_ID_PATTERN.test('Prusa_Research-2'), true);
  assert.equal(VENDOR_ID_PATTERN.test('a/b'), false);
  assert.equal(VENDOR_ID_PATTERN.test('a b'), false);
});

test('a bundle version is a file name, an asset name is allowlisted', () => {
  assert.equal(BUNDLE_VERSION_PATTERN.test('1.14.2'), true);
  assert.equal(BUNDLE_VERSION_PATTERN.test('2.0.0-alpha1'), true);
  assert.equal(BUNDLE_VERSION_PATTERN.test('../x'), false);
  assert.equal(BUNDLE_VERSION_PATTERN.test('1.0/2'), false);
  for (const name of ['mk4_bed.stl', 'mk4.svg', 'MK4IS_thumbnail_v2.png']) assert.equal(PROFILE_ASSET_PATTERN.test(name), true);
  for (const name of ['../x.stl', 'a/b.png', 'x.stl.exe', 'x.png/../y', 'x']) assert.equal(PROFILE_ASSET_PATTERN.test(name), false);
});

test('the config_version is read from the vendor section only', () => {
  const bundle = ['[vendor]', 'name = Prusa Research', 'config_version = 2.4.14', '', '[print:X]', 'config_version = 9.9.9'].join('\n');
  assert.equal(configVersionOf(bundle), '2.4.14');
  assert.equal(configVersionOf('[print:X]\nconfig_version = 1.0.0'), undefined);
  assert.equal(configVersionOf('[vendor]\nconfig_version ='), undefined);
  assert.equal(configVersionOf(''), undefined);
});
