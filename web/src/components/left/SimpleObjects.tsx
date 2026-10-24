import { useStore } from '../../state/store';
import { navEntry } from '../../nav/navMap';
import { runNavAction } from '../../nav/actions';
import { retrySession } from '../../state/session';
import { ToolbarButton } from '../common/ToolbarButton';
import { ObjectToolbar } from './ObjectToolbar';
import './SimpleObjects.css';

/**
 * The reduced objects section of Simple mode: the list-level actions ("delete all") and the empty
 * state, no list. The plate and selection commands (arrange, add/remove an instance, delete) are in
 * the tool strip since L-4, next to the tools they share the scene with.
 */
export function SimpleObjects() {
  const objects = useStore((s) => s.objects);
  const clear = useStore((s) => s.clearObjects);
  const autosaveError = useStore((s) => s.autosaveError);
  const discardAutosave = useStore((s) => s.discardAutosave);

  return (
    <section className="objects simple" data-testid="object-list">
      <ObjectToolbar>
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
        Simple mode: object commands (arrange, duplicate an instance, delete) are in the tool strip at the top of the view; move objects
        with the gizmo in the 3D view. Switch to <b>Advanced</b> or <b>Expert</b> for the object list, per-object settings, modifiers and
        height ranges.
      </div>
    </section>
  );
}
