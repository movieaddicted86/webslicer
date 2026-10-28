import { useEffect, useRef, type PointerEvent } from 'react';
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
import { ToolMode } from './ToolMode';
import { MultiSelection } from './MultiSelection';
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
 * On a phone the stack is a bottom sheet with a drag handle and the three positions of the responsive
 * table (`sheetState` in the layout slice): `peek` keeps the footer alone (so the Slice button is
 * always reachable), `half` shows the card's upper part, `full` the whole card over the scene.
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
  // a tool opens its own panel in the card: on a phone the folded sheet would hide the controls the
  // user just asked for, so *opening* a tool lifts the sheet to `half` – a tap can fold it back
  // afterwards without the sheet springing open again
  const lastMode = useRef(mode);
  useEffect(() => {
    if (phone && mode === 'tool' && lastMode.current !== 'tool') setSheetState('half');
    lastMode.current = mode;
  }, [phone, mode, setSheetState]);
  // the first file of the flow (the Library's Load, the drop zone, the phone's picker) lands on an
  // empty plater, and the next step is the slice: the sheet folds to `peek`, where the footer *is* the
  // Slice state – the result line, the destination and the Slice button, one tap away. A loaded model
  // arrives selected, which would otherwise open the object cards and hide the button behind a second
  // tap (T-092). Only the empty → filled step folds it, so duplicating an object never moves the sheet.
  const wasEmpty = useRef(objects.length === 0);
  useEffect(() => {
    if (phone && wasEmpty.current && objects.length > 0) setSheetState('peek');
    wasEmpty.current = objects.length === 0;
  }, [phone, objects.length, setSheetState]);
  // the sheet's three positions are classes on the stack: the phone stylesheet reads them
  const sheetClass = phone ? `sheet sheet-${sheetState}` : '';
  const handle = phone ? <SheetHandle state={sheetState} onCycle={() => setSheetState(nextSheetState(sheetState))} /> : null;

  // tool mode: the tool's own frame fills the card (its head is the header, its foot the footer)
  if (mode === 'tool') {
    return (
      <div className={`context-stack ${sheetClass}`}>
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
    <div className={`context-stack ${sheetClass}`}>
      {handle}
      <aside className="context-panel" data-testid="context-panel" aria-label="Context">
        {mode === 'object' && object ? (
          /* object mode: the header is the object's own card – picture, name, size and rename */
          <div className="context-header object-header-slot" data-testid="context-header">
            <ObjectHeader o={object} />
          </div>
        ) : mode === 'plate' ? (
          <div className="context-header" data-testid="context-header">
            <h2 className="context-title">Plate</h2>
          </div>
        ) : null}
        <div className="context-body">
          {mode === 'preview' ? (
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
              card with the destination and Send, no scroll and no second tap */}
          <PhoneResult />
          <Destination />
          <PreviewFooter />
        </footer>
      ) : (
        <footer className="context-footer" data-testid="context-footer">
          <PhoneResult />
          <Destination />
          <SlicePanel />
        </footer>
      )}
    </div>
  );
}

/**
 * The sheet's drag handle (`SheetHandle` below the panel): a grip a thumb can drag up and down, and a
 * button a tap walks through the three positions. It is the sheet's own chrome, so it sits above the
 * card; on a wide window there is no sheet and it renders nothing.
 */
function SheetHandle({ state, onCycle }: { state: SheetState; onCycle: () => void }) {
  const startY = useRef<number | null>(null);
  const setSheetState = useStore((s) => s.setSheetState);
  const drag = (e: PointerEvent<HTMLDivElement>) => {
    // the handle is a button too: a drag must not also cycle on the click that ends it
    startY.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (startY.current === null) return;
    const dy = startY.current - e.clientY;
    if (Math.abs(dy) < 36) return;
    setSheetState(dy > 0 ? (state === 'peek' ? 'half' : 'full') : state === 'full' ? 'half' : 'peek');
    startY.current = null;
  };
  const end = () => {
    startY.current = null;
  };
  return (
    <div
      className="sheet-handle"
      role="button"
      tabIndex={0}
      aria-label={`The panel is ${state === 'peek' ? 'collapsed' : state === 'half' ? 'half open' : 'open'} – tap to change`}
      aria-expanded={state !== 'peek'}
      data-testid="sheet-handle"
      data-sheet-state={state}
      onPointerDown={drag}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
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
