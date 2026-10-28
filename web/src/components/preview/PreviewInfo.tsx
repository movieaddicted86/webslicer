import { useState } from 'react';
import { useStore } from '../../state/store';
import { fmtTime } from '../../format';
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
 * the print the user is looking at. So they fold into one chip at the top of the sheet's preview card:
 * it shows the two numbers a glance needs (time and filament) and opens the whole legend and the
 * sliced info in the sheet's own scroll room, never as an overlay over the scene.
 */
export function PreviewInfo() {
  const phone = useMediaQuery(PHONE_QUERY);
  const [open, setOpen] = useState(false);
  const job = useStore((s) => s.job);
  const legend = useLegendData();
  if (!phone) return null;
  const info = job?.info;
  if (job?.status !== 'done' && !legend.gcode) return null;
  const filamentMm = info?.filamentUsedMm?.reduce((a, b) => a + b, 0) ?? 0;
  const time = info?.estimatedTime || fmtTime(info?.estimatedTimeSeconds);
  const filament = info?.totalFilamentG ? `${info.totalFilamentG.toFixed(1)} g` : filamentMm ? `${(filamentMm / 1000).toFixed(2)} m` : '–';
  return (
    <section className={`preview-info${open ? ' open' : ''}`} data-testid="preview-info">
      <button
        className="preview-info-head"
        data-testid="preview-info-toggle"
        aria-expanded={open}
        aria-controls="preview-info-body"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="preview-info-summary" title="Print time and filament">
          {time} · {filament} filament
        </span>
        <span className="preview-info-action">{open ? 'Hide details' : 'Details'}</span>
        <Icon name="expand" size={16} />
      </button>
      {open && (
        <div className="preview-info-body" id="preview-info-body">
          <SlicedInfo />
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
