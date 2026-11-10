/**
 * The guided start's state machine (T-100): when a fresh start opens the flow, what Next and Back do,
 * the model condition of the first step, and leaving to the free layout. The store's actions are
 * exercised on the real store, so the slice wiring is covered as well.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { canAdvance, nextStep, previousStep, startStep } from './guidedFlow';
import { useStore } from './store';

beforeEach(() => {
  useStore.setState({ flowStep: undefined, objects: [], guidedStart: true });
});

test('a phone with the preference and an empty plate opens step 1', () => {
  assert.equal(startStep({ phone: true, enabled: true, objectsPresent: false }), 1);
});

test('no flow off a phone, with the preference off, or when the session restored a model', () => {
  assert.equal(startStep({ phone: false, enabled: true, objectsPresent: false }), undefined);
  assert.equal(startStep({ phone: true, enabled: false, objectsPresent: false }), undefined);
  // the reload rule: a model on the plate opens the free layout, never the flow
  assert.equal(startStep({ phone: true, enabled: true, objectsPresent: true }), undefined);
});

test('Next walks 1 → 2 → 3 → 4 and the last step has none', () => {
  assert.equal(nextStep(1), 2);
  assert.equal(nextStep(2), 3);
  assert.equal(nextStep(3), 4);
  assert.equal(nextStep(4), undefined);
});

test('Back walks 4 → 3 → 2 → 1 and the first step has none', () => {
  assert.equal(previousStep(4), 3);
  assert.equal(previousStep(3), 2);
  assert.equal(previousStep(2), 1);
  assert.equal(previousStep(1), undefined);
});

test('only the model step needs a model before Next', () => {
  assert.equal(canAdvance(1, { objectsPresent: false }), false);
  assert.equal(canAdvance(1, { objectsPresent: true }), true);
  for (const step of [2, 3, 4] as const) assert.equal(canAdvance(step, { objectsPresent: false }), true);
});

test('the store: start, Next is blocked by an empty plate, Back, and Skip returns to free mode', () => {
  const s = () => useStore.getState();
  s().startFlow();
  assert.equal(s().flowStep, 1);
  // step 1 without a model cannot advance
  s().nextFlowStep();
  assert.equal(s().flowStep, 1);
  useStore.setState({ objects: [{ id: 'obj-1' } as never] });
  s().nextFlowStep();
  assert.equal(s().flowStep, 2);
  s().nextFlowStep();
  s().nextFlowStep();
  assert.equal(s().flowStep, 4);
  // the last step has no Next: the step stays
  s().nextFlowStep();
  assert.equal(s().flowStep, 4);
  s().previousFlowStep();
  assert.equal(s().flowStep, 3);
  // Skip/More settings leaves to the free layout and keeps the plate
  s().leaveFlow();
  assert.equal(s().flowStep, undefined);
  assert.equal(useStore.getState().objects.length, 1);
});

test('the preference is remembered and switching it off leaves the flow', () => {
  const written = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => written.get(k) ?? null,
    setItem: (k: string, v: string) => void written.set(k, String(v)),
    removeItem: (k: string) => void written.delete(k),
    clear: () => written.clear(),
    key: () => null,
    length: 0,
  } as Storage;
  const s = () => useStore.getState();
  s().startFlow();
  assert.equal(s().flowStep, 1);
  s().setGuidedStart(false);
  assert.equal(s().guidedStart, false);
  assert.equal(written.get('webslicer.guidedStart'), 'off');
  assert.equal(s().flowStep, undefined, 'the flow closes when the preference is switched off');
});

test('Back on the first step is a no-op, and the store never invents a step off the flow', () => {
  const s = () => useStore.getState();
  s().previousFlowStep();
  assert.equal(s().flowStep, undefined);
  s().nextFlowStep();
  assert.equal(s().flowStep, undefined);
  s().startFlow();
  s().previousFlowStep();
  assert.equal(s().flowStep, 1);
});
