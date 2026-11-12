import { useStore } from '../../state/store';
import { GuidedFlow, GuidedNav, GuidedPreviewNav } from './GuidedFlow';
import { Destination } from '../context/Destination';
import { SlicePanel } from '../context/SlicePanel';
import { PreviewFooter } from '../context/PreviewFooter';
import { PhoneResult } from '../context/PhoneResult';
import { useMediaQuery } from '../left/useMediaQuery';
import './GuidedCard.css';

/** The width below which the phone's bottom sheet owns the flow (the same number as the stylesheets). */
const PHONE_QUERY = '(max-width: 640px)';

/**
 * The guided start on a wide window (T-106): the same flow in another shell. A floating card at the
 * bottom centre of the 3D view carries the step's title, the "n / 4" counter, the step's own body
 * (`GuidedFlow` – the phone's four cards, unchanged) and the Back / Next / Skip row. Step 4 adds the
 * destination and the free layout's Slice panel, so the slice is the same one the footer starts; in
 * the Preview the card turns into the flow's end: the result line, Send to printer, Back and Finish.
 *
 * Nothing of the flow is implemented twice here: the steps, their rules and the buttons are the
 * phone's components, and this file only places them. The card keeps to the room the side panels
 * leave free (the same band as the view row), is at most 520 px wide and 40 % of the scene high, and
 * scrolls its body inside that. The phone keeps its sheet (`ContextPanel`) – there this renders
 * nothing.
 */
export function GuidedCard() {
  const phone = useMediaQuery(PHONE_QUERY);
  const view = useStore((s) => s.view);
  const step = useStore((s) => s.flowStep);
  if (phone || step === undefined) return null;
  if (view !== 'plater' && view !== 'preview') return null;
  // the flow is a Plater start; after its slice it stays alive in the Preview at step 4 only
  const ending = view === 'preview';
  if (ending && step !== 4) return null;

  return (
    <div className={`guided-float${ending ? ' guided-float-ending' : ''}`} data-testid="guided-float">
      <aside className="guided-float-card" data-testid="guided-float-card" aria-label="Guided start">
        {ending ? (
          <>
            <div className="guided-float-body">
              {/* the flow's last step as the result: its own header, then the result line, the
                  destination and Send – the Preview footer's parts, not a second reading of the job */}
              <div className="guided">
                <div className="guided-head">
                  <h2 className="guided-head-title">The print is ready</h2>
                  <span className="guided-count">4 / 4</span>
                </div>
                <PhoneResult always />
                <Destination />
                <PreviewFooter />
              </div>
            </div>
            <div className="guided-float-foot">
              <GuidedPreviewNav />
            </div>
          </>
        ) : (
          <>
            <div className="guided-float-body">
              {/* the step card with the flow's own header inside it: the title, "n / 4", the step */}
              <GuidedFlow step={step} testId="guided-card" header />
            </div>
            <div className="guided-float-foot">
              <GuidedNav step={step} />
              {/* step 4's actions are the free layout's own: the destination, the checks and Slice */}
              {step === 4 && (
                <>
                  <Destination />
                  <SlicePanel />
                </>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
