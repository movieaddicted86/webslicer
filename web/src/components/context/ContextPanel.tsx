import { useEffect, useRef } from 'react';
import { useStore, nextSheetState, type PlaterObject, type SheetState } from '../../state/store';
import { contextMode } from '../../state/contextMode';
import { useSelectedObjects } from '../left/selection';
import { useMediaQuery } from '../left/useMediaQuery';
import { PlateMode } from './PlateMode';
import { Presets } from './Presets';
import { TransformCard } from './TransformCard';
import { ObjectHeader } from './ObjectHeader';
import { SettingsCard } from './SettingsCard';
import { PartsCard } from './PartsCard';
import { RangePanel } from './RangePanel';
import { PanelCard } from './PanelCard';
import { Destination } from './Destination';
import { SlicePanel } from './SlicePanel';
import { PreviewFooter } from './PreviewFooter';
import { PhoneResult } from './PhoneResult';
import { PreviewPanel } from '../PreviewPanel';
import { PreviewInfo } from '../preview/PreviewInfo';
import { ToolMode } from './ToolMode';
import { MultiSelection } from './MultiSelection';
import { GuidedFlow, GuidedNav } from '../guided/GuidedFlow';
import { FLOW_TITLES, type FlowStep } from '../../state/guidedFlow';
import { useSheetDrag, type SheetDrag } from './useSheetDrag';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { reportUiError } from '../../errorReport';
import './ContextPanel.css';

/** The width below which the context panel is a bottom sheet (the same number as `ContextPanel.css`). */
const PHONE_QUERY = '(max-width: 640px)';

/**
 * The context panel (layout 3.0, visual pass): a floating card on the right of the scene, showing what
 * the current state is about instead of one fixed sidebar. Tool mode when a tool is open, plate mode
 * when nothing is selected, object mode for the selection, the preview panel in the Preview view.
 *
 * The mode is derived (`contextMode`), never stored: closing the tool, deselecting or leaving the
 * preview switches the content back on its own. The header and the body live in the card; the footer
 * (destination + Slice) is a **separate card** below it, so it stays visible while the body scrolls and
 * keeps its place when the body is long.
 *
 * Tool mode brings its own frame (`ToolPanel`: title, ✕, the tool's fields and its primary action), so
 * the panel renders no second header and no Slice footer there – the tool's action is the one accent
 * while it is open. Its key hints come from the tool's registry entry.
 *
 * The preset rows and the quick settings stay in every plater mode – they describe the print, not the
 * selection, and a selected object would otherwise hide the way to change the infill. The object cards
 * and the group actions of a multi-selection are what follow the selection.
 *
 * Simple mode keeps the reduced set it had: the plate content only, no object internals (parts,
 * overrides, ranges). Preview mode keeps `PreviewPanel` and has no Slice footer.
 *
 * On a phone the stack is a bottom sheet with a drag handle and the four positions of the responsive
 * table (`sheetState` in the layout slice): `hidden` keeps the handle alone, `peek` the footer (so the
 * Slice button is always reachable), `half` the card's upper part, `full` the whole card over the
 * scene. The grip and the card's header drag it, one-to-one with the finger.
 */
