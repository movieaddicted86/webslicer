import { useStore } from '../../state/store';
import { fmtMegabytes, fmtTime } from '../../format';
import { PanelRow } from '../common/PanelRow';
import './SlicedInfo.css';

/**
 * PrusaSlicer's "Sliced info": the numbers of the finished job, as the mockup's rows – used filament,
 * estimated time and layers – over the file and its size.
 *
 * The actions on the result (export, save to library, send) are in the footer card of the preview, so
 * this card stays a reading of the numbers. The heading is the card that holds it (the left column).
 */
export function SlicedInfo() {
  const job = useStore((s) => s.job);
  const gcode = useStore((s) => s.gcode);
  if (!job) return null;
  const info = job.info;
  const filamentMm = info?.filamentUsedMm?.reduce((a, b) => a + b, 0) ?? 0;
  return (
    <div className="stats">
      <PanelRow label="File" title={job.outputName}>
        <span className="file-name">{job.outputName}</span>
      </PanelRow>
      <PanelRow label="Used filament" title="Filament of the whole print, length and weight">
        <span>
          {filamentMm ? `${(filamentMm / 1000).toFixed(2)} m` : '–'}
          {info?.totalFilamentG ? ` · ${info.totalFilamentG.toFixed(1)} g` : ''}
          {info?.filamentUsedCm3 ? ` · ${info.filamentUsedCm3.reduce((a, b) => a + b, 0).toFixed(1)} cm³` : ''}
        </span>
      </PanelRow>
      <PanelRow label="Estimated time">
        <b>{info?.estimatedTime || fmtTime(info?.estimatedTimeSeconds)}</b>
      </PanelRow>
      {info?.totalFilamentCost ? (
        <PanelRow label="Cost" title="Cost of the filament the print uses">
          <span>{info.totalFilamentCost.toFixed(2)}</span>
        </PanelRow>
      ) : null}
      <PanelRow label="Layers">
        <span>{gcode?.layerCount ?? '–'}</span>
      </PanelRow>
      <PanelRow label="Size" title="Size of the G-code file on the server">
        <span>{info ? fmtMegabytes(info.sizeBytes) : '–'}</span>
      </PanelRow>
    </div>
  );
}

/** The "SLICED" badge of the result card: the job is done and its numbers are the ones shown. */
export function SlicedBadge() {
  const job = useStore((s) => s.job);
  if (job?.status !== 'done') return null;
  return (
    <span className="badge ok" data-testid="sliced-badge">
      SLICED
    </span>
  );
}
