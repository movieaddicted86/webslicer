/**
 * The navigation map: every function has exactly one home, the hosts render the table and nothing
 * else, and no label appears in two regions. The hosts are read from their sources, so the test fails
 * when a component grows a hand-written entry next to the table.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NAV_ENTRIES, RAIL_ENTRIES, MENU_ENTRIES, EXPORT_ENTRIES, SETTINGS_ENTRIES, TOP_BAR_ENTRIES } from './navMap';

const source = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

test('every function id is unique', () => {
  const ids = NAV_ENTRIES.map((e) => e.id);
  assert.deepEqual(
    ids.filter((id, i) => ids.indexOf(id) !== i),
    [],
  );
});

test('every function has exactly one home', () => {
  for (const entry of NAV_ENTRIES) {
    assert.ok(['rail', 'menu', 'preset-row', 'top-bar'].includes(entry.home), `${entry.id} has the home ${entry.home}`);
  }
});

test('the rail holds Slicing, Library, Printers, Preferences and About – in that order', () => {
  assert.deepEqual(
    RAIL_ENTRIES.map((e) => e.id),
    ['slicing', 'library', 'printers', 'preferences', 'about'],
  );
  // the functions that used to be duplicated are not in the menu any more
  const menu = MENU_ENTRIES.map((e) => e.id);
  for (const gone of ['library', 'printers', 'about', 'saveProject']) {
    assert.ok(!menu.includes(gone), `${gone} is still a menu entry`);
  }
});

test('the menu keeps import, the export list – and the two "to library" saves inside Export', () => {
  assert.deepEqual(
    MENU_ENTRIES.map((e) => e.id),
    ['importModels', 'importPresets'],
  );
  assert.deepEqual(
    EXPORT_ENTRIES.map((e) => e.id),
    ['exportProject', 'exportSettings', 'exportBundle', 'exportGcode', 'saveProjectToLibrary', 'saveGcodeToLibrary'],
  );
});

test('the settings views open from the preset rows only', () => {
  for (const entry of SETTINGS_ENTRIES) assert.equal(entry.home, 'preset-row');
  assert.deepEqual(
    SETTINGS_ENTRIES.map((e) => (e.action.kind === 'view' ? e.action.view : '')),
    ['print', 'filament', 'printer'],
  );
});

test('the top bar keeps one entry per bar action, nothing else', () => {
  assert.deepEqual(
    TOP_BAR_ENTRIES.map((e) => e.id),
    ['undo', 'redo', 'hidePanels'],
  );
});

test('no label appears in two regions', () => {
  const seen = new Map<string, string>();
  for (const entry of NAV_ENTRIES) {
    const before = seen.get(entry.label);
    assert.equal(before, undefined, `"${entry.label}" is in ${before} and in ${entry.home}`);
    seen.set(entry.label, entry.home);
  }
});

test('the rail and the menu render from the table and nothing else', () => {
  const rail = source('components/Rail.tsx');
  assert.match(rail, /RAIL_ENTRIES/);
  const menu = source('components/AppMenu.tsx');
  assert.match(menu, /MENU_ENTRIES/);
  assert.match(menu, /EXPORT_ENTRIES/);
  // the old hand-written entries are gone: no literal label of a removed function survives
  for (const gone of ['Open from library…', '>About<', 'Mode: ', 'Save project to library…']) {
    assert.ok(!menu.includes(gone), `AppMenu still hand-writes "${gone}"`);
  }
  const railLabels = readFileSync(fileURLToPath(new URL('../components/Rail.tsx', import.meta.url)), 'utf8');
  for (const gone of ['Physical printers', 'openDialog(']) {
    assert.ok(!railLabels.includes(gone), `Rail still hand-writes "${gone}"`);
  }
});

test('the preset rows carry the cog and the one printers entry', () => {
  const preset = source('components/PresetSelect.tsx');
  assert.match(preset, /settingsEntryFor/);
  assert.match(preset, /PRESET_PRINTERS_ENTRY/);
  assert.match(preset, /data-testid=\{`settings-open-\$\{type\}`\}/);
  assert.ok(!preset.includes('__add_printer__'), 'the old dropdown sentinel is still there');
});
