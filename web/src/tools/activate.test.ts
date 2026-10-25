/**
 * The tool lifecycle (T-046): `activateTool`/`exitTool` are the only way in and out. The bar, the
 * shortcut handler and the panel host all call them, so the toggling, the availability refusal and
 * the `onEnter`/`onExit` pairing are tested once here, against a host that records what it got.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activateTool, exitTool, unshowableTool, type ToolHost } from './activate';
import { TOOLS, toolById } from './registry';
import type { State } from '../state/types';

/** A store stand-in: the fields the registry reads, and the calls the lifecycle makes. */
function host(overrides: Partial<State> = {}) {
  const calls: string[] = [];
  const state = {
    objects: [{ id: 'a', volumes: [], size: [10, 10, 10] }],
    selectedIds: ['a'],
    extruderCount: () => 1,
    setTransformMode: (mode: string) => calls.push(`transform:${mode}`),
    startPaint: (id: string, kind: string) => {
      calls.push(`paint:${kind}`);
      return Promise.resolve();
    },
    setCutSettings: () => calls.push('cut:settings'),
    ...overrides,
  } as unknown as State;
  const mutable = state as State & { activeTool?: string };
  const result: ToolHost = {
    getState: () => mutable,
    setState: (partial) => Object.assign(mutable, partial),
  };
  return { result, mutable, calls };
}

test('opening a tool sets activeTool and runs its onEnter', () => {
  const { result, mutable, calls } = host();
  assert.deepEqual(activateTool(result, 'cut'), { ok: true });
  assert.equal(mutable.activeTool, 'cut');
  assert.deepEqual(calls, ['cut:settings']);
});

test('a transform tool only sets its gizmo mode – it never becomes the open tool', () => {
  // it has no panel: making it `activeTool` put the context panel into an empty tool mode, which is
  // exactly the bug the fix closes
  const { result, mutable, calls } = host();
  assert.deepEqual(activateTool(result, 'move'), { ok: true });
  assert.equal(mutable.activeTool, undefined, 'no panel, so nothing to show');
  assert.deepEqual(calls, ['transform:translate'], 'its onEnter still runs');
});

test('the open tool toggles off by its own id, without running it again', () => {
  const { result, mutable, calls } = host();
  activateTool(result, 'paintSeam');
  assert.deepEqual(activateTool(result, 'paintSeam'), { ok: true });
  assert.equal(mutable.activeTool, undefined);
  assert.deepEqual(calls, ['paint:seam'], 'onEnter ran once, a second click only closes');
});

test('opening another tool closes the first one first', () => {
  const { result, mutable } = host();
  activateTool(result, 'cut');
  activateTool(result, 'layerHeight');
  assert.equal(mutable.activeTool, 'layerHeight');
});

test('opening a transform tool closes an open panel tool', () => {
  const { result, mutable, calls } = host();
  activateTool(result, 'cut');
  activateTool(result, 'rotate');
  assert.equal(mutable.activeTool, undefined, 'the panel falls back to object mode');
  assert.deepEqual(calls, ['cut:settings', 'transform:rotate']);
});

test('an unavailable tool stays closed and returns the reason the bar shows as tooltip', () => {
  const { result, mutable } = host({ selectedIds: [] });
  assert.deepEqual(activateTool(result, 'cut'), { ok: false, reason: 'Select one object' });
  assert.equal(mutable.activeTool, undefined, 'nothing opened');
});

test('a tool that is already marked open when onEnter runs – no recursion', () => {
  // a paint tool's onEnter calls the store's startPaint, which opens the same tool through openTool
  // (the shortcut and the bar come in the same way). The tool counts as open before onEnter, so the
  // nested call toggles instead of opening again – the recursion bug of the first E2E run.
  const calls: string[] = [];
  const state = {
    objects: [{ id: 'a', volumes: [], size: [10, 10, 10] }],
    selectedIds: ['a'],
    startPaint: (_id: string, kind: string) => {
      calls.push(`paint:${kind}:${state.activeTool}`);
      return Promise.resolve();
    },
  } as unknown as State & { activeTool?: string };
  const result: ToolHost = { getState: () => state, setState: (partial) => Object.assign(state, partial) };
  assert.deepEqual(activateTool(result, 'paintSupports'), { ok: true });
  assert.equal(state.activeTool, 'paintSupports');
  assert.deepEqual(calls, ['paint:supports:paintSupports'], 'onEnter saw its tool already active');
});

test('closing a closed tool does nothing', () => {
  const { result, calls } = host();
  exitTool(result);
  assert.deepEqual(calls, [], 'no lifecycle of a tool that was not open');
});

test('a tool whose precondition disappeared is reported as unshowable', () => {
  const cutOpen = host({ selectedIds: ['a'] }).mutable;
  assert.equal(unshowableTool(cutOpen), undefined, 'cut with its object is fine');
  // the selection dropped to two objects (or the object was deleted): cut cannot be shown any more
  const twoSelected = { ...cutOpen, activeTool: 'cut', selectedIds: ['a', 'b'] } as State;
  assert.equal(unshowableTool(twoSelected), 'cut');
  const objectGone = { ...cutOpen, activeTool: 'cut', objects: [], selectedIds: ['a'] } as State;
  assert.equal(unshowableTool(objectGone), 'cut');
});

test('a transform tool in activeTool is unshowable – it has no panel', () => {
  const { mutable } = host();
  const stale = { ...mutable, activeTool: 'move' } as State;
  assert.equal(unshowableTool(stale), 'move');
});

test('no open tool is never unshowable', () => {
  const { mutable } = host();
  assert.equal(unshowableTool(mutable), undefined);
});

test('the transform tools share the one transform mode – only one is shown as active', () => {
  // placeOnFace sits in the transform group since L-4 (PrusaSlicer's order), but it has a panel and
  // no transform mode of its own
  assert.deepEqual(
    TOOLS.filter((t) => t.group === 'transform' && !t.panel).map((t) => t.id),
    ['move', 'rotate', 'scale'],
  );
  assert.equal(toolById('cut')?.panel, 'cut');
  assert.equal(toolById('move')?.panel, undefined, 'a transform tool has no panel');
});

test('every tool carries a short bar label (T-055)', () => {
  for (const t of TOOLS) {
    assert.ok(t.label.trim().length > 0, `${t.id} has a label`);
    // the bar is capped at 170 px: a label that wraps or truncates makes the bar wider than that
    assert.ok(t.label.length <= 14, `${t.id}: "${t.label}" is a short label`);
  }
  assert.equal(toolById('layerHeight')?.label, 'Layer height');
});
