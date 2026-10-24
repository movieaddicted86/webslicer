import { useStore } from '../../state/store';
import { retrySession } from '../../state/session';
import { SectionHeader } from '../common/SectionHeader';
import { ToolbarButton } from '../common/ToolbarButton';
import { ACTION_ICONS } from '../common/icons';
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
  const openDialog = useStore((s) => s.openDialog);

  const selected = useSelectedObjects();
  const deleteSelection = useDeleteSelection();
  const { addInstance, removeOneInstance, instanceCount } = useInstanceActions();

  return (
    <section className="objects simple" data-testid="object-list">
      <SectionHeader title={`Objects (${objects.length})`}>
        <div className="tools" data-testid="object-toolbar">
          <ToolbarButton title="Arrange (A)" icon={ACTION_ICONS.arrange} onClick={arrange} disabled={!objects.length} />
          <ArrangeSettingsMenu />
          <span className="tool-sep" aria-hidden="true" />
          <ToolbarButton title="Add instance (+)" icon={ACTION_ICONS.addInstance} onClick={addInstance} disabled={selected.length !== 1} />
          <ToolbarButton
            title="Remove the last instance (−)"
            icon={ACTION_ICONS.removeInstance}
            onClick={removeOneInstance}
            disabled={selected.length !== 1 || instanceCount <= 1}
          />
          <span className="tool-sep" aria-hidden="true" />
          <ToolbarButton
            title="Delete the picked instance, otherwise the selected object (Del)"
            icon={ACTION_ICONS.delete}
            onClick={deleteSelection}
            disabled={!selected.length}
          />
          <ToolbarButton
            title="Delete all"
            icon={ACTION_ICONS.deleteAll}
            onClick={() => objects.length && confirm('Remove all objects?') && clear()}
            disabled={!objects.length}
          />
        </div>
      </SectionHeader>
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
              openDialog('library', 'open');
            }}
          >
            open the library
          </a>
          .
        </div>
      )}
      <div className="muted small">
        Simple mode: move objects with the gizmo in the 3D view, and use the tools in the bar on the left. Switch to <b>Advanced</b> or{' '}
        <b>Expert</b> (top right) for the object list, per-object settings, modifiers and height ranges.
      </div>
    </section>
  );
}
