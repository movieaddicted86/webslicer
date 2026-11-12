/**
 * When the guided flow opens: after the session restore had its chance, with the preference on and
 * the plate still empty. The decision itself is `startStep` in `guidedFlow.ts`; this module only
 * reads the store around it, so the rule stays unit-testable.
 *
 * The flow used to be the phone's start screen (T-100) and is the start screen of every screen since
 * the desktop and the tablet took it over (T-106): the same rule, the same preference, only the
 * container differs. Reload rule: the flow is decided once per page load and its step is session
 * state, never stored – a reload that restored a model finds `objectsPresent` and opens the free
 * layout. The preference is the one thing remembered, in `localStorage`
 * (`webslicer.guidedStart.enabled`, the phone's older key migrated once).
 */
import { flowOpensOnEmpty, startStep } from './guidedFlow';
import { useStore } from './store';

/**
 * Open the guided flow if this page load is due to show it. Called once, after the session restore
 * finished: a slow restore then counts as "a model on the plate" and the flow stays away.
 */
export function startGuidedFlowIfDue(): void {
  const s = useStore.getState();
  if (s.flowStep !== undefined) return;
  const step = startStep({ enabled: s.guidedStart, objectsPresent: s.objects.length > 0 });
  if (step === undefined) return;
  s.startFlow();
}

/**
 * Keep the flow coming back on an empty plate: the start decision above runs once, so this watcher
 * opens the flow again when the last model leaves the plate, or when an already empty plate is shown
 * in the Plater (a tab switch, not a reload). The skip answer (`flowDismissed`) and the preference
 * switch it off until a model was on the plate again.
 *
 * Returns the unsubscribe, so the app can drop it with the component tree.
 */
export function watchGuidedFlow(): () => void {
  let count = useStore.getState().objects.length;
  let view = useStore.getState().view;
  return useStore.subscribe((s) => {
    const becameEmpty = count > 0 && s.objects.length === 0;
    const enteredPlater = view !== 'plater' && s.view === 'plater' && s.objects.length === 0;
    count = s.objects.length;
    view = s.view;
    if (!becameEmpty && !enteredPlater) return;
    if (s.view !== 'plater' || s.flowStep !== undefined) return;
    const opens = flowOpensOnEmpty({
      enabled: s.guidedStart,
      objectsPresent: s.objects.length > 0,
      dismissed: s.flowDismissed,
    });
    if (opens) s.startFlow();
  });
}
