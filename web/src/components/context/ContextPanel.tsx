import { useStore, type PlaterObject } from '../../state/store';
import { baseMode } from '../../state/contextMode';
import { useSelectedObjects } from '../left/selection';
import { PlateMode } from './PlateMode';
import { Presets } from './Presets';
import { TransformCard } from './TransformCard';
import { SettingsCard } from './SettingsCard';
import { PartsCard } from './PartsCard';
import { RangePanel } from './RangePanel';
import { PanelCard } from './PanelCard';
import { Destination } from './Destination';
import { SlicePanel } from './SlicePanel';
import { PreviewPanel } from '../PreviewPanel';
import './ContextPanel.css';

/**
 * The context panel (layout 3.0): the right column of the frame, showing what the current state is
 * about instead of one fixed sidebar. Plate mode when nothing is selected, object mode for the
 * selection, the preview panel in the Preview view; tool mode arrives with the tool strip and is
 * already part of `contextMode`'s precedence.
 *
 * The mode is derived (`baseMode`), never stored: deselecting or leaving the preview switches the
 * content back on its own. The header and the footer stay put while the body scrolls, so the object
 * name and the Slice button are always in view.
 *
 * The preset rows and the quick settings stay in every plater mode – they describe the print, not the
 * selection, and a selected object would otherwise hide the way to change the infill. The printer
 * card, the object cards and the multi-selection note are what follows the selection.
 *
 * Simple mode keeps the reduced set it had: the plate content only, no object internals (parts,
 * overrides, ranges). Preview mode keeps `PreviewPanel` unchanged and has no Slice footer.
 */
export function ContextPanel() {
  const view = useStore((s) => s.view);
  const storeMode = useStore((s) => s.mode);
  const objects = useStore((s) => s.objects);
  const selectedIds = useStore((s) => s.selectedIds);
  const selectedVolumeId = useStore((s) => s.selectedVolumeId);
  const addRange = useStore((s) => s.addRange);
  const selected = useSelectedObjects();

  // a tool panel is still docked next to the bar (the strip and tool mode come with the next step),
  // so the panel keeps the plate or object content while a tool is open
  const base = baseMode({ view, selectedIds, objects });
  const objectMode = base === 'object' && storeMode !== 'simple' && selected.length === 1;
  const mode = base === 'preview' ? 'preview' : objectMode ? 'object' : 'plate';
  const object: PlaterObject | undefined = objectMode ? selected[0] : undefined;

  return (
    <aside className="context-panel" data-testid="context-panel" aria-label="Context">
      <div className="context-header" data-testid="context-header">
        {mode === 'object' && object ? (
          <>
            <h2 className="context-title" title={object.name}>
              {object.name}
            </h2>
            <span className="muted small">
              {object.instances.length} {object.instances.length === 1 ? 'instance' : 'instances'}
            </span>
          </>
        ) : (
          <h2 className="context-title">{mode === 'preview' ? 'Preview' : 'Plate'}</h2>
        )}
      </div>
      <div className="context-body">
        {mode === 'preview' ? (
          <PreviewPanel />
        ) : (
          <>
            {mode === 'plate' && <PlateMode />}
            <Presets />
            {mode === 'object' && object ? (
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
            ) : (
              selected.length > 1 && (
                <div className="multi-selection muted small" data-testid="multi-selection">
                  {selected.length} objects selected – merge them from the object list's toolbar, or pick one to edit its transform.
                </div>
              )
            )}
          </>
        )}
      </div>
      {mode !== 'preview' && (
        <footer className="context-footer" data-testid="context-footer">
          <Destination />
          <SlicePanel />
        </footer>
      )}
    </aside>
  );
}
