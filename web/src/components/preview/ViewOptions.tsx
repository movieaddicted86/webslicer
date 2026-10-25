import { useStore } from '../../state/store';
import { FEATURE_COLORS, MARKER_COLORS, MARKER_KINDS } from '../../gcode/types';
import { GroupTitle } from '../common/GroupTitle';
import { PanelRow } from '../common/PanelRow';
import { Switch } from '../common/Switch';
import { MARKER_LABEL } from './formats';
import { SchemeSelect } from './SchemeSelect';
import './ViewOptions.css';

/** Travel's colour in the legend is the muted grey the feature list gives it. */
const TRAVEL_COLOR = FEATURE_COLORS.Travel || FEATURE_COLORS.Unknown;

/**
 * The View card of the preview: the colour scheme of the toolpaths and the "Show" rows – travel, the
 * marker kinds and the shells – each with its legend swatch and a switch.
 *
 * The rows are the panel's labelled rows (name left, control in the 150 px column), so the card reads
 * as the mockup's list of things to show. A marker's swatch is the colour the preview draws it in, the
 * same colour the legend lists.
 */
export function ViewOptions() {
  const showTravel = useStore((s) => s.previewShowTravel);
  const setShowTravel = useStore((s) => s.setPreviewShowTravel);
  const markerVis = useStore((s) => s.previewMarkers);
  const toggleMarker = useStore((s) => s.togglePreviewMarker);
  const showShells = useStore((s) => s.previewShowShells);
  const setShowShells = useStore((s) => s.setPreviewShowShells);
  return (
    <>
      <PanelRow label="Colour by" title="What the toolpath colours show">
        <SchemeSelect testId="preview-view-mode" className="view-mode" />
      </PanelRow>
      <GroupTitle>Show</GroupTitle>
      <div className="view-options">
        <PanelRow
          label={
            <>
              <span className="swatch" style={{ background: TRAVEL_COLOR, opacity: 0.35 }} />
              Travel
            </>
          }
          title="Draw the travel moves between the extrusions"
        >
          <Switch checked={showTravel} onChange={setShowTravel} label="Travel" title="Show travel moves" testId="preview-show-travel" />
        </PanelRow>
        {MARKER_KINDS.map((k) => (
          <PanelRow
            key={k}
            label={
              <>
                <span className="swatch" style={{ background: MARKER_COLORS[k] }} />
                {MARKER_LABEL[k]}
              </>
            }
            title={`Mark ${MARKER_LABEL[k].toLowerCase()} in the preview`}
          >
            <Switch
              checked={markerVis[k]}
              onChange={() => toggleMarker(k)}
              label={MARKER_LABEL[k]}
              title={`Show ${MARKER_LABEL[k].toLowerCase()}`}
              testId={`preview-show-${k}`}
            />
          </PanelRow>
        ))}
        <PanelRow label="Shells" title="Draw the plater objects translucent over the toolpaths">
          <Switch
            checked={showShells}
            onChange={setShowShells}
            label="Shells"
            title="Draw the plater objects translucent over the toolpaths"
            testId="preview-show-shells"
          />
        </PanelRow>
      </div>
    </>
  );
}
