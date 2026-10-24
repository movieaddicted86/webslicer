/**
 * The wizard's filament filter: grouping, the text filter, and what it does to the preset selector.
 *
 * The rules tested here are the ones the dialog and `PresetSelect` rely on: an empty choice is "show
 * all" (so nothing changes for an install that never used the step), a ticked choice keeps every user
 * preset and the preset that is selected right now, and the escape hatch restores the whole list.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compatibleOf, filterSystemFilaments, groupFilaments, materialOf } from './filamentVisibility.js';
import type { FilamentCatalogEntry, PresetSummary } from './api';

const entry = (name: string, vendorId: string, vendorName: string, material?: string, compatible = true): FilamentCatalogEntry => ({
  name,
  vendorId,
  vendorName,
  material,
  compatible,
});

const CATALOG: FilamentCatalogEntry[] = [
  entry('Prusament PLA', 'PrusaResearch', 'Prusa Research', 'PLA'),
  entry('Prusament PETG', 'PrusaResearch', 'Prusa Research', 'PETG'),
  entry('Prusament PLA @MK3S', 'PrusaResearch', 'Prusa Research', 'PLA', false),
  entry('Generic PLA', 'Generic', 'Generic', 'PLA'),
  entry('Mystery spool', 'Generic', 'Generic'),
];

/** A preset list as the selector gets it: system presets, two defaults and one user preset. */
const presets = (): PresetSummary[] => [
  { type: 'filament', name: '- default FFF -', system: true, compatible: true },
  { type: 'filament', name: 'Prusament PLA', system: true, vendorId: 'PrusaResearch', compatible: true },
  { type: 'filament', name: 'Prusament PETG', system: true, vendorId: 'PrusaResearch', compatible: true },
  { type: 'filament', name: 'Prusament PLA @MK3S', system: true, vendorId: 'PrusaResearch', compatible: false },
  { type: 'filament', name: 'My PETG', system: false, compatible: true },
];

const names = (list: readonly PresetSummary[]): string[] => list.map((p) => p.name);

test('the material of an entry is its filament_type, else "Other"', () => {
  assert.equal(materialOf({ material: 'PLA' }), 'PLA');
  assert.equal(materialOf({ material: '  ' }), 'Other');
  assert.equal(materialOf({}), 'Other');
});

test('groupFilaments groups by vendor, then by material, keeping the catalogue order', () => {
  const groups = groupFilaments(CATALOG);
  assert.deepEqual(
    groups.map((g) => ({ id: g.vendorId, name: g.vendorName, sections: g.sections.map((s) => s.material) })),
    [
      { id: 'PrusaResearch', name: 'Prusa Research', sections: ['PLA', 'PETG'] },
      { id: 'Generic', name: 'Generic', sections: ['PLA', 'Other'] },
    ],
  );
  assert.deepEqual(
    groups[0].sections[0].entries.map((e) => e.name),
    ['Prusament PLA', 'Prusament PLA @MK3S'],
  );
  assert.deepEqual(
    groups[1].sections[1].entries.map((e) => e.name),
    ['Mystery spool'],
  );
});

test('the text filter matches the name, the material and the vendor, case-insensitively', () => {
  const byName = groupFilaments(CATALOG, 'petg');
  assert.deepEqual(
    byName.map((g) => g.vendorId),
    ['PrusaResearch'],
  );
  assert.deepEqual(
    byName[0].sections.map((s) => s.material),
    ['PETG'],
  );

  const byMaterial = groupFilaments(CATALOG, 'pla');
  assert.deepEqual(
    byMaterial.map((g) => g.vendorId),
    ['PrusaResearch', 'Generic'],
  );
  assert.deepEqual(
    byMaterial[1].sections.map((s) => s.material),
    ['PLA'],
  );

  // the vendor name matches every entry of that vendor
  assert.deepEqual(
    groupFilaments(CATALOG, 'generic')[0].sections.map((s) => s.entries.length),
    [1, 1],
  );
  // a vendor without a match disappears, so the tab list follows the filter
  assert.deepEqual(groupFilaments(CATALOG, 'nothing like this'), []);
});

test('compatibleOf keeps only what the installed printer accepts', () => {
  const [prusa] = groupFilaments(CATALOG);
  assert.deepEqual(
    compatibleOf(prusa).map((e) => e.name),
    ['Prusament PLA', 'Prusament PETG'],
  );
});

test('an empty choice shows every preset – the state an untouched install is in', () => {
  const list = presets();
  assert.deepEqual(names(filterSystemFilaments(list, 'Prusament PLA', [], false)), names(list));
  // the same, whichever preset is selected
  assert.deepEqual(names(filterSystemFilaments(list, 'Prusament PETG', [], false)), names(list));
});

test('a choice keeps the chosen presets, every custom one, the defaults and the selected one', () => {
  const filtered = filterSystemFilaments(presets(), 'Prusament PETG', ['Prusament PLA'], false);
  assert.deepEqual(names(filtered), ['- default FFF -', 'Prusament PLA', 'Prusament PETG', 'My PETG']);
});

test('the selected preset is shown even when it is not ticked', () => {
  // a user preset has no tick at all, and a system one the user missed keeps showing while it is active
  assert.deepEqual(names(filterSystemFilaments(presets(), 'My PETG', ['Prusament PLA'], false)), [
    '- default FFF -',
    'Prusament PLA',
    'My PETG',
  ]);
  assert.deepEqual(names(filterSystemFilaments(presets(), 'Prusament PETG', ['Prusament PLA'], false)), [
    '- default FFF -',
    'Prusament PLA',
    'Prusament PETG',
    'My PETG',
  ]);
});

test('the escape hatch shows the whole list again', () => {
  assert.deepEqual(names(filterSystemFilaments(presets(), 'Prusament PETG', ['Prusament PLA'], true)), names(presets()));
});
