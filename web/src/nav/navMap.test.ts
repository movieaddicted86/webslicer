/**
 * The navigation map: every function has exactly one home, the hosts render the table and nothing
 * else, and no label appears in two regions. The hosts are read from their sources, so the test fails
 * when a component grows a hand-written entry next to the table.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  NAV_ENTRIES,
  RAIL_ENTRIES,
  MENU_ENTRIES,
  MENU_SUBMENUS,
  EXPORT_ENTRIES,
  SETTINGS_ENTRIES,
  TOP_BAR_ENTRIES,
  VIEW_SWITCH_ENTRIES,
  homesOf,
} from './navMap';

const source = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

test('every function id is unique', () => {
  const ids = NAV_ENTRIES.map((e) => e.id);
  assert.deepEqual(
    ids.filter((id, i) => ids.indexOf(id) !== i),
    [],
  );
});

test('every function has one home, and only the settings views have the stated pair', () => {
  const states = new Set(['rail', 'menu', 'preset-row', 'top-bar']);
  for (const entry of NAV_ENTRIES) {
    const homes = homesOf(entry);
    assert.ok(homes.length >= 1, `${entry.id} has no home`);
    for (const home of homes) assert.ok(states.has(home), `${entry.id} has the home ${home}`);
    const pair = homes.length === 2 && homes.includes('menu') && homes.includes('preset-row');
    if (SETTINGS_ENTRIES.includes(entry)) {
      assert.ok(pair, `${entry.id} should open from the menu and its preset row`);
    } else {
      assert.equal(homes.length, 1, `${entry.id} has ${homes.length} homes`);
    }
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

test('the menu keeps import, then the Settings and Export flyouts', () => {
  assert.deepEqual(
    MENU_ENTRIES.map((e) => e.id),
    ['importModels', 'importPresets'],
  );
  assert.deepEqual(
    MENU_SUBMENUS.map((s) => s.id),
    ['settings', 'export'],
  );
  assert.deepEqual(
    EXPORT_ENTRIES.map((e) => e.id),
    ['exportProject', 'exportSettings', 'exportBundle', 'exportGcode', 'saveProjectToLibrary', 'saveGcodeToLibrary'],
  );
  // a flyout's trigger is one menu item with a name of its own, not a copy of an entry's label
  const labels = new Set(NAV_ENTRIES.map((e) => e.label));
  for (const sub of MENU_SUBMENUS) assert.ok(!labels.has(sub.label), `the trigger "${sub.label}" repeats an entry label`);
});

test('the settings views open from Menu → Settings and from their preset rows, nowhere else', () => {
  for (const entry of SETTINGS_ENTRIES) {
    assert.deepEqual(homesOf(entry), ['menu', 'preset-row'], `${entry.id} has the stated pair`);
  }
  assert.deepEqual(
    SETTINGS_ENTRIES.map((e) => (e.action.kind === 'view' ? e.action.view : '')),
    ['print', 'filament', 'printer'],
  );
  // the menu's Settings flyout lists exactly these three, in that order
  const settings = MENU_SUBMENUS.find((s) => s.id === 'settings');
  assert.deepEqual(
    settings?.items.map((e) => e.id),
    ['settingsPrint', 'settingsFilament', 'settingsPrinter'],
  );
  // the icon of a settings view is the sliders; the cog is Preferences' alone
  for (const entry of SETTINGS_ENTRIES) assert.equal(entry.icon, 'presetSettings');
  assert.equal(NAV_ENTRIES.find((e) => e.id === 'preferences')?.icon, 'settings');
});

test('the top bar keeps one entry per bar action, nothing else', () => {
  assert.deepEqual(
    TOP_BAR_ENTRIES.map((e) => e.id),
    ['undo', 'redo', 'hidePanels'],
  );
});

test('the Prepare | Preview switch has its one home in the top bar', () => {
  assert.deepEqual(
    VIEW_SWITCH_ENTRIES.map((e) => (e.action.kind === 'view' ? e.action.view : '')),
    ['plater', 'preview'],
  );
  for (const entry of VIEW_SWITCH_ENTRIES) {
    assert.equal(entry.home, 'top-bar');
    assert.ok(entry.testId, `${entry.id} has a test hook`);
  }
  // the bar renders the switch from the table, not from a literal list – and the strip no longer has it
  const bar = source('components/TopBar.tsx');
  assert.match(bar, /VIEW_SWITCH_ENTRIES/);
  const strip = source('components/tools/ToolStrip.tsx');
  assert.ok(!strip.includes('VIEW_SWITCH_ENTRIES'), 'the strip still renders the view switch');
});

test('no label appears in two regions', () => {
  const seen = new Map<string, string>();
  for (const entry of NAV_ENTRIES) {
    const before = seen.get(entry.label);
    assert.equal(before, undefined, `"${entry.label}" is in ${before} and in ${homesOf(entry).join()}`);
    seen.set(entry.label, homesOf(entry).join());
  }
});

test('the rail and the menu render from the table and nothing else', () => {
  const rail = source('components/Rail.tsx');
  assert.match(rail, /RAIL_ENTRIES/);
  const menu = source('components/AppMenu.tsx');
  assert.match(menu, /MENU_ENTRIES/);
  assert.match(menu, /MENU_SUBMENUS/);
  // the old hand-written entries are gone: no literal label of a removed function survives
  for (const gone of ['Open from library…', '>About<', 'Mode: ', 'Save project to library…']) {
    assert.ok(!menu.includes(gone), `AppMenu still hand-writes "${gone}"`);
  }
  const railLabels = readFileSync(fileURLToPath(new URL('../components/Rail.tsx', import.meta.url)), 'utf8');
  for (const gone of ['Physical printers', 'openDialog(']) {
    assert.ok(!railLabels.includes(gone), `Rail still hand-writes "${gone}"`);
  }
});

test('the preset rows carry the settings button and the one printers entry', () => {
  const preset = source('components/PresetSelect.tsx');
  assert.match(preset, /settingsEntryFor/);
  // the picture comes from the entry, so the row cannot grow a cog of its own again
  assert.match(preset, /<Icon name=\{settingsEntry\.icon\}/);
  assert.match(preset, /PRESET_PRINTERS_ENTRY/);
  assert.match(preset, /data-testid=\{`settings-open-\$\{type\}`\}/);
  assert.ok(!preset.includes('__add_printer__'), 'the old dropdown sentinel is still there');
});
