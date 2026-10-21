import { useStore } from '../../state/store';
import { SectionHeader } from '../common/SectionHeader';
import { ToolbarButton } from '../common/ToolbarButton';
import { useDeleteSelection, useInstanceActions, useSelectedObjects } from './selection';

/** The reduced objects section of Simple mode: the five actions, no list, no manipulation panel. */
export function SimpleObjects() {
  const objects = useStore((s) => s.objects);
  const arrange = useStore((s) => s.arrange);
  const clear = useStore((s) => s.clearObjects);
  const autosaveInfo = useStore((s) => s.autosaveInfo);
  const restoreAutosave = useStore((s) => s.restoreAutosave);
  const discardAutosave = useStore((s) => s.discardAutosave);
  const openDialog = useStore((s) => s.openDialog);

  const selected = useSelectedObjects();
  const deleteSelection = useDeleteSelection();
  const { addInstance, removeOneInstance, instanceCount } = useInstanceActions();

  return (
    <section className="objects simple">
      <SectionHeader title={`Objects (${objects.length})`}>
        <div className="tools">
          <ToolbarButton title="Arrange (A)" onClick={arrange} disabled={!objects.length}>
            ▦
          </ToolbarButton>
          <ToolbarButton title="Add instance (+)" onClick={addInstance} disabled={selected.length !== 1}>
            +
          </ToolbarButton>
          <ToolbarButton
            title="Remove the last instance (−)"
            onClick={removeOneInstance}
            disabled={selected.length !== 1 || instanceCount <= 1}
          >
            −
          </ToolbarButton>
          <ToolbarButton
            title="Delete the picked instance, otherwise the selected object (Del)"
            onClick={deleteSelection}
            disabled={!selected.length}
          >
            🗑
          </ToolbarButton>
          <ToolbarButton
            title="Delete all"
            onClick={() => objects.length && confirm('Remove all objects?') && clear()}
            disabled={!objects.length}
          >
            ✕
          </ToolbarButton>
        </div>
      </SectionHeader>
      {!objects.length && autosaveInfo && (
        <div className="restore">
          <div>Unsaved session from {new Date(autosaveInfo.savedAt).toLocaleString()} found.</div>
          <div className="manip-actions">
            <button className="primary" onClick={restoreAutosave}>
              Restore
            </button>
            <button onClick={discardAutosave}>Discard</button>
          </div>
        </div>
      )}
      {!objects.length && !autosaveInfo && (
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
        Simple mode: move objects with the gizmo in the 3D view. Switch to <b>Advanced</b> or <b>Expert</b> (top right) for the object list,
        per-object settings, modifiers, painting and height ranges.
      </div>
    </section>
  );
}
