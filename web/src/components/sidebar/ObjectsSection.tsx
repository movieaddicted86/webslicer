import { useEffect, useState } from 'react';
import { useStore } from '../../state/store';
import { retrySession } from '../../state/session';
import { SectionHeader } from '../common/SectionHeader';
import { ToolbarButton } from '../common/ToolbarButton';
import { ACTION_ICONS } from '../common/icons';
import { ObjectRow } from './ObjectRow';
import { ObjectManipulation } from './ObjectManipulation';
import { VolumeManipulation } from './VolumeManipulation';
import { ArrangeSettingsMenu } from './ArrangeSettingsMenu';
import { useDeleteSelection, useInstanceActions, useSelectedObjects } from './selection';

/**
 * The object list of the plater: the toolbar above it, the rows with their sub-lists, and the
 * manipulation panel of whatever is selected. Tool options are not here any more (T-046): a tool's
 * panel is docked next to its button in the 3D view (`components/tools/`), and since T-055 the
 * toolbar holds only object actions – move/rotate/scale, place on face and cut live in the tool bar
 * alone, so no action exists twice.
 */
export function ObjectsSection() {
  const objects = useStore((s) => s.objects);
  const selectedIds = useStore((s) => s.selectedIds);
  const selectedVolumeId = useStore((s) => s.selectedVolumeId);
  const duplicate = useStore((s) => s.duplicateObjects);
  const mergeObjects = useStore((s) => s.mergeObjects);
  const arrange = useStore((s) => s.arrange);
  const clear = useStore((s) => s.clearObjects);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.undoStack.length > 0);
  const canRedo = useStore((s) => s.redoStack.length > 0);
  const autosaveError = useStore((s) => s.autosaveError);
  const discardAutosave = useStore((s) => s.discardAutosave);
  const openDialog = useStore((s) => s.openDialog);
  const [addMenuFor, setAddMenuFor] = useState<string | null>(null);
  // which objects show their instance sub-list (like the volume list, collapsed by default)
  const [instancesOpen, setInstancesOpen] = useState<Record<string, boolean>>({});
  // the row whose name is being edited (double-click on the name or F2 on the selection)
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const selected = useSelectedObjects();
  const selectedVolume = selected.length === 1 ? selected[0].volumes.find((v) => v.id === selectedVolumeId) : undefined;
  const deleteSelection = useDeleteSelection();
  const { addInstance, removeOneInstance, instanceCount } = useInstanceActions();

  // T-042: a rename requested elsewhere (F2, the workspace key handler) opens the inline field here
  const renameRequest = useStore((s) => s.renameRequest);
  useEffect(() => {
    if (!renameRequest) return;
    setRenamingId(renameRequest);
    useStore.setState({ renameRequest: undefined });
  }, [renameRequest]);

  // only objects with a single instance can be merged (one world position per object, T-042)
  const mergeSelection = selected.filter((o) => o.instances.length === 1);
  const canMerge = selected.length > 1 && mergeSelection.length === selected.length;
  const mergeTitle = canMerge
    ? 'Merge the selected objects into one (the first keeps its settings and paint)'
    : selected.length > 1
      ? 'Only objects with a single instance can be merged'
      : 'Merge: select two or more objects with a single instance';

  return (
    <section className="objects">
      <SectionHeader title={`Objects (${objects.length})`}>
        <div className="tools">
          <ToolbarButton title="Undo (Ctrl+Z)" icon={ACTION_ICONS.undo} onClick={undo} disabled={!canUndo} />
          <ToolbarButton title="Redo (Ctrl+Y)" icon={ACTION_ICONS.redo} onClick={redo} disabled={!canRedo} />
          <span className="tool-sep" aria-hidden="true" />
          <ToolbarButton title="Arrange (A)" icon={ACTION_ICONS.arrange} onClick={arrange} disabled={!objects.length} />
          <ArrangeSettingsMenu />
          <ToolbarButton title="Add instance (+)" icon={ACTION_ICONS.addInstance} onClick={addInstance} disabled={selected.length !== 1} />
          <ToolbarButton
            title="Remove the last instance (−)"
            icon={ACTION_ICONS.removeInstance}
            onClick={removeOneInstance}
            disabled={selected.length !== 1 || instanceCount <= 1}
          />
          <span className="tool-sep" aria-hidden="true" />
          <ToolbarButton title={mergeTitle} icon={ACTION_ICONS.merge} onClick={() => void mergeObjects(selectedIds)} disabled={!canMerge} />
          <ToolbarButton
            title="Duplicate"
            icon={ACTION_ICONS.duplicate}
            onClick={() => duplicate(selectedIds)}
            disabled={!selected.length}
          />
          <ToolbarButton
            title="Delete the picked instance, otherwise the selected object or volume (Del)"
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
      <ul className="object-list">
        {objects.map((o) => (
          <ObjectRow
            key={o.id}
            o={o}
            menuOpen={addMenuFor === o.id}
            onMenu={(open) => setAddMenuFor(open ? o.id : null)}
            instancesShown={!!instancesOpen[o.id]}
            onToggleInstances={() => setInstancesOpen((m) => ({ ...m, [o.id]: !m[o.id] }))}
            renaming={renamingId === o.id}
            onRename={() => setRenamingId(o.id)}
            onStopRename={() => setRenamingId(null)}
          />
        ))}
        {!objects.length && autosaveError && (
          <li className="empty restore">
            <div>Restoring the previous session failed: {autosaveError}</div>
            <div className="manip-actions">
              <button className="primary" onClick={retrySession}>
                Retry
              </button>
              <button onClick={discardAutosave}>Discard</button>
            </div>
          </li>
        )}
        {!objects.length && !autosaveError && (
          <li className="empty">
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
          </li>
        )}
      </ul>
      {selected.length === 1 && selectedVolume && <VolumeManipulation o={selected[0]} v={selectedVolume} />}
      {selected.length === 1 && !selectedVolume && <ObjectManipulation o={selected[0]} />}
      {selected.length > 1 && <div className="muted small">{selected.length} objects selected</div>}
    </section>
  );
}
