import { useStore } from '../../state/store';
import { navEntry } from '../../nav/navMap';
import { runNavAction } from '../../nav/actions';
import { retrySession } from '../../state/session';
import { ToolbarButton } from '../common/ToolbarButton';
import { ObjectToolbar } from './ObjectToolbar';
import { useDeleteSelection, useInstanceActions, useSelectedObjects } from './selection';
import { ArrangeSettingsMenu } from './ArrangeSettingsMenu';
import './SimpleObjects.css';

/** The reduced objects section of Simple mode: the five actions plus the arrange settings, no list. */
export function SimpleObjects() {
  const objects = useStore((s) => s.objects);
  const arrange = useStore((s) => s.arrange);
  const clear = useStore((s) => s.clearObjects);
  const autosaveError = useStore((s) => s.autosaveError);
  const discardAutosave = useStore((s) => s.discardAutosave);

  const selected = useSelectedObjects();
  const deleteSelection = useDeleteSelection();
  const { addInstance, removeOneInstance, instanceCount } = useInstanceActions();

  return (
    <section className="objects simple" data-testid="object-list">
      <ObjectToolbar>
        <ToolbarButton title="Arrange (A)" icon="arrange" onClick={arrange} disabled={!objects.length} />
        <ArrangeSettingsMenu />
        <span className="tool-sep" aria-hidden="true" />
        <ToolbarButton title="Add instance (+)" icon="addInstance" onClick={addInstance} disabled={selected.length !== 1} />
        <ToolbarButton
          title="Remove the last instance (−)"
          icon="removeInstance"
          onClick={removeOneInstance}
          disabled={selected.length !== 1 || instanceCount <= 1}
        />
        <span className="tool-sep" aria-hidden="true" />
        <ToolbarButton
          title="Delete the picked instance, otherwise the selected object (Del)"
          icon="delete"
          onClick={deleteSelection}
          disabled={!selected.length}
        />
        <ToolbarButton
          title="Delete all"
          icon="deleteAll"
          onClick={() => objects.length && confirm('Remove all objects?') && clear()}
          disabled={!objects.length}
        />
      </ObjectToolbar>
      {!objects.length && autosaveError && (
        <div className="restore">
          <div>Restoring the previous session failed: {autosaveError}</div>
          <div className="manip-actions">
            <button className="primary" onClick={retrySession}>
              Retry
            </button>
            <button onClick={discardAutosave}>Discard</button>
          </div>
        </div>
      )}
      {!objects.length && !autosaveError && (
        <div className="muted small">
          Drop STL / OBJ / 3MF / AMF files onto the 3D view, use Import or{' '}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              void runNavAction(navEntry('library').action);
            }}
          >
            open the library
          </a>
          .
        </div>
      )}
      <div className="muted small">
        Simple mode: move objects with the gizmo in the 3D view, and use the tools in the bar on the left. Switch to <b>Advanced</b> or{' '}
        <b>Expert</b> for the object list, per-object settings, modifiers and height ranges.
      </div>
    </section>
  );
}
