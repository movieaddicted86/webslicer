/**
 * The selection rule the object list and the Library share: what a plain, a Ctrl/Cmd and a Shift
 * click do, and what follows for a group action. The rule is pure, so every case is a plain
 * comparison – the components only hand their clicks over.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { allVisible, mergeRule, modsOf, rangeBetween, selectionAfterClick, visibilityTitle } from './selection';

const order = ['a', 'b', 'c', 'd', 'e'];
const plain = { ctrl: false, shift: false };
const ctrl = { ctrl: true, shift: false };
const shift = { ctrl: false, shift: true };

test('a plain click selects only that row and moves the anchor to it', () => {
  assert.deepEqual(selectionAfterClick(order, ['a', 'b'], 'a', 'c', plain), { ids: ['c'], anchor: 'c' });
});

test('Ctrl/Cmd toggles one row and leaves the rest of the selection alone', () => {
  assert.deepEqual(selectionAfterClick(order, ['a', 'c'], 'a', 'd', ctrl).ids, ['a', 'c', 'd']);
  assert.deepEqual(selectionAfterClick(order, ['a', 'c'], 'a', 'c', ctrl).ids, ['a']);
  // the clicked row becomes the anchor, so the next Shift click ranges from it
  assert.equal(selectionAfterClick(order, ['a'], 'a', 'd', ctrl).anchor, 'd');
});

test('Shift selects the range from the anchor to the clicked row, both included', () => {
  assert.deepEqual(selectionAfterClick(order, ['b'], 'b', 'd', shift).ids, ['b', 'c', 'd']);
  // and the same range upwards
  assert.deepEqual(selectionAfterClick(order, ['d'], 'd', 'b', shift).ids, ['b', 'c', 'd']);
  assert.deepEqual(selectionAfterClick(order, ['a'], 'a', 'a', shift).ids, ['a']);
});

test('a Shift range keeps its anchor, so the next Shift click extends the same range', () => {
  const first = selectionAfterClick(order, ['b'], 'b', 'd', shift);
  assert.equal(first.anchor, 'b');
  assert.deepEqual(selectionAfterClick(order, first.ids, first.anchor, 'e', shift).ids, ['b', 'c', 'd', 'e']);
  // shrinking back to the anchor itself
  assert.deepEqual(selectionAfterClick(order, first.ids, first.anchor, 'b', shift).ids, ['b']);
});

test('a Shift click without an anchor behaves like a plain click', () => {
  assert.deepEqual(selectionAfterClick(order, ['a'], null, 'c', shift), { ids: ['c'], anchor: 'c' });
  // an anchor that left the list (deleted, a new file) cannot range
  assert.deepEqual(selectionAfterClick(order, ['a'], 'gone', 'c', shift), { ids: ['c'], anchor: 'c' });
});

test('a click on a row the list no longer shows changes nothing', () => {
  assert.deepEqual(selectionAfterClick(order, ['a', 'b'], 'a', 'gone', plain), { ids: ['a', 'b'], anchor: 'a' });
  // a first click on a stale id still leaves an anchor to range from later
  assert.deepEqual(selectionAfterClick(order, [], undefined, 'gone', plain), { ids: [], anchor: 'gone' });
});

test('the range helper returns the same slice as the Shift rule', () => {
  assert.deepEqual(rangeBetween(order, 'b', 'd'), ['b', 'c', 'd']);
  assert.deepEqual(rangeBetween(order, 'd', 'b'), ['b', 'c', 'd']);
  // a stale anchor falls back to the one clicked row, like the rule itself
  assert.deepEqual(rangeBetween(order, 'gone', 'c'), ['c']);
});

test('Cmd counts as Ctrl for a toggle and Shift stays Shift', () => {
  assert.deepEqual(modsOf({ ctrlKey: false, metaKey: true, shiftKey: false }), { ctrl: true, shift: false });
  assert.deepEqual(modsOf({ ctrlKey: false, metaKey: false, shiftKey: true }), { ctrl: false, shift: true });
  assert.deepEqual(modsOf({ ctrlKey: true, metaKey: false, shiftKey: true }), { ctrl: true, shift: true });
});

test('merge needs two or more objects with one instance each', () => {
  const one = { instances: [{}] };
  const two = { instances: [{}, {}] };
  assert.equal(mergeRule([one, one]).ok, true);
  assert.equal(mergeRule([one]).ok, false);
  assert.equal(mergeRule([]).ok, false);
  assert.equal(mergeRule([one, two]).ok, false);
  assert.match(mergeRule([one, two]).reason, /single instance/);
  assert.match(mergeRule([one]).reason, /two or more/);
});

test('the hide/show toggle starts from whether all of the selection is visible', () => {
  assert.equal(allVisible([{ visible: true }, { visible: true }]), true);
  assert.equal(allVisible([{ visible: true }, { visible: false }]), false);
  assert.equal(allVisible([]), false);
  assert.equal(visibilityTitle([{ visible: true }]), 'Hide the selected objects');
  assert.equal(visibilityTitle([{ visible: false }]), 'Show the selected objects');
});
