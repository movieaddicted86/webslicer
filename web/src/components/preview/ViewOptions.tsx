import { useStore } from '../../state/store';
import { MARKER_COLORS, MARKER_KINDS } from '../../gcode/types';
import { COLOR_MODES, type PreviewColorMode } from '../../gcode/colorschemes';
import { MARKER_LABEL } from './formats';

/** What the preview draws: travel moves, markers, shells and the colour mode of the toolpaths. */
export function ViewOptions() {
  const showTravel = useStore((s) => s.previewShowTravel);
  const setShowTravel = useStore((s) => s.setPreviewShowTravel);
  const markerVis = useStore((s) => s.previewMarkers);
  const toggleMarker = useStore((s) => s.togglePreviewMarker);
  const showShells = useStore((s) => s.previewShowShells);
  const setShowShells = useStore((s) => s.setPreviewShowShells);
  const colorMode = useStore((s) => s.previewColorMode);
  const setColorMode = useStore((s) => s.setPreviewColorMode);
  return (
    <>
      <label className="checkbox small">
        <input type="checkbox" checked={showTravel} onChange={(e) => setShowTravel(e.target.checked)} /> Show travel moves
      </label>
      <div className="view-options">
        <div className="small muted">Show</div>
        {MARKER_KINDS.map((k) => (
          <label key={k} className="checkbox small" title={`Mark ${MARKER_LABEL[k].toLowerCase()} in the preview`}>
            <input type="checkbox" checked={markerVis[k]} onChange={() => toggleMarker(k)} />
            <span className="swatch" style={{ background: MARKER_COLORS[k] }} />
            {MARKER_LABEL[k]}
          </label>
        ))}
        <label className="checkbox small" title="Draw the plater objects translucent over the toolpaths">
          <input type="checkbox" checked={showShells} onChange={(e) => setShowShells(e.target.checked)} /> Shells
        </label>
      </div>
      <label className="view-mode small">
        <span>View</span>
        <select value={colorMode} onChange={(e) => setColorMode(e.target.value as PreviewColorMode)}>
          {COLOR_MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
