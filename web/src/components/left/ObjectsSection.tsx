import { useEffect, useState } from 'react';
import { useStore } from '../../state/store';
import { navEntry } from '../../nav/navMap';
import { runNavAction } from '../../nav/actions';
import { retrySession } from '../../state/session';
import { requestImport } from '../../importTrigger';
import { allVisible, mergeRule, visibilityTitle } from '../../selection';
import { Icon } from '../../icons/Icon';
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
 * what is about the list itself: merge, duplicate, hide/show and delete all. A function has one home.
 *
 * The selection rules (click, Ctrl/Cmd toggle, Shift range) are the shared ones in `selection.ts` and
 * live in the store (`selectByClick` keeps the anchor), so the viewer and this list pick the same
 * objects with one rule. A row only hands its click over.
 */
export function ObjectsSection() {
  const objects = useStore((s) => s.objects);
  const selectedIds = useStore((s) => s.selectedIds);
  const selectByClick = useStore((s) => s.selectByClick);
  const duplicate = useStore((s) => s.duplicateObjects);
  const mergeObjects = useStore((s) => s.mergeObjects);
  const setObjectsVisible = useStore((s) => s.setObjectsVisible);
  const clear = useStore((s) => s.clearObjects);
  const autosaveDiscard = useStore((s) => s.discardAutosave);
  const autosaveError = useStore((s) => s.autosaveError);
  // which objects show their instance list (collapsed by default)
  const [instancesOpen, setInstancesOpen] = useState<Record<string, boolean>>({});
  // the object whose row is being renamed (double-click or the shared rename request)
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const selected = useSelectedObjects();

  // a rename requested elsewhere (F2, the workspace key handler) opens the inline field here
  const renameRequest = useStore((s) => s.renameRequest);
  useEffect(() => {
    if (!renameRequest) return;
    setRenamingId(renameRequest);
    useStore.setState({ renameRequest: undefined });
  }, [renameRequest]);

  const merge = mergeRule(selected);
  const shown = allVisible(selected);

  return (
    <section className="objects" data-testid="object-list">
      <ObjectToolbar>
        {/* the plate/selection commands are in the tool strip now; what stays is about the list */}
        <ToolbarButton
          title={merge.ok ? 'Merge the selected objects into one (the first keeps its settings and paint)' : merge.reason}
          icon="merge"
          testId="object-merge"
          onClick={() => void mergeObjects(selectedIds)}
          disabled={!merge.ok}
        />
        <ToolbarButton
          title="Duplicate the selected objects"
          icon="duplicate"
          testId="object-duplicate"
          onClick={() => duplicate(selectedIds)}
          disabled={!selected.length}
        />
        <ToolbarButton
          title={visibilityTitle(selected)}
          icon={shown ? 'hidden' : 'visible'}
          testId="object-visibility"
          onClick={() => setObjectsVisible(selectedIds, !shown)}
          disabled={!selected.length}
        />
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
            onSelect={(mods) => selectByClick(o.id, mods)}
          />
        ))}
        {!objects.length && autosaveError && (
          <li className="empty restore">
            <div>Restoring the previous session failed: {autosaveError}</div>
            <div className="manip-actions">
              <button className="primary" onClick={retrySession}>
                Retry
              </button>
              <button onClick={autosaveDiscard}>Discard</button>
            </div>
          </li>
        )}
        {!objects.length && !autosaveError && (
          <li className="empty">
            <div>
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
            {/* the file input belongs to the menu; the empty list asks it to open – no second menu entry */}
            <button className="add-objects" data-testid="add-objects" onClick={requestImport}>
              <Icon name="import" size={16} />
              Add objects…
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}
