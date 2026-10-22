/**
 * B2: every place that remembers an extruder or a filament slot keeps its value inside the current
 * extruder count. The count is the length of `nozzle_diameter`; shrinking it (Printer Settings →
 * Extruders) used to leave an object's `extruder`, the MMU paint, the paint tool, `resetOption`,
 * `discardChanges` and `savePresetAs` on an index that no longer exists – reading
 * `filament[n].current` then threw a TypeError.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampExtruder, clampExtruderSlot, clampMmuPaint } from './extruders';

test('B2: a 1-based extruder value stays inside 1…count', () => {
  assert.equal(clampExtruder(3, 3), 3);
  assert.equal(clampExtruder(4, 3), 1, 'past the end falls back to extruder 1');
  assert.equal(clampExtruder(0, 1), 0, '0 means "default" and stays');
  assert.equal(clampExtruder(2, 1), 1);
  assert.equal(clampExtruder(Number.NaN, 2), 0);
  assert.equal(clampExtruder(-1, 2), 0);
  assert.equal(clampExtruder(1.5, 2), 1, 'a non-integer falls back to 1');
});

test('B2: a 0-based filament slot stays inside the list', () => {
  assert.equal(clampExtruderSlot(2, 3), 2);
  assert.equal(clampExtruderSlot(3, 3), 2, 'a removed slot falls back to the last one');
  assert.equal(clampExtruderSlot(5, 0), 0, 'an empty list still answers a valid index');
  assert.equal(clampExtruderSlot(-2, 3), 0);
  assert.equal(clampExtruderSlot(Number.NaN, 3), 0);
});

test('B2: MMU paint above the extruder count becomes extruder 1', () => {
  const paint = new Uint8Array([0, 1, 2, 3, 9]);
  const clamped = clampMmuPaint(paint, 2);
  assert.deepEqual([...clamped!], [0, 1, 2, 1, 1]);
  assert.equal(clampMmuPaint(paint, 9), paint, 'nothing to do keeps the array');
  assert.equal(clampMmuPaint(undefined, 2), undefined);
});
