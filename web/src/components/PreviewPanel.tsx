import { useStore } from '../state/store';
import { SectionHeader } from './common/SectionHeader';
import { LayerCodes } from './preview/LayerCodes';
import { LayerSlider } from './preview/LayerSlider';
import { MoveSlider } from './preview/MoveSlider';
import { ViewOptions } from './preview/ViewOptions';
import { Preflight } from './preview/Preflight';
import { fmtZ } from '../format';
import './PreviewPanel.css';
import './common/progress.css';

/**
 * The preview of the context panel (F-14): the state of the job, the preflight and the layer controls.
 * The slicing result itself (Sliced info, Legend) is in the left column since the layout 3.0 step L-2
 * and is not repeated here; the layer slider, the code list, the move slider and the view options stay.
 */
export function PreviewPanel() {
  const job = useStore((s) => s.job);
  const jobLog = useStore((s) => s.jobLog);
  const gcode = useStore((s) => s.gcode);
  const range = useStore((s) => s.previewLayerRange);
  const setView = useStore((s) => s.setView);
  const sliceDirty = useStore((s) => s.sliceDirty);
  const slice = useStore((s) => s.slice);
  const cancelSlice = useStore((s) => s.cancelSlice);
  const gcodeLoading = useStore((s) => s.gcodeLoading);
  const loadGcodePreview = useStore((s) => s.loadGcodePreview);
  const toast = useStore((s) => s.toast);

  const running = job && (job.status === 'running' || job.status === 'queued');
  const info = job?.info;

  return (
    <div className="preview-panel" data-testid="preview-panel">
      {!job && (
        <section>
          <div className="muted">No slicing result yet.</div>
          <button className="primary big" onClick={slice}>
            Slice now
          </button>
        </section>
      )}
      {job?.configIssues?.length ? (
        <details className="warnings" open>
          <summary>{job.configIssues.length === 1 ? '1 setting warning' : `${job.configIssues.length} setting warnings`}</summary>
          <ul>
            {job.configIssues.map((i, n) => (
              <li key={n}>
                {i.message} <span className="muted small">({i.limit})</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {job && running && (
        <section>
          <div className="progress">
            <div className="bar" style={{ width: `${job.percent}%` }} />
            <span>
              {job.percent}% · {job.message}
            </span>
          </div>
          <button className="secondary" onClick={cancelSlice}>
            Cancel
          </button>
          <pre className="log">{jobLog.slice(-12).join('\n')}</pre>
        </section>
      )}
      {job && job.status === 'error' && (
        <section>
          <div className="error">{job.error}</div>
          <details>
            <summary>Slicer log</summary>
            <pre className="log">{jobLog.join('\n')}</pre>
          </details>
          <button className="primary" onClick={() => setView('plater')}>
            Back to plater
          </button>
        </section>
      )}
      {job && job.status === 'done' && (
        <>
          {sliceDirty && <div className="warn">Settings or objects changed since this result. Slice again to update.</div>}
          {info?.warnings?.length ? (
            <details className="warnings" open>
              <summary>{info.warnings.length === 1 ? '1 slicer warning' : `${info.warnings.length} slicer warnings`}</summary>
              <ul>
                {info.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          ) : null}
          <Preflight />
          {gcode && (
            <section className="layers">
              <SectionHeader
                title={
                  <>
                    Layers {range[0] + 1} – {range[1] + 1} / {gcode.layerCount}
                    <span className="muted"> (Z {gcode.layerZ[range[1]] !== undefined && fmtZ(gcode.layerZ[range[1]])} mm)</span>
                  </>
                }
              />
              <LayerSlider gcode={gcode} />
              <LayerCodes printZ={gcode.layerZ[range[1]]} firstLayer={range[1] === 0} maxZ={gcode.layerZ[gcode.layerCount - 1] ?? 0} />
              <MoveSlider gcode={gcode} />
              <ViewOptions />
            </section>
          )}
          {!gcode && gcodeLoading && <div className="muted small">Loading preview…</div>}
          {!gcode && !gcodeLoading && job.outputName.endsWith('.gcode') && (
            <button className="secondary" onClick={() => loadGcodePreview(job.id).catch((e) => toast('error', e.message))}>
              Load toolpath preview
            </button>
          )}
          {!job.outputName.endsWith('.gcode') && (
            <div className="muted small">No toolpath preview for {job.outputName.split('.').pop()} output.</div>
          )}
          <details>
            <summary className="small">Slicer log</summary>
            <pre className="log">{jobLog.join('\n')}</pre>
          </details>
        </>
      )}
    </div>
  );
}
