import { useStore } from '../../state/store';
import { api } from '../../api';
import { SectionHeader } from '../common/SectionHeader';
import { fmtMegabytes, fmtTime } from '../../format';

/** PrusaSlicer's "Sliced info": the numbers of the finished job and what can be done with the G-code. */
export function SlicedInfo() {
  const job = useStore((s) => s.job);
  const gcode = useStore((s) => s.gcode);
  const openDialog = useStore((s) => s.openDialog);
  const physical = useStore((s) => s.physicalPrinters);
  if (!job) return null;
  const info = job.info;
  return (
    <section className="stats">
      <SectionHeader title="Sliced info" />
      <table>
        <tbody>
          <tr>
            <td>File</td>
            <td title={job.outputName}>{job.outputName}</td>
          </tr>
          <tr>
            <td>Estimated time</td>
            <td>{info?.estimatedTime || fmtTime(info?.estimatedTimeSeconds)}</td>
          </tr>
          <tr>
            <td>Filament</td>
            <td>
              {info?.filamentUsedMm ? `${(info.filamentUsedMm.reduce((a, b) => a + b, 0) / 1000).toFixed(2)} m` : '–'}
              {info?.totalFilamentG ? ` · ${info.totalFilamentG.toFixed(1)} g` : ''}
              {info?.filamentUsedCm3 ? ` · ${info.filamentUsedCm3.reduce((a, b) => a + b, 0).toFixed(1)} cm³` : ''}
            </td>
          </tr>
          {info?.totalFilamentCost ? (
            <tr>
              <td>Cost</td>
              <td>{info.totalFilamentCost.toFixed(2)}</td>
            </tr>
          ) : null}
          <tr>
            <td>Layers</td>
            <td>{gcode?.layerCount ?? '–'}</td>
          </tr>
          <tr>
            <td>Size</td>
            <td>{info ? fmtMegabytes(info.sizeBytes) : '–'}</td>
          </tr>
        </tbody>
      </table>
      <div className="actions">
        <a className="button primary" href={api.gcodeUrl(job.id, true)} download>
          ⤓ Export G-code
        </a>
        <button
          className="secondary"
          onClick={() => openDialog('library', 'saveGcode')}
          title="Copy the G-code into the server library (mounted folder)"
        >
          🗂 Save to library
        </button>
        <button
          className="secondary"
          onClick={() => openDialog('sendToPrinter')}
          disabled={!physical.length}
          title={physical.length ? '' : 'Add a physical printer first'}
        >
          ➤ Send to printer
        </button>
      </div>
    </section>
  );
}
