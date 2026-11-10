/**
 * The phone's guided start (T-100): the four steps from a model to a print, as a pure state machine.
 *
 * The store holds only the current step (`flowStep` in the UI slice) – the steps themselves render
 * the components the free layout already has (preset rows, quick settings, the slice footer's
 * destination and Slice panel), so the flow is a second path through the app and never a second
 * implementation of it. The rules are here, so they are unit-tested without a browser: Next needs a
 * model on the plate, the last step has no Next, the first no Back, and a session that restored a
 * model starts in the free layout – the flow is the start screen of an *empty* plate only.
 */

/** One of the flow's four cards, in order: the model, printer and profiles, settings, ready. */
export type FlowStep = 1 | 2 | 3 | 4;

/** The steps in the order the indicator counts them ("1 / 4"). */
export const FLOW_STEPS: readonly FlowStep[] = [1, 2, 3, 4];

/** The card's title, in the house style of the phone UI (sentence case). */
export const FLOW_TITLES: Record<FlowStep, string> = {
  1: 'Pick a model',
  2: 'Printer and profiles',
  3: 'Settings',
  4: 'Ready to print?',
};

/** What the app decides at the start: a phone, the preference, and whether the plate is still empty. */
export interface FlowStart {
  /** the phone layout (below 640 px) – the flow has no other screen */
  phone: boolean;
  /** the preference "Guided start on phones" */
  enabled: boolean;
  /** the session restore put a model on the plate (a reload of a working session) */
  objectsPresent: boolean;
}

/** The step a fresh start opens on, or `undefined` for the free layout (no flow). */
export function startStep(f: FlowStart): FlowStep | undefined {
  return f.phone && f.enabled && !f.objectsPresent ? 1 : undefined;
}

/** Whether the current step may advance; only the model step has a condition (a model on the plate). */
export function canAdvance(step: FlowStep, facts: { objectsPresent: boolean }): boolean {
  return step === 1 ? facts.objectsPresent : true;
}

/** The step after this one, or `undefined` when the last one has no Next. */
export function nextStep(step: FlowStep): FlowStep | undefined {
  return step < FLOW_STEPS.length ? ((step + 1) as FlowStep) : undefined;
}

/** The step before this one, or `undefined` on the first (no Back). */
export function previousStep(step: FlowStep): FlowStep | undefined {
  return step > 1 ? ((step - 1) as FlowStep) : undefined;
}
