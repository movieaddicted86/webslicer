import { useState } from 'react';
import { useStore } from '../../state/store';
import { useMediaQuery } from '../left/useMediaQuery';
import { Icon } from '../../icons/Icon';
import { SlicedInfo } from './SlicedInfo';
import { PreviewLegend } from './Legend';
import { SchemeSelect } from './SchemeSelect';
import { useLegendData } from './useLegendData';
import './PreviewInfo.css';

/** The width below which the legend and the stats live in a chip inside the sheet. */
const PHONE_QUERY = '(max-width: 640px)';

/**
 * The legend and the stats of the result on a phone (T-092). On a wide window they are the object
 * list's two cards; on a phone that list is a drawer, and a card floating over the model would hide
 * the print the user is looking at.
 *
 * R-05 made it a labelled **Details** chip in the sheet's peek row (T-099): it sat in the preview
 * card's body, which at `peek` is folded away and at `half` starts with the layer card – so it was
 * there, but under the fold. In the footer it is visible without opening the sheet, and it opens the
 * sliced info and the legend in the footer's own scroll room.
 */
export function PreviewInfo() {
  const phone = useMediaQuery(PHONE_QUERY);
  const [open, setOpen] = useState(false);
  const job = useStore((s) => s.job);
  const legend = useLegendData();
  if (!phone) return null;
  if (job?.status !== 'done' && !legend.gcode) return null;
  return (
    <section className={`preview-info${open ? ' open' : ''}`} data-testid="preview-info">
      <button
        className="preview-info-head"
        data-testid="preview-info-toggle"
        aria-expanded={open}
        aria-controls="preview-info-body"
        title={open ? 'Hide the sliced info and the legend' : 'Show the sliced info and the legend'}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="preview-info-action">Details</span>
        <Icon name="expand" size={16} />
      </button>
      {open && (
        <div className="preview-info-body" id="preview-info-body">
          <div data-testid="preview-info-stats">
            <SlicedInfo />
          </div>
          {legend.gcode && (
            <>
              <div className="preview-info-legend-head">
                <span>Legend</span>
                <SchemeSelect testId="preview-info-scheme" className="scheme-head" />
              </div>
              <PreviewLegend
                gcode={legend.gcode}
                usedTools={legend.usedTools}
                featureTimeScale={legend.featureTimeScale}
                featureShare={legend.featureShare}
                estimatedSeconds={legend.estimatedSeconds}
              />
            </>
          )}
        </div>
      )}
    </section>
  );
}
