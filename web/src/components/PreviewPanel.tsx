import { useMemo } from 'react';
import { useStore } from '../state/store';
import { SectionHeader } from './common/SectionHeader';
import { LayerCodes } from './preview/LayerCodes';
import { LayerSlider } from './preview/LayerSlider';
import { MoveSlider } from './preview/MoveSlider';
import { ViewOptions } from './preview/ViewOptions';
import { PreviewLegend } from './preview/Legend';
import { SlicedInfo } from './preview/SlicedInfo';
import { fmtZ } from '../format';
import { sumTimes } from './preview/formats';

/**
 * The preview of the sidebar (F-14): the state of the job, the sliced info and the layer view. The
 * layer slider, the code list, the move slider, the view options and the legend live in
 * `components/preview/`.
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
  const usedTools = useMemo(() => (gcode ? [...new Set(gcode.tools)].sort((a, b) => a - b) : []), [gcode]);

  const running = job && (job.status === 'running' || job.status === 'queued');
  const info = job?.info;
  // feature times come from feedrates only, scale them to the slicer's estimate (as the layer legend does)
  const featureTimeScale = useMemo(() => {
    const sum = sumTimes(gcode?.featureTime ?? {});
    return info?.estimatedTimeSeconds && sum > 0 ? info.estimatedTimeSeconds / sum : 1;
  }, [gcode, info?.estimatedTimeSeconds]);
  // share of the print time without travel, so the extruding features add up to 100 %
  const featureShare = useMemo(() => {
    const share: Record<string, number> = {};
    if (!gcode) return share;
    const base = sumTimes(gcode.featureTime) - (gcode.featureTime.Travel || 0);
    if (base <= 0) return share;
    for (const [feature, seconds] of Object.entries(gcode.featureTime)) share[feature] = (seconds / base) * 100;
    return share;
  }, [gcode]);

  return (
    <div className="preview-panel">
      {!job && (
        <section>
          <div className="muted">No slicing result yet.</div>
          <button className="primary big" onClick={slice}>
            Slice now
          </button>
        </section>
      )}
      {running && (
        <section>
          <div className="progress">
            <div className="bar" style={{ width: `${job!.percent}%` }} />
            <span>
              {job!.percent}% · {job!.message}
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
          <SlicedInfo />
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
              <PreviewLegend
                gcode={gcode}
                usedTools={usedTools}
                featureTimeScale={featureTimeScale}
                featureShare={featureShare}
                estimatedSeconds={info?.estimatedTimeSeconds}
              />
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
