import { useStore } from '../../../state/store';
import { ToolSection } from '../fields/ToolSection';
import { ToolPanel } from '../ToolPanel';

/**
 * The "Place on face" panel: the tool works by a click on a face in the 3D view, so the panel explains
 * that and names the target. The click handler (`useScene`) reads `activeTool === 'placeOnFace'`.
 *
 * It uses the shared frame like every other tool panel, so it carries the title, the ✕ and the key
 * hints from its registry entry as well; without them a panel in the context panel would have no way
 * out but Esc.
 */
export function PlaceOnFacePanel() {
  const selected = useStore((s) => (s.selectedIds.length === 1 ? s.objects.find((o) => o.id === s.selectedIds[0]) : undefined));
  const close = useStore((s) => s.closeTool);
  return (
    <ToolPanel title="Place on face" onClose={close}>
      <ToolSection title={selected ? selected.name : 'No object selected'}>
        <p className="muted small">
          Click the face in the 3D view that should lie flat on the bed. The object is turned so that face points down and then dropped onto
          the bed.
        </p>
        {!selected && <p className="muted small">Select an object first – the tool needs the object to turn.</p>}
      </ToolSection>
    </ToolPanel>
  );
}
