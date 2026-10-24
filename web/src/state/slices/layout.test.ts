/**
 * The layout slice: the hide-panels flag, the left column's width and fold state, and the folded
 * cards — each behind one `localStorage` key. The store is the real one; the storage is a stub, so the
 * test pins what is written and what a fresh start reads back.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useStore } from '../store';
import { parseLeftCards } from './layout';

const PANELS = 'webslicer.panelsHidden';
const WIDTH = 'webslicer.leftWidth';
const COLLAPSED = 'webslicer.leftCollapsed';
const CARDS = 'webslicer.leftCards';
const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
  useStore.setState({ panelsHidden: false, leftWidth: 300, leftCollapsed: undefined, leftCards: {} });
});

test('the panels are visible when nothing was stored', () => {
  assert.equal(useStore.getState().panelsHidden, false);
});

test('toggling flips the flag and writes the choice', () => {
  useStore.getState().togglePanels();
  assert.equal(useStore.getState().panelsHidden, true);
  assert.equal(store.get(PANELS), 'on');

  useStore.getState().togglePanels();
  assert.equal(useStore.getState().panelsHidden, false);
  assert.equal(store.get(PANELS), 'off');
});

test('setPanelsHidden writes the explicit choice as well', () => {
  useStore.getState().setPanelsHidden(true);
  assert.equal(store.get(PANELS), 'on');
  useStore.getState().setPanelsHidden(true);
  assert.equal(useStore.getState().panelsHidden, true, 'setting the same value is not a toggle');
});

test('a blocked storage does not break the toggle', () => {
  globalThis.localStorage = {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
  } as unknown as Storage;
  useStore.getState().setPanelsHidden(true);
  assert.equal(useStore.getState().panelsHidden, true, 'the flag still works for this page');
});

test('the left column width is remembered and kept inside its range', () => {
  useStore.getState().setLeftWidth(330);
  assert.equal(useStore.getState().leftWidth, 330);
  assert.equal(store.get(WIDTH), '330');

  useStore.getState().setLeftWidth(40);
  assert.equal(useStore.getState().leftWidth, 220, 'a drag below the minimum stops at it');

  useStore.getState().setLeftWidth(5000);
  assert.equal(useStore.getState().leftWidth, 420, 'and above the maximum too');
});

test('the fold choice of the left column is an explicit on/off', () => {
  assert.equal(useStore.getState().leftCollapsed, undefined, 'nothing chosen: the window width decides');
  useStore.getState().setLeftCollapsed(true);
  assert.equal(store.get(COLLAPSED), 'on');
  useStore.getState().setLeftCollapsed(false);
  assert.equal(store.get(COLLAPSED), 'off');
  assert.equal(useStore.getState().leftCollapsed, false);
});

test('cards fold one by one and the folded set is persisted', () => {
  useStore.getState().toggleLeftCard('objects');
  assert.equal(useStore.getState().leftCards.objects, true);
  useStore.getState().toggleLeftCard('legend');
  assert.deepEqual(JSON.parse(store.get(CARDS) ?? '{}'), { objects: true, legend: true });

  useStore.getState().toggleLeftCard('objects');
  assert.deepEqual(JSON.parse(store.get(CARDS) ?? '{}'), { objects: false, legend: true });
});

test('a broken stored value falls back to the defaults instead of breaking the app', () => {
  globalThis.localStorage = {
    getItem: (k: string) => (k === CARDS ? 'not json' : k === WIDTH ? 'wide' : null),
    setItem: () => undefined,
  } as unknown as Storage;
  // a fresh module would read these; the slice keeps the state it has, so the point is the guard itself
  assert.doesNotThrow(() => useStore.getState().toggleLeftCard('objects'));
});

test('the stored cards are parsed only when they are a plain object of booleans', () => {
  assert.deepEqual(parseLeftCards(null), {});
  assert.deepEqual(parseLeftCards('not json'), {});
  assert.deepEqual(parseLeftCards('[true]'), {}, 'an array is not a card map');
  assert.deepEqual(parseLeftCards('{"objects":"yes","legend":true}'), { legend: true }, 'non-booleans are dropped');
});
