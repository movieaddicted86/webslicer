/**
 * The layout slice: the hide-panels flag and the one `localStorage` key behind it. The store is the
 * real one; the storage is a stub, so the test pins what is written and what a fresh start reads back.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useStore } from '../store';

const KEY = 'webslicer.panelsHidden';
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
  useStore.setState({ panelsHidden: false });
});

test('the panels are visible when nothing was stored', () => {
  assert.equal(useStore.getState().panelsHidden, false);
});

test('toggling flips the flag and writes the choice', () => {
  useStore.getState().togglePanels();
  assert.equal(useStore.getState().panelsHidden, true);
  assert.equal(store.get(KEY), 'on');

  useStore.getState().togglePanels();
  assert.equal(useStore.getState().panelsHidden, false);
  assert.equal(store.get(KEY), 'off');
});

test('setPanelsHidden writes the explicit choice as well', () => {
  useStore.getState().setPanelsHidden(true);
  assert.equal(store.get(KEY), 'on');
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
