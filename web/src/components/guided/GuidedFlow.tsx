import { useState } from 'react';
import { useStore } from '../../state/store';
import { canAdvance, FLOW_TITLES, nextStep, type FlowStep } from '../../state/guidedFlow';
import { PresetSelect } from '../PresetSelect';
import { QuickSettings } from '../context/QuickSettings';
import { requestImport } from '../../importTrigger';
import { navEntry } from '../../nav/navMap';
import { runNavAction } from '../../nav/actions';
import './GuidedFlow.css';

/**
 * The card of one guided step (T-100): the four steps from a model to a print, on a phone. Each step
 * renders the components the free layout already has – the two ways in, the preset rows, the quick
 * settings, and in the footer the destination and the Slice panel – so the flow is a second path
 * through the app and never a second implementation of it.
 *
 * The card sits in the bottom sheet's body; the sheet's own footer carries Back, Next and Skip
 * (`GuidedNav` below), so those controls are at a thumb's reach at every sheet position that draws the
 * footer. A step switch does not reset the sheet: the user's fold stays.
 *
 * T-106: on a wide window the same step body is mounted in the floating card over the 3D view, whose
 * own frame carries the title and the counter – that shell passes its own `testId`, so the card's hook
 * names the one card either way.
 */
export function GuidedFlow({
  step,
  testId = 'guided-card',
  header,
}: {
  step: FlowStep;
  /** the card's hook: the phone's sheet and the wide window's floating card each name their own */
  testId?: string;
  /** the shell's header (title and counter); the phone's sheet draws it in the card's header instead */
  header?: boolean;
}) {
  return (
    <section className="guided" data-testid={testId} aria-label="Guided start">
      {header && <GuidedHeader step={step} />}
      {step === 1 && <ModelStep />}
      {step === 2 && <ProfilesStep />}
      {step === 3 && <SettingsStep />}
      {step === 4 && <ReadyStep />}
    </section>
  );
}

/**
 * The step's title and its "n / 4" counter, inside the floating card (T-106). The phone's sheet draws
 * the same two in its own header (`ContextPanel`), where the header is also the sheet's drag surface –
 * that is the one difference of the two shells, so the counter's wording lives here only.
 */
export function GuidedHeader({ step }: { step: FlowStep }) {
  return (
    <div className="guided-head" data-testid="guided-header">
      <h2 className="guided-head-title">{FLOW_TITLES[step]}</h2>
      <span className="guided-count" data-testid="guided-step">
        {step} / 4
      </span>
    </div>
  );
}

/** Step 1: the two ways in – the device's file picker and the app's one Library dialog. */
function ModelStep() {
  const objects = useStore((s) => s.objects);
  return (
    <>
      <p className="guided-text">Choose a model from this device, or one you already uploaded to the library.</p>
      <div className="guided-actions">
        <button type="button" className="primary" data-testid="guided-pick" onClick={requestImport}>
          From this device
        </button>
        <button
          type="button"
          className="secondary"
          data-testid="guided-library"
          onClick={() => void runNavAction(navEntry('library').action)}
        >
          From library
        </button>
      </div>
      {objects.length > 0 && (
        <p className="guided-file" data-testid="guided-file">
          {objects.length === 1 ? objects[0].name : `${objects.length} models on the plate`}
        </p>
      )}
    </>
  );
}

/** Step 2: the same preset rows the context panel's print settings card shows. */
function ProfilesStep() {
  const presets = useStore((s) => s.presets);
  const extruders = useStore((s) => s.extruderCount());
  const installed = useStore((s) => s.installed);
  return (
    <>
      <p className="guided-text">The printer, its filament and the print profile. Each row opens its own settings.</p>
      <div className="guided-presets">
        <PresetSelect type="printer" slot={presets.printer} label="Printer" />
        {presets.filament.slice(0, Math.max(1, extruders)).map((f, i) => (
          <PresetSelect
            key={i}
            type="filament"
            slot={f}
            extruderIdx={i}
            label={extruders > 1 ? `Filament (extruder ${i + 1})` : 'Filament'}
          />
        ))}
        <PresetSelect type="print" slot={presets.print} label="Print settings" />
      </div>
      {!installed.length && (
        <button
          type="button"
          className="link guided-link"
          data-testid="guided-printers"
          onClick={() => void runNavAction(navEntry('printers').action)}
        >
          Add or choose a printer…
        </button>
      )}
    </>
  );
}

