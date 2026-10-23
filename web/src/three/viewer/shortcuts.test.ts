/**
 * The shortcut table (R-7): the handler in `Viewer.tsx` and the About dialog's shortcut line both read
 * it, so the table itself is what has to be right. Every case below is a key the old handler answered
 * the same way – the table must not quietly change which key does what.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHORTCUTS, aboutShortcuts, matchesShortcut, shortcutsBlocked } from './shortcuts';

/** A `KeyboardEvent`-shaped object; `matchesShortcut` reads `key`, `code` and the three modifiers. */
const key = (k: string, mods: { ctrl?: boolean; meta?: boolean; shift?: boolean; code?: string } = {}) =>
  ({ key: k, code: mods.code ?? '', ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, shiftKey: !!mods.shift }) as KeyboardEvent;

/** The same event, but delivered from an element (what `e.target` is in the browser). */
const from = (el: Partial<HTMLElement>, k = 'Delete') => ({ ...key(k), target: el }) as unknown as KeyboardEvent;

test('the table lists every shortcut the handler had, once per spelling', () => {
  const ids = SHORTCUTS.map((s) => s.id);
  for (const id of [
    'views',
    'projection',
    'zoom',
    'delete',
    'addInstance',
    'removeInstance',
    'paintSupports',
    'paintSeam',
    'placeOnFace',
    'cut',
    'move',
    'rotate',
    'scale',
    'undo',
    'redo',
    'selectAll',
    'arrangeSelection',
    'arrange',
    'escape',
  ]) {
    assert.ok(ids.includes(id), `${id} is in the table`);
  }
  // redo has two spellings (Ctrl+Shift+Z and Ctrl+Y) – both are entries, not one entry with two keys
  assert.equal(ids.filter((id) => id === 'redo').length, 2);
});

test('the camera keys work without Ctrl, the file keys with it', () => {
  // keys 0…6, K and Z are guarded with !ctrl && !meta in the handler
  for (const k of ['0', '3', '6']) assert.equal(matchesShortcut(key(k), 'views'), true, `${k} is a view`);
  assert.equal(matchesShortcut(key('3', { ctrl: true }), 'views'), false, 'Ctrl+3 is not a view');
  assert.equal(matchesShortcut(key('k'), 'projection'), true);
  assert.equal(matchesShortcut(key('K', { meta: true }), 'projection'), false, 'Cmd+K is not the projection');
  assert.equal(matchesShortcut(key('z'), 'zoom'), true);
  assert.equal(matchesShortcut(key('z', { ctrl: true }), 'zoom'), false, 'Ctrl+Z is undo, not zoom');
});

test('undo and redo split on Shift, and Ctrl+Y redoes', () => {
  assert.equal(matchesShortcut(key('z', { ctrl: true }), 'undo'), true);
  assert.equal(matchesShortcut(key('z', { meta: true }), 'undo'), true, 'Cmd+Z undoes too');
  assert.equal(matchesShortcut(key('z', { ctrl: true, shift: true }), 'undo'), false);
  assert.equal(matchesShortcut(key('z', { ctrl: true, shift: true }), 'redo'), true);
  assert.equal(matchesShortcut(key('y', { ctrl: true }), 'redo'), true);
  assert.equal(matchesShortcut(key('z', { ctrl: true }), 'redo'), false);
});

test('Ctrl+A selects all and plain A arranges', () => {
  assert.equal(matchesShortcut(key('a', { ctrl: true }), 'selectAll'), true);
  assert.equal(matchesShortcut(key('a', { meta: true }), 'selectAll'), false, 'the handler only took ctrlKey');
  assert.equal(matchesShortcut(key('a', { ctrl: true }), 'arrange'), false, 'Ctrl+A is not arrange');
  // the handler's plain-A branch only guarded `!ctrlKey`, so Cmd+A falls through to it
  assert.equal(matchesShortcut(key('a', { meta: true }), 'arrange'), true, 'Cmd+A reaches arrange, as before');
  assert.equal(matchesShortcut(key('a'), 'arrange'), true);
  assert.equal(matchesShortcut(key('A'), 'arrange'), true, 'the uppercase spelling works');
});

