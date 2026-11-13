/**
 * The guided start's state machine: when a fresh start opens the flow, what Next and Back do, the
 * model condition of the first step, leaving to the free layout, and the preference's storage key
 * including the migration of the phone's old one. The store's actions are exercised on the real
 * store, so the slice wiring is covered as well.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  canAdvance,
  flowOpensOnEmpty,
  GUIDED_START_KEY,
  GUIDED_START_PHONE_KEY,
  nextStep,
  previousStep,
  readGuidedStartPreference,
  startStep,
} from './guidedFlow';
import { useStore } from './store';

beforeEach(() => {
  useStore.setState({ flowStep: undefined, objects: [], guidedStart: true });
});

/** A `localStorage` double: the preference is the only thing this module reads and writes. */
function storageWith(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
  };
}

test('any layout with the preference and an empty plate opens step 1', () => {
  assert.equal(startStep({ enabled: true, objectsPresent: false }), 1);
});

test('no flow with the preference off, or when the session restored a model', () => {
  assert.equal(startStep({ enabled: false, objectsPresent: false }), undefined);
  // the reload rule: a model on the plate opens the free layout, never the flow
  assert.equal(startStep({ enabled: true, objectsPresent: true }), undefined);
});

test('an empty plate reopens the flow, unless the skip question was answered', () => {
  const base = { enabled: true, objectsPresent: false, dismissed: false };
  assert.equal(flowOpensOnEmpty(base), true);
  // the toggle: with the preference off, a full plate, or after the skip answer
  assert.equal(flowOpensOnEmpty({ ...base, enabled: false }), false);
  assert.equal(flowOpensOnEmpty({ ...base, objectsPresent: true }), false);
  assert.equal(flowOpensOnEmpty({ ...base, dismissed: true }), false);
});

test('the preference defaults on, and either key answers it', () => {
  assert.equal(readGuidedStartPreference(storageWith()), true, 'no key at all means on');
  assert.equal(readGuidedStartPreference(storageWith({ [GUIDED_START_KEY]: 'on' })), true);
  assert.equal(readGuidedStartPreference(storageWith({ [GUIDED_START_KEY]: 'off' })), false);
});

test('the phone’s old key is migrated: off stays off, on stays on, and the old key goes', () => {
  const off = storageWith({ [GUIDED_START_PHONE_KEY]: 'off' });
  assert.equal(readGuidedStartPreference(off), false);
  assert.equal(off.map.get(GUIDED_START_KEY), 'off', 'the answer moved to the shared key');
  assert.equal(off.map.has(GUIDED_START_PHONE_KEY), false, 'the old key is removed');

  const on = storageWith({ [GUIDED_START_PHONE_KEY]: 'on' });
  assert.equal(readGuidedStartPreference(on), true);
  assert.equal(on.map.get(GUIDED_START_KEY), 'on');

  // the shared key wins, so a second read never re-applies an old answer
  const both = storageWith({ [GUIDED_START_KEY]: 'on', [GUIDED_START_PHONE_KEY]: 'off' });
  assert.equal(readGuidedStartPreference(both), true);
});

test('leaving the flow suppresses it on an empty plate only, until a model arrives', () => {
  const s = () => useStore.getState();
  useStore.setState({ objects: [], flowDismissed: false });
  s().startFlow();
  s().leaveFlow();
  assert.equal(s().flowStep, undefined);
  assert.equal(s().flowDismissed, true, 'the skip answer holds on the empty plate');
  // "Don't show again" switches the preference off as well; "Yes" only closes this episode
  useStore.setState({ objects: [{ id: 'obj-1' } as never], flowDismissed: false });
  s().startFlow();
  s().leaveFlow();
  assert.equal(s().flowDismissed, false, 'a plate with a model leaves nothing to suppress');
  // the next start clears an earlier answer
  useStore.setState({ objects: [], flowDismissed: true });
  s().startFlow();
  assert.equal(s().flowDismissed, false);
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
  const written = storageWith();
  globalThis.localStorage = {
    getItem: written.getItem,
    setItem: written.setItem,
    removeItem: written.removeItem,
    clear: () => written.map.clear(),
    key: () => null,
    length: 0,
  } as Storage;
  const s = () => useStore.getState();
  s().startFlow();
  assert.equal(s().flowStep, 1);
  s().setGuidedStart(false);
  assert.equal(s().guidedStart, false);
  assert.equal(written.map.get(GUIDED_START_KEY), 'off');
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