export function ContextPanel() {
  const activeTool = useStore((s) => s.activeTool);
  const view = useStore((s) => s.view);
  const storeMode = useStore((s) => s.mode);
  const objects = useStore((s) => s.objects);
  const selectedIds = useStore((s) => s.selectedIds);
  const selectedVolumeId = useStore((s) => s.selectedVolumeId);
  const addRange = useStore((s) => s.addRange);
  const selected = useSelectedObjects();

  const base = contextMode({ activeTool, view, selectedIds, objects });
  const objectMode = base === 'object' && storeMode !== 'simple' && selected.length === 1;
  const mode = base === 'tool' ? 'tool' : base === 'preview' ? 'preview' : objectMode ? 'object' : 'plate';
  const object: PlaterObject | undefined = objectMode ? selected[0] : undefined;
  const phone = useMediaQuery(PHONE_QUERY);
  const sheetState = useStore((s) => s.sheetState);
  const setSheetState = useStore((s) => s.setSheetState);
  const flowStep = useStore((s) => s.flowStep);
  // T-100: the guided flow owns the plater's sheet on a phone – it is a second path through the same
  // panel, so every plater mode (empty, object, multi-selection) shows the step's card and its buttons
  const flow = phone && view === 'plater' && flowStep !== undefined ? flowStep : undefined;
  // the quiet start (T-100): an empty phone plate has nothing to send and nothing to slice, so the
  // footer stays empty and the scene's card carries the two ways in. Desktop keeps the destination
  // and the (disabled) Slice button it always showed.
  const quietStart = phone && objects.length === 0;
  const stackRef = useRef<HTMLDivElement>(null);
  const drag = useSheetDrag(stackRef, setSheetState);
  // a tool opens its own panel in the card: on a phone the folded sheet would hide the controls the
  // user just asked for, so *opening* a tool lifts the sheet to `half` – a tap can fold it back
  // afterwards without the sheet springing open again
  const lastMode = useRef(mode);
  useEffect(() => {
    if (phone && mode === 'tool' && lastMode.current !== 'tool') setSheetState('half');
    lastMode.current = mode;
  }, [phone, mode, setSheetState]);
  // a guided step opens its card in the sheet: at `peek` the card is folded away, so a step change
  // lifts the sheet to `half` once, the same as opening a tool. A tap or drag can fold it again
  // afterwards; the step's buttons stay in the footer either way (T-100).
  const lastFlow = useRef<FlowStep | undefined>(undefined);
  useEffect(() => {
    if (phone && flowStep !== undefined && lastFlow.current !== flowStep) setSheetState('half');
    lastFlow.current = flowStep;
  }, [phone, flowStep, setSheetState]);
  // Step 4: an empty plate stays quiet in the footer – nothing to send, nothing to slice. The flow
  // never fully hides its sheet either: Skip lives in the footer, so `hidden` is the empty plate's
  // position alone and the flow keeps its buttons (T-100).
  useEffect(() => {
    if (phone && flowStep !== undefined && sheetState === 'hidden') setSheetState('peek');
  }, [phone, flowStep, sheetState, setSheetState]);
  // the first file of the flow (the Library's Load, the drop zone, the phone's picker) lands on an
  // empty plater, and the next step is the slice: the sheet folds to `peek`, where the footer *is* the
  // Slice state – the result line, the destination and the Slice button, one tap away. A loaded model
  // arrives selected, which would otherwise open the object cards and hide the button behind a second
  // tap (T-092). Only the empty → filled step folds it, so duplicating an object never moves the sheet.
  // The guided flow keeps its sheet: the step card names the picked file and its Next sits below it.
  const wasEmpty = useRef(objects.length === 0);
  useEffect(() => {
    if (phone && flowStep === undefined && wasEmpty.current && objects.length > 0) setSheetState('peek');
    wasEmpty.current = objects.length === 0;
  }, [phone, flowStep, objects.length, setSheetState]);
  // the sheet's positions are classes on the stack: the phone stylesheet reads them
  const sheetClass = phone ? `sheet sheet-${sheetState}${drag.dragging ? ' sheet-dragging' : ''}` : '';
  // the grip drags the sheet, and so does the card's header (`dragProps` below); the body scrolls
  const dragProps = phone
    ? {
        onPointerDown: drag.onPointerDown,
        onPointerMove: drag.onPointerMove,
        onPointerUp: drag.onPointerUp,
        onPointerCancel: drag.onPointerCancel,
      }
    : {};
  const handle = phone ? (
    <SheetHandle
      state={sheetState}
      {...dragProps}
      onCycle={() => {
        if (drag.consumeDrag()) return;
        setSheetState(nextSheetState(sheetState));
      }}
    />
  ) : null;
  /** The header is the sheet's second drag surface; the ✕ and the fields in it keep their own press. */

  // tool mode: the tool's own frame fills the card (its head is the header, its foot the footer)
  if (mode === 'tool') {
    return (
      <div className={`context-stack ${sheetClass}`} ref={stackRef}>
        {handle}
        <aside className="context-panel" data-testid="context-panel" aria-label="Context">
          <div className="context-body context-tool" data-testid="context-tool">
            <ToolMode />
          </div>
        </aside>
      </div>
    );
  }

  return (
    <div className={`context-stack ${sheetClass}`} ref={stackRef}>
      {handle}
      <aside className="context-panel" data-testid="context-panel" aria-label="Context">
        {flow !== undefined ? (
          /* the guided flow's card: the step's title, the counter and the step's own content */
          <div className="context-header guided-header" data-testid="guided-header" {...dragProps}>
            <h2 className="context-title">{FLOW_TITLES[flow]}</h2>
            <span className="guided-count" data-testid="guided-step">
              {flow} / 4
            </span>
          </div>
        ) : mode === 'object' && object ? (
          /* object mode: the header is the object's own card – picture, name, size and rename */
          <div className="context-header object-header-slot" data-testid="context-header" {...dragProps}>
            <ObjectHeader o={object} />
          </div>
        ) : mode === 'plate' ? (
          <div className="context-header" data-testid="context-header" {...dragProps}>
            <h2 className="context-title">Plate</h2>
          </div>
        ) : null}
        <div className="context-body">
          {flow !== undefined ? (
            <GuidedFlow step={flow} />
          ) : mode === 'preview' ? (
            // P-7: the preview card reads the job, the G-code and the toolpaths – a throw there is
            // recovered in the card, the plate panel and the footer keep their place
            <ErrorBoundary region="Preview" onError={(e) => reportUiError(e, 'Preview')}>
              <PreviewPanel />
            </ErrorBoundary>
          ) : (
            <>
              {mode === 'plate' && <PlateMode />}
              {/* the group actions of a multi-selection come first: they are what the selection is
                  about, and below the presets the card would start out scrolled out of view */}
              {selected.length > 1 && <MultiSelection selected={selected} />}
              <Presets />
              {mode === 'object' && object && (
                <div className="manip">
                  <TransformCard o={object} />
                  <SettingsCard o={object} />
                  <PartsCard o={object} selectedVolumeId={selectedVolumeId} />
                  <PanelCard
                    title="Layer ranges"
                    icon="layerHeight"
                    testId="range-card"
                    aside={
                      <button
                        data-testid="range-add"
                        title="Add a height range with its own layer height / settings"
                        onClick={() => addRange(object.id)}
                      >
                        ＋ Range
                      </button>
                    }
                  >
                    <RangePanel o={object} />
                  </PanelCard>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
      {mode === 'preview' ? (
        <footer className="context-footer" data-testid="context-footer">
          {/* T-092: at `peek` the footer is the whole sheet, so the result's numbers sit here – one
              card with the destination and Send, no scroll and no second tap. R-05: the Details chip
              (legend and sliced info) is a labelled row of the same footer, so it is found without
              searching for it in the card. */}
          <PhoneResult />
          <PreviewInfo />
          <Destination />
          <PreviewFooter />
        </footer>
      ) : (
        <footer className="context-footer" data-testid="context-footer">
          <PhoneResult />
          {flow !== undefined ? (
            <>
              <GuidedNav step={flow} />
              {/* the last step's actions are the free layout's own: the destination, the checks and
                  Slice. No second button, no second slice path (T-100). */}
              {flow === 4 && (
                <>
                  <Destination />
                  <SlicePanel />
                </>
              )}
            </>
          ) : quietStart ? null : (
            <>
              <Destination />
              <SlicePanel />
            </>
          )}
        </footer>
      )}
    </div>
  );
}

/**
 * The sheet's drag handle (`SheetHandle` below the panel): a grip a thumb can drag up and down, and a
 * button a tap walks through the four positions. It is the sheet's own chrome, so it sits above the
 * card; on a wide window there is no sheet and it renders nothing.
 */
function SheetHandle({
  state,
  onCycle,
  ...dragProps
}: {
  state: SheetState;
  onCycle: () => void;
} & Partial<Pick<SheetDrag, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel'>>) {
  return (
    <div
      className="sheet-handle"
      role="button"
      tabIndex={0}
      aria-label={`The panel is ${SHEET_POSITION[state]} – tap to change`}
      aria-expanded={state !== 'hidden' && state !== 'peek'}
      data-testid="sheet-handle"
      data-sheet-state={state}
      {...dragProps}
      onClick={onCycle}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onCycle();
      }}
    >
      <span className="sheet-grip" aria-hidden="true" />
    </div>
  );
}

/** What the handle's accessible name says about the current position. */
const SHEET_POSITION: Record<SheetState, string> = {
  hidden: 'put away',
  peek: 'collapsed',
  half: 'half open',
  full: 'open',
};
