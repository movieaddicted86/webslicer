import { useStore } from '../../state/store';
import { canAdvance, nextStep, type FlowStep } from '../../state/guidedFlow';
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
 */
export function GuidedFlow({ step }: { step: FlowStep }) {
  return (
    <section className="guided" data-testid="guided-card" aria-label="Guided start">
      {step === 1 && <ModelStep />}
      {step === 2 && <ProfilesStep />}
      {step === 3 && <SettingsStep />}
      {step === 4 && <ReadyStep />}
    </section>
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
 */
export function GuidedNav({ step }: { step: FlowStep }) {
  const objects = useStore((s) => s.objects);
  const nextFlowStep = useStore((s) => s.nextFlowStep);
  const previousFlowStep = useStore((s) => s.previousFlowStep);
  const leaveFlow = useStore((s) => s.leaveFlow);
  const last = nextStep(step) === undefined;
  const canNext = canAdvance(step, { objectsPresent: objects.length > 0 });
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
      <button type="button" className="secondary guided-skip" data-testid="guided-skip" onClick={leaveFlow}>
        {last ? 'More settings' : 'Skip'}
      </button>
    </div>
  );
}
