/**
 * W4: the preset-type list and the shared file-name rule. The list is the one the routes accept, the
 * bundle loader reads and the store initialises from; `safeName` replaces the two server copies.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESET_TYPES, isPresetType, safeName } from './index.js';

test('the preset types are the five PrusaSlicer sections, FFF first', () => {
  assert.deepEqual([...PRESET_TYPES], ['print', 'filament', 'printer', 'sla_print', 'sla_material']);
  assert.equal(isPresetType('printer'), true);
  assert.equal(isPresetType('Print'), false, 'case matters – the type is a directory name');
  assert.equal(isPresetType(''), false);
  assert.equal(isPresetType(undefined), false);
});

test('safeName keeps a plain name, takes the last path segment and replaces unsafe characters', () => {
  assert.equal(safeName('cube 20mm.stl'), 'cube 20mm.stl');
  assert.equal(safeName('a/b/c.stl'), 'c.stl', 'a path never keeps its directories');
  assert.equal(safeName('..\\x.stl'), 'x.stl');
  assert.equal(safeName('we:ird|name?.ini'), 'we_ird_name_.ini');
  assert.equal(safeName('tab\there'), 'tab_here');
  assert.equal(safeName('  padded.ini  '), 'padded.ini');
});

test('safeName returns an empty string for a name that is not usable', () => {
  assert.equal(safeName(''), '');
  assert.equal(safeName(undefined), '');
  assert.equal(safeName('..'), '');
  assert.equal(safeName('a/..'), '');
  assert.equal(safeName('/'), '');
});
