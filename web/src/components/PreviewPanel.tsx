import { useStore } from '../state/store';
import { PanelCard } from './context/PanelCard';
import { LayerCodes } from './preview/LayerCodes';
import { LayerSlider } from './preview/LayerSlider';
import { MoveSlider } from './preview/MoveSlider';
import { ViewOptions } from './preview/ViewOptions';
import { Preflight } from './preview/Preflight';
import { fmtZ } from '../format';
import './PreviewPanel.css';
import './common/progress.css';

/**
 * The preview of the context panel (F-14, L-5): the state of the job, the view card (colour scheme and
 * the "Show" rows), the G-code check and the layer card with the range summary and the layer controls.
 * The result itself (Sliced info, Legend) is in the left column and is not repeated here.
 *
 * The cards are the mockup's: one heading per thing the user does to the result. The slicing state –
 * a running job, an error, a stale result, the slicer warnings – keeps its section above them, so a
 * running slice still shows its progress, its log and its cancel button.
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
  const topZ = gcode?.layerZ[range[1]];

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
          <PanelCard title="View" icon="preview" testId="preview-view-card">
            <ViewOptions />
          </PanelCard>
          <PanelCard title="G-code check" icon="about" testId="preview-check-card">
            <Preflight />
          </PanelCard>
          {gcode && (
            <PanelCard title="Layer" icon="layerHeight" testId="preview-layer-card">
              <div className="layers">
                <div className="layer-summary" data-testid="layer-summary">
                  Showing layers {range[0] + 1} – {range[1] + 1} / {gcode.layerCount}
                  {topZ !== undefined && <span className="muted"> · Z {fmtZ(topZ)} mm</span>}
                </div>
                <LayerSlider gcode={gcode} />
                <LayerCodes printZ={gcode.layerZ[range[1]]} firstLayer={range[1] === 0} maxZ={gcode.layerZ[gcode.layerCount - 1] ?? 0} />
                <MoveSlider gcode={gcode} />
              </div>
            </PanelCard>
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
