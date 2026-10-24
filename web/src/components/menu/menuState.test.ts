/**
 * The menu's open/close state machine: one submenu at a time, a leave closes it, another item takes it
 * at once, a click never fights the hover, and Escape closes the submenu first and the menu second.
 * The rules are pure, so the whole task's behaviour is pinned here; `menu.spec.ts` drives the DOM.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLOSED, menuReducer, type MenuState } from './menuState';

/** The state an open menu is expected to be in; the reducer leaves `sub: undefined` in place. */
const open = (sub?: string): MenuState => (sub ? { open: true, sub } : { open: true });

test('a closed menu ignores the pointer; the trigger opens and closes it', () => {
  assert.deepEqual(menuReducer(CLOSED, { type: 'hoverItem', sub: 'export' }), CLOSED);
  assert.deepEqual(menuReducer(CLOSED, { type: 'leave' }), CLOSED);
  assert.deepEqual(menuReducer(CLOSED, { type: 'toggle' }), open());
  assert.deepEqual(menuReducer(open(), { type: 'toggle' }), CLOSED);
});

test('hovering a submenu item opens its flyout at once; a plain item closes the open flyout', () => {
  assert.deepEqual(menuReducer(open(), { type: 'hoverItem', sub: 'export' }), open('export'));
  assert.deepEqual(menuReducer(open('export'), { type: 'hoverItem' }), open());
});

test('another top-level item takes the submenu immediately – one flyout is always open at most', () => {
  assert.deepEqual(menuReducer(open('export'), { type: 'hoverItem', sub: 'second' }), open('second'));
});

test('the grace fired: the flyout closes and the menu stays for the pointer crossing the gap', () => {
  assert.deepEqual(menuReducer(open('export'), { type: 'leave' }), open());
  // without a flyout a leave changes nothing: the menu is not closed by a stray mouseleave
  assert.deepEqual(menuReducer(open(), { type: 'leave' }), open());
});

test('a click on a submenu item keeps it open and never toggles what the hover opened', () => {
  assert.deepEqual(menuReducer(open(), { type: 'clickItem', sub: 'export' }), open('export'));
  assert.deepEqual(menuReducer(open('export'), { type: 'clickItem', sub: 'export' }), open('export'));
  // a plain item runs and closes everything
  assert.deepEqual(menuReducer(open('export'), { type: 'clickItem' }), CLOSED);
});

test('Escape closes the flyout first and the menu second', () => {
  assert.deepEqual(menuReducer(open('export'), { type: 'escape' }), open());
  assert.deepEqual(menuReducer(open(), { type: 'escape' }), CLOSED);
});

test('ArrowRight enters a flyout, ArrowLeft leaves it', () => {
  assert.deepEqual(menuReducer(open(), { type: 'arrowRight', sub: 'export' }), open('export'));
  // an item without a flyout has nothing to enter
  assert.deepEqual(menuReducer(open(), { type: 'arrowRight' }), open());
  assert.deepEqual(menuReducer(open('export'), { type: 'arrowLeft' }), open());
  assert.deepEqual(menuReducer(open(), { type: 'arrowLeft' }), open());
});
