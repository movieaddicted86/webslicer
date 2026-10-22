/**
 * The autosave lifecycle (T-035): a hidden page flushes the pending save, and emptying the plater
 * drops the stored autosave instead of letting a reload bring it back.
 *
 * The store is the real one; `autosaveNow` and `discardAutosave` are replaced with counters, so the
 * test pins *when* the lifecycle asks for a save, not the request it builds (that is `job.ts`).
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useStore } from './store';
import { installAutosave } from './autosave';

/** The listeners `installAutosave` registers, so the test can fire the events the browser fires. */
const listeners: Record<string, Array<() => void>> = {};
const fakeDocument = {
  visibilityState: 'visible' as 'visible' | 'hidden',
  addEventListener: (type: string, fn: () => void) => void (listeners[type] ??= []).push(fn),
  removeEventListener: (type: string, fn: () => void) => {
    listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn);
  },
};
const fakeWindow = fakeDocument;

const calls = { save: 0, keepalive: 0, discard: 0 };
let uninstall: (() => void) | undefined;

const object = (id: string) => ({
  id,
  name: `${id}.stl`,
  modelId: `m-${id}`,
  geometry: undefined,
  size: [10, 10, 10] as [number, number, number],
  config: {},
  extruder: 0,
  visible: true,
  triangles: 12,
  instances: [
    {
      id: `${id}-i`,
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
    },
  ],
  volumes: [],
  ranges: [],
});

beforeEach(() => {
  uninstall?.();
  calls.save = calls.keepalive = calls.discard = 0;
  for (const k of Object.keys(listeners)) delete listeners[k];
  (globalThis as { document?: unknown }).document = fakeDocument;
  (globalThis as { window?: unknown }).window = fakeWindow;
  (globalThis as { fetch: unknown }).fetch = async () =>
    new Response(JSON.stringify({ ok: true, savedAt: new Date().toISOString() }), {
      headers: { 'Content-Type': 'application/json' },
    });
  useStore.setState({
    ready: true,
    objects: [],
    autosaveState: 'idle',
    autosaveError: undefined,
    autosaveNow: async (opts?: { keepalive?: boolean }) => {
      calls.save++;
      if (opts?.keepalive) calls.keepalive++;
      return true;
    },
    discardAutosave: async () => {
      calls.discard++;
      useStore.setState({ autosaveError: undefined });
    },
  });
  uninstall = installAutosave();
});

test('hiding the page flushes the pending autosave with keepalive', async () => {
  useStore.setState({ objects: [object('a')] as never });
  fakeDocument.visibilityState = 'hidden';
  for (const fn of listeners.visibilitychange ?? []) fn();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(calls.save, 1);
  assert.equal(calls.keepalive, 1, 'the request must outlive the page');
});

test('pagehide flushes too, and a visible page does not', async () => {
  useStore.setState({ objects: [object('b')] as never });
  fakeDocument.visibilityState = 'visible';
  for (const fn of listeners.visibilitychange ?? []) fn();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(calls.save, 0, 'coming back to the tab saves nothing');
  for (const fn of listeners.pagehide ?? []) fn();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(calls.save, 1);
});

test('emptying the plater drops the stored autosave ("Delete all" / "Start empty")', async () => {
  useStore.setState({ objects: [object('c')] as never });
  useStore.setState({ objects: [] });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(calls.discard, 1);
  assert.equal(calls.save, 0, 'an empty plater is not saved');
});

test('uninstall removes the listeners', () => {
  uninstall?.();
  uninstall = undefined;
  assert.equal((listeners.visibilitychange ?? []).length, 0);
  assert.equal((listeners.pagehide ?? []).length, 0);
});
