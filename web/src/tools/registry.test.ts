/**
 * The registry's key hints (layout 3.0, L-4): the hint block at the end of a tool's panel is part of
 * the tool's registration, so a new tool with a panel cannot ship without one. The block renders from
 * the same array, and the mouse icons come from the icon table – both are checked here, without a
 * browser.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, TOOL_GROUPS, isToolActive, toolById, toolsInGroup } from './registry';
import { ICON_TABLE } from '../icons/table';

test('every tool with a panel carries at least one hint', () => {
  for (const tool of TOOLS) {
    if (!tool.panel) continue;
    assert.ok(tool.hints?.length, `${tool.id} has key hints`);
    for (const hint of tool.hints ?? []) {
      assert.ok(hint.text.trim().length > 0, `${tool.id}: every hint says what it does`);
      // a hint that shows nothing (no key, no mouse) tells the user nothing
      assert.ok(hint.keys?.length || hint.mouse, `${tool.id}: "${hint.text}" shows a key or a mouse button`);
      for (const key of hint.keys ?? []) assert.ok(key.trim().length > 0, `${tool.id}: an empty key chip`);
    }
  }
});

test('a tool without a panel has no hint block to fill', () => {
  for (const tool of TOOLS) if (!tool.panel) assert.equal(tool.hints, undefined, `${tool.id} has no panel`);
});

test('every mouse gesture of a hint has an icon in the table', () => {
  const icons = { left: 'mouseLeft', right: 'mouseRight', wheel: 'mouseWheel', drag: 'mouseDrag' } as const;
  const used = new Set(TOOLS.flatMap((t) => (t.hints ?? []).map((h) => h.mouse)).filter((m): m is keyof typeof icons => !!m));
  assert.deepEqual([...used].sort(), ['drag', 'left', 'right', 'wheel'], 'the tools use the four gestures');
  for (const mouse of used) assert.ok(icons[mouse] in ICON_TABLE, `${mouse} has a mouse icon`);
});

test('the strip groups are the registry groups, in strip order', () => {
  assert.deepEqual(TOOL_GROUPS, ['transform', 'paint', 'cut', 'layer']);
  for (const group of TOOL_GROUPS) assert.ok(toolsInGroup(group).length > 0, `${group} has a tool`);
});

test('every tool belongs to exactly one strip group', () => {
  const seen = TOOLS.flatMap((t) => TOOL_GROUPS.filter((g) => g === t.group));
  assert.deepEqual(seen.sort(), TOOLS.map((t) => t.group).sort());
});

test('the transform tools light up by mode while no panel is open, and only then', () => {
  assert.equal(isToolActive(toolById('move')!, { transformMode: 'translate' }), true);
  assert.equal(isToolActive(toolById('move')!, { transformMode: 'rotate' }), false);
  assert.equal(isToolActive(toolById('rotate')!, { transformMode: 'rotate' }), true);
  assert.equal(isToolActive(toolById('cut')!, { transformMode: 'rotate' }), false, 'a panel tool is never implied');
  assert.equal(isToolActive(toolById('cut')!, { activeTool: 'cut', transformMode: 'translate' }), true);
  assert.equal(isToolActive(toolById('move')!, { activeTool: 'cut', transformMode: 'translate' }), false);
});
