import { useStore, type PlaterObject } from '../../state/store';
import { contextMode } from '../../state/contextMode';
import { useSelectedObjects } from '../left/selection';
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
import { PreviewPanel } from '../PreviewPanel';
import { ToolMode } from './ToolMode';
import { MultiSelection } from './MultiSelection';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { reportUiError } from '../../errorReport';
import './ContextPanel.css';

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

  // tool mode: the tool's own frame fills the card (its head is the header, its foot the footer)
  if (mode === 'tool') {
    return (
      <div className="context-stack">
        <aside className="context-panel" data-testid="context-panel" aria-label="Context">
          <div className="context-body context-tool" data-testid="context-tool">
            <ToolMode />
          </div>
        </aside>
      </div>
    );
  }

  return (
    <div className="context-stack">
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
          <Destination />
          <PreviewFooter />
        </footer>
      ) : (
        <footer className="context-footer" data-testid="context-footer">
          <Destination />
          <SlicePanel />
        </footer>
      )}
    </div>
  );
}
