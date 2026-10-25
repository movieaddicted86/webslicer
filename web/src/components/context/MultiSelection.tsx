import { useStore, type PlaterObject } from '../../state/store';
import { allVisible, mergeRule, visibilityTitle } from '../../selection';
import { PanelCard } from './PanelCard';
import { ToolbarButton } from '../common/ToolbarButton';
import { deleteSelection } from '../../tools/stripActions';
import './MultiSelection.css';

/**
 * The context panel while several objects are selected: the count and the group actions that exist.
 * The list's toolbar keeps the same actions (merge, duplicate, hide/show, delete), and so does the
 * tool strip for the delete and the arrange; both cards take their labels from the same rules
 * (`selection.ts`) so a tooltip cannot describe something the button does not do.
 *
 * No transform editing here: the transform of one object needs its own fields, and editing several
 * at once is out of scope. Picking a single object brings the Transform card back.
 */
export function MultiSelection({ selected }: { selected: PlaterObject[] }) {
  const mergeObjects = useStore((s) => s.mergeObjects);
  const duplicate = useStore((s) => s.duplicateObjects);
  const setObjectsVisible = useStore((s) => s.setObjectsVisible);
  const arrangeSelection = useStore((s) => s.arrangeSelection);
  const ids = selected.map((o) => o.id);
  const merge = mergeRule(selected);
  const shown = allVisible(selected);
  return (
    <PanelCard title={`${selected.length} objects selected`} icon="objects" testId="multi-selection">
      <div className="multi-actions">
        <ToolbarButton
          title={merge.ok ? 'Merge the selected objects into one (the first keeps its settings and paint)' : merge.reason}
          icon="merge"
          label="Merge"
          testId="multi-merge"
          onClick={() => void mergeObjects(ids)}
          disabled={!merge.ok}
        />
        <ToolbarButton
          title="Duplicate the selected objects"
          icon="duplicate"
          label="Duplicate"
          testId="multi-duplicate"
          onClick={() => void duplicate(ids)}
        />
        <ToolbarButton
          title={visibilityTitle(selected)}
          icon={shown ? 'hidden' : 'visible'}
          label={shown ? 'Hide' : 'Show'}
          testId="multi-visibility"
          onClick={() => setObjectsVisible(ids, !shown)}
        />
        <ToolbarButton
          title="Arrange only the selected objects around the others (Shift+A)"
          icon="arrange"
          label="Arrange selection"
          testId="multi-arrange"
          onClick={() => arrangeSelection()}
        />
        <ToolbarButton
          title="Delete the selected objects (Del)"
          icon="delete"
          label="Delete"
          testId="multi-delete"
          onClick={deleteSelection}
        />
      </div>
    </PanelCard>
  );
}
