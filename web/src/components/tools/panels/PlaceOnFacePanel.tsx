import { useStore } from '../../../state/store';
import { ToolSection } from '../fields/ToolSection';

/**
 * The "Place on face" panel (T-046, moved out of the sidebar): the tool works by a click on a face in
 * the 3D view, so the panel explains that and names the target. The click handler (`useScene`) reads
 * `activeTool === 'placeOnFace'`.
 */
export function PlaceOnFacePanel() {
  const selected = useStore((s) => (s.selectedIds.length === 1 ? s.objects.find((o) => o.id === s.selectedIds[0]) : undefined));
  return (
    <ToolSection title={selected ? selected.name : 'No object selected'}>
      <p className="muted small">
        Click the face in the 3D view that should lie flat on the bed. The object is turned so that face points down and then dropped onto
        the bed. Esc leaves the tool.
      </p>
      {!selected && <p className="muted small">Select an object first – the tool needs the object to turn.</p>}
    </ToolSection>
  );
}