test('Shift+A arranges only the selection', () => {
  assert.equal(matchesShortcut(key('a', { shift: true }), 'arrangeSelection'), true);
  assert.equal(matchesShortcut(key('A', { shift: true }), 'arrangeSelection'), true, 'the uppercase spelling works');
  assert.equal(matchesShortcut(key('a', { shift: true }), 'arrange'), false, 'Shift+A is not plain arrange');
  assert.equal(matchesShortcut(key('a'), 'arrangeSelection'), false, 'A alone does not arrange the selection');
  assert.equal(matchesShortcut(key('a', { shift: true, ctrl: true }), 'arrangeSelection'), false, 'Ctrl+Shift+A is not it');
});

test('the instance keys accept the numpad and the shifted spellings', () => {
  assert.equal(matchesShortcut(key('+'), 'addInstance'), true);
  assert.equal(matchesShortcut(key('='), 'addInstance'), true);
  assert.equal(matchesShortcut(key('', { code: 'NumpadAdd' }), 'addInstance'), true);
  assert.equal(matchesShortcut(key('-'), 'removeInstance'), true);
  assert.equal(matchesShortcut(key('_'), 'removeInstance'), true);
  assert.equal(matchesShortcut(key('', { code: 'NumpadSubtract' }), 'removeInstance'), true);
});

test('C opens the cut panel without Ctrl or Shift', () => {
  assert.equal(matchesShortcut(key('c'), 'cut'), true);
  assert.equal(matchesShortcut(key('C'), 'cut'), true);
  assert.equal(matchesShortcut(key('c', { ctrl: true }), 'cut'), false, 'Ctrl+C is not the cut panel');
  assert.equal(matchesShortcut(key('a'), 'cut'), false);
});

test('Del and Backspace both delete, Esc cancels', () => {
  assert.equal(matchesShortcut(key('Delete'), 'delete'), true);
  assert.equal(matchesShortcut(key('Backspace'), 'delete'), true);
  assert.equal(matchesShortcut(key('Escape'), 'escape'), true);
  assert.equal(matchesShortcut(key('Escape'), 'delete'), false);
});

test('B10: the one guard blocks every shortcut while a dialog is open or an input has focus', () => {
  // nothing in the table fires while a modal dialog owns the keyboard
  assert.equal(shortcutsBlocked(from({ tagName: 'BODY' }, 'Delete'), true), true);
  assert.equal(shortcutsBlocked(from({ tagName: 'BODY' }, 'z'), true), true);
  // the fields that take typing keep their keys: a preset name must not delete the selection
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
    assert.equal(shortcutsBlocked(from({ tagName }), false), true, `${tagName} keeps its keys`);
  }
  assert.equal(shortcutsBlocked(from({ isContentEditable: true }), false), true, 'a contenteditable keeps its keys');
  // and the plater still gets its shortcuts
  assert.equal(shortcutsBlocked(from({ tagName: 'CANVAS' }), false), false);
  assert.equal(shortcutsBlocked(key('Delete'), false), false, 'an event without a target is not blocked');
});

test('the About dialog lists the shortcuts in one line, without duplicates', () => {
  const about = aboutShortcuts();
  // the line in Dialogs.tsx: M · R · S · A · Shift+A · + · − · Del · Ctrl+A · 0…6 · K · Z · C
  assert.deepEqual(
    about.map((s) => s.label),
    [
      'move',
      'rotate',
      'scale',
      'arrange',
      'arrange selection',
      'add instance',
      'remove instance',
      'delete',
      'select all',
      'views',
      'perspective/ortho',
      'zoom to selection',
      'cut',
    ],
  );
  // every entry the dialog prints has keys to print
  assert.ok(about.every((s) => s.keys.length > 0 && (s.range || s.keys.length <= 3)));
  // the entries the dialog does not print are the mode keys, the paint keys and F2 rename (T-042)
  assert.deepEqual(
    SHORTCUTS.filter((s) => s.aboutAt === undefined)
      .map((s) => s.id)
      .sort(),
    ['escape', 'paintSeam', 'paintSupports', 'placeOnFace', 'redo', 'redo', 'rename', 'undo'],
  );
});
