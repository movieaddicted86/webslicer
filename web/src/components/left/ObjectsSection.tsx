import { useEffect, useState } from 'react';
import { useStore } from '../../state/store';
import { navEntry } from '../../nav/navMap';
import { runNavAction } from '../../nav/actions';
import { retrySession } from '../../state/session';
import { ToolbarButton } from '../common/ToolbarButton';
import { ObjectToolbar } from './ObjectToolbar';
import { ObjectRow } from './ObjectRow';
import { useSelectedObjects } from './selection';
import './ObjectsSection.css';

/**
 * The object list of the plater: the toolbar above it and the plain rows. The title and the count of
 * the list are the heading of the card that holds it (the left column), so this section starts with
 * the toolbar.
 *
 * The list is an overview: a row selects, renames, folds its instances away and shows its state. The
 * selected object's manipulation, settings, parts and layer ranges are in the context panel, so a row
 * never grows into a settings form again.
 *
 * L-4: the actions that act on the plate or the selection as a whole – arrange and its settings, add
 * and remove an instance, delete – live in the tool strip at the top of the scene. The toolbar keeps
 * what is about the list itself: merge, duplicate and delete all. A function has one home.
 */
export function ObjectsSection() {
  const objects = useStore((s) => s.objects);
  const selectedIds = useStore((s) => s.selectedIds);
  const duplicate = useStore((s) => s.duplicateObjects);
  const mergeObjects = useStore((s) => s.mergeObjects);
  const clear = useStore((s) => s.clearObjects);
  const autosaveError = useStore((s) => s.autosaveError);
  const discardAutosave = useStore((s) => s.discardAutosave);
  // which objects show their instance sub-list (collapsed by default)
  const [instancesOpen, setInstancesOpen] = useState<Record<string, boolean>>({});
  // the row whose name is being edited (double-click on the name or F2 on the selection)
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const selected = useSelectedObjects();

  // a rename requested elsewhere (F2, the workspace key handler) opens the inline field here
  const renameRequest = useStore((s) => s.renameRequest);
  useEffect(() => {
    if (!renameRequest) return;
    setRenamingId(renameRequest);
    useStore.setState({ renameRequest: undefined });
  }, [renameRequest]);

  // only objects with a single instance can be merged (one world position per object)
  const mergeSelection = selected.filter((o) => o.instances.length === 1);
  const canMerge = selected.length > 1 && mergeSelection.length === selected.length;
  const mergeTitle = canMerge
    ? 'Merge the selected objects into one (the first keeps its settings and paint)'
    : selected.length > 1
      ? 'Only objects with a single instance can be merged'
      : 'Merge: select two or more objects with a single instance';

  return (
    <section className="objects" data-testid="object-list">
      <ObjectToolbar>
        {/* the plate/selection commands are in the tool strip now; what stays is about the list */}
        <ToolbarButton title={mergeTitle} icon="merge" onClick={() => void mergeObjects(selectedIds)} disabled={!canMerge} />
        <ToolbarButton title="Duplicate" icon="duplicate" onClick={() => duplicate(selectedIds)} disabled={!selected.length} />
        <span className="tool-sep" aria-hidden="true" />
        <ToolbarButton
          title="Delete all"
          icon="deleteAll"
          onClick={() => objects.length && confirm('Remove all objects?') && clear()}
          disabled={!objects.length}
        />
      </ObjectToolbar>
      <ul className="object-list">
        {objects.map((o) => (
          <ObjectRow
            key={o.id}
            o={o}
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
                void runNavAction(navEntry('library').action);
              }}
            >
              open the library
            </a>
            .
          </li>
        )}
      </ul>
    </section>
  );
}
