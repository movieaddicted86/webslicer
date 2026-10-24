/**
 * The context-mode selector: the four modes, the precedence of the design, and that a stale id or a
 * settings view cannot fake a selection. The visibility mode (simple/advanced/expert) is deliberately
 * not part of the answer – it changes how much of a mode's body is rendered, not which mode it is.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseMode, contextMode, type ContextModeInput } from './contextMode';

const object = { id: 'o1' };
const input = (patch: Partial<ContextModeInput> = {}): ContextModeInput => ({
  view: 'plater',
  selectedIds: [],
  objects: [object],
  ...patch,
});

test('nothing selected on the plater is plate mode', () => {
  assert.equal(contextMode(input()), 'plate');
});

test('a selected object is object mode', () => {
  assert.equal(contextMode(input({ selectedIds: ['o1'] })), 'object');
});

test('the preview wins over the selection: its panel keeps the whole column', () => {
  assert.equal(contextMode(input({ view: 'preview', selectedIds: ['o1'] })), 'preview');
});

test('an open tool wins over the preview and the selection', () => {
  assert.equal(contextMode(input({ activeTool: 'cut', view: 'preview', selectedIds: ['o1'] })), 'tool');
});

test('a selection that names no object on the plater does not hold object mode', () => {
  assert.equal(contextMode(input({ selectedIds: ['gone'] })), 'plate');
});

test('a settings view is not object mode: the panel is not rendered there', () => {
  assert.equal(contextMode(input({ view: 'print', selectedIds: ['o1'] })), 'object');
  assert.equal(contextMode(input({ view: 'print' })), 'plate');
});

test('several selected objects are object mode (the panel shows the selection summary)', () => {
  assert.equal(contextMode(input({ selectedIds: ['o1', 'o2'], objects: [object, { id: 'o2' }] })), 'object');
});

test('the mode does not depend on simple/advanced/expert, only the body does', () => {
  for (const mode of ['simple', 'advanced', 'expert']) {
    const withMode = { ...input({ selectedIds: ['o1'] }), mode } as ContextModeInput;
    assert.equal(contextMode(withMode), 'object', `${mode} is object mode`);
    assert.equal(contextMode({ ...withMode, selectedIds: [] }), 'plate', `${mode} is plate mode without a selection`);
  }
});

test('the rendered mode falls back to plate or object while the tool dock still lives by the bar', () => {
  assert.equal(baseMode(input({ activeTool: 'cut', selectedIds: ['o1'] })), 'object');
  assert.equal(baseMode(input({ activeTool: 'cut' })), 'plate');
  assert.equal(baseMode(input({ view: 'preview' })), 'preview');
});