/** Step 3: the quick settings of the print profile, the same short list the panel shows. */
function SettingsStep() {
  return (
    <>
      <p className="guided-text">Fine as it is? Just continue.</p>
      <div className="guided-quick">
        <QuickSettings />
      </div>
    </>
  );
}

/** Step 4: what the footer's destination and Slice button will do, as a short summary. */
function ReadyStep() {
  const presets = useStore((s) => s.presets);
  const filaments = presets.filament.map((f) => f.name).join(', ');
  return (
    <>
      <p className="guided-text">Check the destination below, then slice. The plate and safety checks run first.</p>
      <dl className="guided-summary" data-testid="guided-summary">
        <div>
          <dt>Printer</dt>
          <dd>{presets.printer.name}</dd>
        </div>
        <div>
          <dt>Filament</dt>
          <dd>{filaments || '–'}</dd>
        </div>
        <div>
          <dt>Print profile</dt>
          <dd>{presets.print.name}</dd>
        </div>
      </dl>
    </>
  );
}

/**
 * The flow's own button row in the sheet's footer: Back, Next and Skip. Back is absent on the first
 * step, Next on the last (there Slice and Send are the way on), and Skip reads **More settings** on the
 * last step. Every button is a 44 px target, and Skip is always drawn, so the free layout is one tap
 * away from any step.
 *
 * T-101: on steps 1–3 the Skip button reads **Skip guided start** and asks once – *Show the guided
 * start next time?* – with **Yes** (nothing changes; the next fresh start opens it again) and **Don't
 * show again** (the preference goes off). Both answers leave to the free layout. The last step's
 * **More settings** asks nothing: the print is ready, the flow already did its job.
 */
export function GuidedNav({ step }: { step: FlowStep }) {
  const objects = useStore((s) => s.objects);
  const nextFlowStep = useStore((s) => s.nextFlowStep);
  const previousFlowStep = useStore((s) => s.previousFlowStep);
  const leaveFlow = useStore((s) => s.leaveFlow);
  const setGuidedStart = useStore((s) => s.setGuidedStart);
  const [asking, setAsking] = useState(false);
  const last = nextStep(step) === undefined;
  const canNext = canAdvance(step, { objectsPresent: objects.length > 0 });
  if (asking) {
    return (
      <div className="guided-nav guided-ask" data-testid="guided-skip-question">
        <p className="guided-ask-text">Show the guided start next time?</p>
        <div className="guided-ask-actions">
          <button
            type="button"
            className="primary"
            data-testid="guided-skip-yes"
            onClick={leaveFlow}
            title="Keep the guided start on – it opens again on the next empty plate"
          >
            Yes
          </button>
          <button
            type="button"
            className="secondary"
            data-testid="guided-skip-never"
            onClick={() => setGuidedStart(false)}
            title="Turn the guided start off – More → Guided start still opens it"
          >
            Don't show again
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="guided-nav" data-testid="guided-nav">
      {step > 1 && (
        <button type="button" className="secondary" data-testid="guided-back" onClick={previousFlowStep}>
          Back
        </button>
      )}
      {!last && (
        <button
          type="button"
          className="primary guided-next"
          data-testid="guided-next"
          disabled={!canNext}
          onClick={nextFlowStep}
          title={canNext ? undefined : 'Choose a model first'}
        >
          Next
        </button>
      )}
      <button
        type="button"
        className="secondary guided-skip"
        data-testid="guided-skip"
        onClick={() => (last ? leaveFlow() : setAsking(true))}
      >
        {last ? 'More settings' : 'Skip guided start'}
      </button>
    </div>
  );
}

/**
 * The flow's footer in the Preview (T-101/G-09): the step-4 result is on screen, so the way back and
 * the way out have to be too. **Back** returns to the Plater at step 4 with the sliced result kept;
 * **Finish** leaves to the free layout without a question.
 */
export function GuidedPreviewNav() {
  const setView = useStore((s) => s.setView);
  const leaveFlow = useStore((s) => s.leaveFlow);
  return (
    <div className="guided-nav" data-testid="guided-preview-nav">
      <button type="button" className="secondary guided-back" data-testid="guided-preview-back" onClick={() => setView('plater')}>
        Back
      </button>
      <button type="button" className="primary guided-finish" data-testid="guided-preview-finish" onClick={leaveFlow}>
        Finish
      </button>
    </div>
  );
}
