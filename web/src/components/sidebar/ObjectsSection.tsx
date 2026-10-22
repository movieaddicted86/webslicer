import { useState } from 'react';
import { useStore } from '../../state/store';
import { retrySession } from '../../state/session';
import { SectionHeader } from '../common/SectionHeader';
import { ToolbarButton } from '../common/ToolbarButton';
import { ACTION_ICONS } from '../common/icons';
import { ObjectRow } from './ObjectRow';
import { ObjectManipulation } from './ObjectManipulation';
import { VolumeManipulation } from './VolumeManipulation';
import { useDeleteSelection, useInstanceActions, useSelectedObjects } from './selection';

/**
 * The object list of the plater: the toolbar above it, the rows with their sub-lists, and the
 * manipulation panel of whatever is selected.
 */
export function ObjectsSection() {
  const objects = useStore((s) => s.objects);
  const selectedIds = useStore((s) => s.selectedIds);
  const selectedVolumeId = useStore((s) => s.selectedVolumeId);
  const duplicate = useStore((s) => s.duplicateObjects);
  const arrange = useStore((s) => s.arrange);
  const clear = useStore((s) => s.clearObjects);
  const transformMode = useStore((s) => s.transformMode);
  const setTransformMode = useStore((s) => s.setTransformMode);
  const placeOnFace = useStore((s) => s.placeOnFace);
  const setPlaceOnFace = useStore((s) => s.setPlaceOnFace);
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

  const selected = useSelectedObjects();
  const selectedVolume = selected.length === 1 ? selected[0].volumes.find((v) => v.id === selectedVolumeId) : undefined;
  const deleteSelection = useDeleteSelection();
  const { addInstance, removeOneInstance, instanceCount } = useInstanceActions();

  return (
    <section className="objects">
      <SectionHeader title={`Objects (${objects.length})`}>
        <div className="tools">
          <ToolbarButton title="Undo (Ctrl+Z)" icon={ACTION_ICONS.undo} onClick={undo} disabled={!canUndo} />
          <ToolbarButton title="Redo (Ctrl+Y)" icon={ACTION_ICONS.redo} onClick={redo} disabled={!canRedo} />
          <span className="tool-sep" aria-hidden="true" />
          <ToolbarButton
            title="Move (M)"
            icon={ACTION_ICONS.move}
            active={transformMode === 'translate'}
            onClick={() => setTransformMode('translate')}
          />
          <ToolbarButton
            title="Rotate (R)"
            icon={ACTION_ICONS.rotate}
            active={transformMode === 'rotate'}
            onClick={() => setTransformMode('rotate')}
          />
          <ToolbarButton
            title="Scale (S)"
            icon={ACTION_ICONS.scale}
            active={transformMode === 'scale'}
            onClick={() => setTransformMode('scale')}
          />
          <ToolbarButton
            title="Place on face (F): click a face in the 3D view to lay it flat on the bed"
            icon={ACTION_ICONS.placeOnFace}
            active={placeOnFace}
            onClick={() => setPlaceOnFace(!placeOnFace)}
            disabled={!objects.length}
          />
          <span className="tool-sep" aria-hidden="true" />
          <ToolbarButton title="Arrange (A)" icon={ACTION_ICONS.arrange} onClick={arrange} disabled={!objects.length} />
          <ToolbarButton title="Add instance (+)" icon={ACTION_ICONS.addInstance} onClick={addInstance} disabled={selected.length !== 1} />
          <ToolbarButton
            title="Remove the last instance (−)"
            icon={ACTION_ICONS.removeInstance}
            onClick={removeOneInstance}
            disabled={selected.length !== 1 || instanceCount <= 1}
          />
          <span className="tool-sep" aria-hidden="true" />
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
