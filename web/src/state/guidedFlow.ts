/**
 * The guided start: the four steps from a model to a print, as a pure state machine.
 *
 * Since the desktop and the tablet took the flow over, the rules no longer know a layout: one start
 * rule covers every screen, and only the *shell* around the steps differs (the phone's bottom-sheet
 * card, the wide screen's floating card over the 3D view). The steps themselves render the
 * components the free layout already has (preset rows, quick settings, the slice footer), so the
 * flow is a second path through the app and never a second implementation of it. The rules are
 * here, so they are unit-tested without a browser: Next needs a model on the plate, the last step
 * has no Next, the first no Back, and a session that restored a model starts in the free layout –
 * the flow is the start screen of an *empty* plate only.
 */

/** One of the flow's four cards, in order: the model, printer and profiles, settings, ready. */
export type FlowStep = 1 | 2 | 3 | 4;

/** The steps in the order the indicator counts them ("1 / 4"). */
export const FLOW_STEPS: readonly FlowStep[] = [1, 2, 3, 4];

/** The card's title, in the house style of the UI (sentence case). */
export const FLOW_TITLES: Record<FlowStep, string> = {
  1: 'Pick a model',
  2: 'Printer and profiles',
  3: 'Settings',
  4: 'Ready to print?',
};

/** What the app decides at the start: the preference, and whether the plate is still empty. */
export interface FlowStart {
  /** the preference "Guided start" (one for every screen) */
  enabled: boolean;
  /** the session restore put a model on the plate (a reload of a working session) */
  objectsPresent: boolean;
}

/** The step a fresh start opens on, or `undefined` for the free layout (no flow). */
export function startStep(f: FlowStart): FlowStep | undefined {
  return f.enabled && !f.objectsPresent ? 1 : undefined;
}

/**
 * Whether an empty plate opens the flow in the running session: the same preference as the fresh
 * start, but a plate that became empty also counts – until the user answered the skip question,
 * which suppresses the flow for the rest of this empty-plate episode.
 */
export function flowOpensOnEmpty(f: FlowStart & { dismissed: boolean }): boolean {
  return f.enabled && !f.objectsPresent && !f.dismissed;
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

/** The stored key of the "Guided start" preference, one for every screen (T-106). */
export const GUIDED_START_KEY = 'webslicer.guidedStart.enabled';

/** The key the phone-only preference used before the flow came to every screen: migrated, never written. */
export const GUIDED_START_PHONE_KEY = 'webslicer.guidedStart';

/** The part of `localStorage` the preference needs (a real Storage or a test double). */
export interface GuidedStartStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

/**
 * The "Guided start" preference for a storage: the shared key wins when it exists; otherwise the
 * phone's old answer is copied to it (and removed) so a user who switched the flow off on the phone
 * does not see it again on a wide screen. A storage without either key means on – the default.
 */
export function readGuidedStartPreference(storage: GuidedStartStorage): boolean {
  const shared = storage.getItem(GUIDED_START_KEY);
  if (shared !== null) return shared !== 'off';
  const phone = storage.getItem(GUIDED_START_PHONE_KEY);
  if (phone === null) return true;
  storage.setItem(GUIDED_START_KEY, phone === 'off' ? 'off' : 'on');
  storage.removeItem(GUIDED_START_PHONE_KEY);
  return phone !== 'off';
}
