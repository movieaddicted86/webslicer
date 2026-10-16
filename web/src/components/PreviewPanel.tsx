import { useStore } from '../state/store';
import { api } from '../api';
import { FEATURE_COLORS } from '../gcode/types';

function fmtTime(s?: number) {
  if (!s) return '–';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h ? `${h}h ${m}m ${sec}s` : m ? `${m}m ${sec}s` : `${sec}s`;
}

export function PreviewPanel() {
  const job = useStore((s) => s.job);
  const jobLog = useStore((s) => s.jobLog);
  const gcode = useStore((s) => s.gcode);
  const range = useStore((s) => s.previewLayerRange);
  const setRange = useStore((s) => s.setPreviewLayerRange);
  const showTravel = useStore((s) => s.previewShowTravel);
  const setShowTravel = useStore((s) => s.setPreviewShowTravel);
  const vis = useStore((s) => s.previewFeatureVisibility);
  const toggle = useStore((s) => s.togglePreviewFeature);
  const openDialog = useStore((s) => s.openDialog);
  const physical = useStore((s) => s.physicalPrinters);
  const setView = useStore((s) => s.setView);
  const sliceDirty = useStore((s) => s.sliceDirty);
  const slice = useStore((s) => s.slice);
  const cancelSlice = useStore((s) => s.cancelSlice);

  const running = job && (job.status === 'running' || job.status === 'queued');
  const info = job?.info;

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
          <section className="stats">
            <div className="section-head">
              <span>Sliced info</span>
            </div>
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
                  <td>{info ? `${(info.sizeBytes / 1048576).toFixed(1)} MB` : '–'}</td>
                </tr>
              </tbody>
            </table>
            <div className="actions">
              <a className="button primary" href={api.gcodeUrl(job.id, true)} download>
                ⤓ Export G-code
              </a>
              <button className="secondary" onClick={() => openDialog('sendToPrinter')} disabled={!physical.length} title={physical.length ? '' : 'Add a physical printer first'}>
                ➤ Send to printer
              </button>
            </div>
          </section>
          {gcode && (
            <section className="layers">
              <div className="section-head">
                <span>
                  Layers {range[0] + 1} – {range[1] + 1} / {gcode.layerCount}
                  <span className="muted"> (Z {gcode.layerZ[range[1]]?.toFixed(2)} mm)</span>
                </span>
              </div>
              <label className="small">Top</label>
              <input type="range" min={0} max={gcode.layerCount - 1} value={range[1]} onChange={(e) => setRange([Math.min(range[0], Number(e.target.value)), Number(e.target.value)])} />
              <label className="small">Bottom</label>
              <input type="range" min={0} max={gcode.layerCount - 1} value={range[0]} onChange={(e) => setRange([Number(e.target.value), Math.max(range[1], Number(e.target.value))])} />
              <label className="checkbox small">
                <input type="checkbox" checked={showTravel} onChange={(e) => setShowTravel(e.target.checked)} /> Show travel moves
              </label>
              <ul className="legend">
                {gcode.featureTypes.map((f) => (
                  <li key={f} className={vis[f] === false ? 'off' : ''} onClick={() => toggle(f)}>
                    <span className="swatch" style={{ background: FEATURE_COLORS[f] || FEATURE_COLORS.Unknown }} />
                    <span className="name">{f}</span>
                    <span className="muted">{((gcode.featureLength[f] || 0) / 1000).toFixed(1)} m</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!gcode && job.outputName.endsWith('.gcode') && <div className="muted small">Loading preview…</div>}
          {!job.outputName.endsWith('.gcode') && <div className="muted small">No toolpath preview for {job.outputName.split('.').pop()} output.</div>}
          <details>
            <summary className="small">Slicer log</summary>
            <pre className="log">{jobLog.join('\n')}</pre>
          </details>
        </>
      )}
    </div>
  );
}
