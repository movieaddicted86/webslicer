/**
 * When the guided flow opens (T-100): after the session restore had its chance, on a phone, with the
 * preference on and the plate still empty. The decision itself is `startStep` in `guidedFlow.ts`; this
 * module only reads the window and the store around it, so the rule stays unit-testable.
 *
 * Reload rule: the flow is decided once per page load and its step is session state, never stored – a
 * reload that restored a model finds `objectsPresent` and opens the free layout. The preference is the
 * one thing remembered, in `localStorage` (`webslicer.guidedStart`).
 */
import { startStep } from './guidedFlow';
import { useStore } from './store';

/** The width of the phone layout – the same number as the components' own phone query. */
const PHONE_FLOW_QUERY = '(max-width: 640px)';

/**
 * Open the guided flow if this page load is due to show it. Called once, after the session restore
 * finished: a slow restore then counts as "a model on the plate" and the flow stays away.
 */
export function startGuidedFlowIfDue(): void {
  const s = useStore.getState();
  if (s.flowStep !== undefined) return;
  const phone = typeof window !== 'undefined' && window.matchMedia(PHONE_FLOW_QUERY).matches;
  const step = startStep({ phone, enabled: s.guidedStart, objectsPresent: s.objects.length > 0 });
  if (step === undefined) return;
  s.startFlow();
}
