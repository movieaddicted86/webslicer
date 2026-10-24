/**
 * The strip's table and its fit (layout 3.0, L-4). The pill floats over the scene and must never wrap,
 * so which groups show and which move into the "⋯" menu is decided by a pure function of the room –
 * tested here without a browser. The table itself is checked too: one group per registry group, the
 * object commands in the groups the design gives them, and the first group never hidden.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OVERFLOW_WIDTH,
  SEPARATOR,
  STRIP_GROUPS,
  fitGroups,
  groupWidth,
  hiddenItems,
  itemName,
  itemsOfGroup,
  stripFits,
  stripRoom,
} from './stripLayout';
import { commandFacts } from '../../tools/stripCommands';
import { TOOLS } from '../../tools/registry';
import type { State } from '../../state/types';

test('the strip shows the four registry groups between its two object groups', () => {
  assert.deepEqual(STRIP_GROUPS, ['selection', 'instance', 'transform', 'paint', 'cut', 'layer']);
  const toolGroups = new Set(TOOLS.map((t) => t.group));
  for (const group of STRIP_GROUPS) {
    const tools = itemsOfGroup(group).filter((i) => i.kind === 'tool');
    if (tools.length) assert.ok(toolGroups.has(group as never), `${group} is a registry group`);
    else assert.ok(['selection', 'instance'].includes(group), `${group} is an object group and holds commands`);
  }
});

test('every tool of the registry appears in the strip exactly once', () => {
  const all = STRIP_GROUPS.flatMap((g) => itemsOfGroup(g));
  const ids = all.flatMap((i) => (i.kind === 'tool' ? [i.tool.id] : []));
  assert.deepEqual([...ids].sort(), TOOLS.map((t) => t.id).sort());
});

test('the object commands sit in the groups the design gives them', () => {
  assert.deepEqual(itemsOfGroup('selection').map(itemName), ['Delete selection']);
  assert.deepEqual(itemsOfGroup('instance').map(itemName), ['Add instance', 'Remove instance']);
  assert.deepEqual(
    itemsOfGroup('transform')
      .filter((i) => i.kind === 'command')
      .map(itemName),
    ['Arrange', 'Arrange settings'],
  );
});

test('a wide scene keeps every group and the whole strip fits', () => {
  const room = stripRoom(1600);
  assert.deepEqual(fitGroups(room, false), { visible: STRIP_GROUPS, hidden: [] });
  assert.equal(stripFits(room, false), true);
});

test('a narrow scene hides the trailing groups whole, never part of one', () => {
  const room = stripRoom(420);
  const { visible, hidden } = fitGroups(room, false);
  assert.ok(visible.length >= 1, 'the first group always stays');
  assert.deepEqual([...visible, ...hidden], STRIP_GROUPS, 'the split is a cut, not a reorder');
  assert.ok(hidden.length > 0, 'something moves into the menu');
});

test('the first group stays even when nothing else fits', () => {
  const { visible, hidden } = fitGroups(0, false);
  assert.deepEqual(visible, ['selection']);
  assert.deepEqual(hidden, STRIP_GROUPS.slice(1));
});

test('the room a hidden group needs includes the overflow button behind it', () => {
  const selection = groupWidth('selection', false) + SEPARATOR;
  const instance = groupWidth('instance', false) + SEPARATOR;
  // just too narrow for the second group plus the "⋯" button: it has to move into the menu
  const tight = selection + instance + OVERFLOW_WIDTH + SEPARATOR - 1;
  assert.deepEqual(fitGroups(tight, false).visible, ['selection']);
  assert.equal(fitGroups(tight + 1, false).visible.length > 1, true);
});

test('names cost room, so a band that fits icons may still hide groups', () => {
  const room = stripRoom(1000);
  assert.equal(stripFits(room, false), true);
  assert.equal(stripFits(room, true), false);
});

test('the band the cards leave free decides the fit, not the window', () => {
  // the mockup's 1440 px window with both cards open: every group fits, the names do not
  const band = 1440 - 64 - (276 + 12) - (344 + 12);
  assert.equal(stripFits(stripRoom(band), false), true);
  assert.equal(stripFits(stripRoom(band), true), false);
  // the same window with the panels hidden gives the pill the whole scene – still not enough for the
  // names, which need a window as wide as the mockup's at double size
  assert.equal(stripFits(stripRoom(1440 - 64 - 2 * 12), false), true);
  assert.equal(stripFits(stripRoom(1440 - 64 - 2 * 12), true), false);
  assert.equal(stripFits(stripRoom(2560 - 64 - 2 * 12), true), true);
  // a narrow band at the same window width hides the trailing groups
  assert.equal(stripFits(stripRoom(480), false), false);
});

test('the overflow menu lists every entry of the hidden groups, in strip order', () => {
  const hidden = STRIP_GROUPS.slice(2);
  const names = hiddenItems(hidden).map(itemName);
  assert.ok(names.includes('Move'));
  assert.ok(names.includes('Cut'));
  assert.ok(!names.includes('Delete selection'), 'the visible groups are not in the menu');
});

test('the facts the command rules read are the selection, its instances and the plate', () => {
  const state = {
    objects: [
      { id: 'a', instances: [{ id: '1' }, { id: '2' }] },
      { id: 'b', instances: [{ id: '3' }] },
    ],
    selectedIds: ['a'],
  } as unknown as Pick<State, 'objects' | 'selectedIds'>;
  assert.deepEqual(commandFacts(state), { selected: 1, instances: 2, objects: 2 });
  // a paint stroke rewrites the objects but not these three numbers, so the strip does not re-render
  assert.deepEqual(commandFacts({ ...state, selectedIds: [] }), { selected: 0, instances: 0, objects: 2 });
});
