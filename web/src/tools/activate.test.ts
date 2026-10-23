/**
 * The tool lifecycle (T-046): `activateTool`/`exitTool` are the only way in and out. The bar, the
 * shortcut handler and the panel host all call them, so the toggling, the availability refusal and
 * the `onEnter`/`onExit` pairing are tested once here, against a host that records what it got.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activateTool, exitTool, type ToolHost } from './activate';
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
  assert.deepEqual(activateTool(result, 'move'), { ok: true });
  assert.equal(mutable.activeTool, 'move');
  assert.deepEqual(calls, ['transform:translate']);
});

test('the open tool toggles off by its own id, without running it again', () => {
  const { result, mutable, calls } = host();
  activateTool(result, 'rotate');
  assert.deepEqual(activateTool(result, 'rotate'), { ok: true });
  assert.equal(mutable.activeTool, undefined);
  assert.deepEqual(calls, ['transform:rotate'], 'onEnter ran once, a second click only closes');
});

test('opening another tool closes the first one first', () => {
  const { result, mutable } = host();
  activateTool(result, 'move');
  activateTool(result, 'scale');
  assert.equal(mutable.activeTool, 'scale');
});

test('an unavailable tool stays closed and returns the reason the bar shows as tooltip', () => {
  const { result, mutable } = host({ selectedIds: [] });
  assert.deepEqual(activateTool(result, 'cut'), { ok: false, reason: 'Select one object' });
  assert.equal(mutable.activeTool, undefined, 'nothing opened');
});

test('closing a closed tool does nothing', () => {
  const { result, calls } = host();
  exitTool(result);
  assert.deepEqual(calls, [], 'no lifecycle of a tool that was not open');
});

test('the transform tools share the one transform mode – only one is shown as active', () => {
  assert.deepEqual(
    TOOLS.filter((t) => t.group === 'transform').map((t) => t.id),
    ['move', 'rotate', 'scale'],
  );
  assert.equal(toolById('cut')?.panel, 'cut');
  assert.equal(toolById('move')?.panel, undefined, 'a transform tool has no panel');
});
