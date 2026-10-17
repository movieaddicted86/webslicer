import { useStore } from '../state/store';
import { api, type CustomGcodeType } from '../api';
import { FEATURE_COLORS } from '../gcode/types';
import { colorAtZ, colorPrintSegments, normalizeColor, suggestColor } from '../gcode/colorprint';

const CODE_LABEL: Record<CustomGcodeType, string> = {
  color_change: 'Color change',
  pause: 'Pause',
  custom: 'Custom G-code',
  template: 'Template',
  tool_change: 'Tool change',
};

/** Index of the layer printed at height z (layer heights come from the G-code ;Z: markers). */
function layerIndexOfZ(layerZ: Float32Array, z: number): number {
  for (let i = 0; i < layerZ.length; i++) if (Math.abs(layerZ[i] - z) < 1e-3) return i;
  return -1;
}

/**
 * Colour changes, pauses and custom G-code at layers – PrusaSlicer's "+" on the vertical slider.
 * The code is inserted before the layer at the top slider position is printed.
 */
function LayerCodes({ printZ, firstLayer, maxZ }: { printZ: number | undefined; firstLayer: boolean; maxZ: number }) {
  const codes = useStore((s) => s.customGcodes);
  const add = useStore((s) => s.addCustomGcode);
  const update = useStore((s) => s.updateCustomGcode);
  const remove = useStore((s) => s.removeCustomGcode);
  const extruders = useStore((s) => s.extruderCount());
  const tech = useStore((s) => s.presets.printer.current.printer_technology);
  const baseColor = useStore((s) => normalizeColor(s.presets.filament[0]?.current.filament_colour));
  const job = useStore((s) => s.job);
  const running = job && (job.status === 'running' || job.status === 'queued');
  if (tech === 'SLA' || printZ === undefined) return null;
  const z = Math.round(printZ * 1000) / 1000;
  const existing = codes.find((c) => Math.abs(c.printZ - z) < 1e-4);
  // a change on the first layer has no effect – PrusaSlicer does not allow it either
  const disabled = firstLayer || z >= maxZ + 1e-6;
  return (
    <div className="layer-codes">
      <div className="layer-codes-add">
        <span className="small muted">At Z {z.toFixed(2)} mm:</span>
        <button
          disabled={disabled}
          title="Insert a filament change (M600) before this layer"
          onClick={() => add({ printZ: z, type: 'color_change', extruder: 1, color: suggestColor(colorAtZ(z - 1e-3, baseColor, codes)) })}
        >
          ＋ Color
        </button>
        <button disabled={disabled} title="Pause the print before this layer (e.g. to insert magnets or nuts)" onClick={() => add({ printZ: z, type: 'pause', extra: 'Insert item' })}>
          ⏸ Pause
        </button>
        <button disabled={disabled} title="Insert custom G-code before this layer" onClick={() => add({ printZ: z, type: 'custom', extra: 'M117 Layer change' })}>
          ✎ Custom
        </button>
      </div>
      {disabled && <div className="muted small">Move the top slider above the first layer to add a change.</div>}
      {existing && <div className="muted small">Adding again replaces the {CODE_LABEL[existing.type].toLowerCase()} at this height.</div>}
      {codes.length > 0 && (
        <ul className="code-list">
          {codes.map((c) => (
            <li key={c.printZ} className={Math.abs(c.printZ - z) < 1e-4 ? 'current' : ''}>
              <span className="code-z">{c.printZ.toFixed(2)}</span>
              <span className="code-type">{CODE_LABEL[c.type]}</span>
              {c.type === 'color_change' && (
                <>
                  <input type="color" value={normalizeColor(c.color, '#ffffff')} onChange={(e) => update(c.printZ, { color: e.target.value })} title="Color after the change" />
                  {extruders > 1 && (
                    <select value={c.extruder ?? 1} onChange={(e) => update(c.printZ, { extruder: Number(e.target.value) })} title="Extruder">
                      {Array.from({ length: extruders }, (_, i) => (
                        <option key={i} value={i + 1}>
                          E{i + 1}
                        </option>
                      ))}
                    </select>
                  )}
                </>
              )}
              {c.type === 'pause' && (
                <input className="code-text" value={c.extra ?? ''} onChange={(e) => update(c.printZ, { extra: e.target.value })} title="Message shown on the printer (M117)" />
              )}
              {c.type === 'custom' && (
                <textarea className="code-text" rows={2} value={c.extra ?? ''} onChange={(e) => update(c.printZ, { extra: e.target.value })} spellCheck={false} />
              )}
              <button className="icon" title="Remove" onClick={() => remove(c.printZ)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {codes.length > 0 && running && <div className="muted small">Updating G-code…</div>}
    </div>
  );
}

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
  const gcodeLoading = useStore((s) => s.gcodeLoading);
  const loadGcodePreview = useStore((s) => s.loadGcodePreview);
  const toast = useStore((s) => s.toast);
  const customGcodes = useStore((s) => s.customGcodes);
  const colorMode = useStore((s) => s.previewColorMode);
  const setColorMode = useStore((s) => s.setPreviewColorMode);
  const baseColor = useStore((s) => normalizeColor(s.presets.filament[0]?.current.filament_colour));

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
              <button className="secondary" onClick={() => openDialog('library', 'saveGcode')} title="Copy the G-code into the server library (mounted folder)">
                🗂 Save to library
              </button>
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
              <div className="slider-with-markers">
                <input type="range" min={0} max={gcode.layerCount - 1} value={range[1]} onChange={(e) => setRange([Math.min(range[0], Number(e.target.value)), Number(e.target.value)])} />
                <div className="slider-markers">
                  {customGcodes.map((c) => {
                    const idx = layerIndexOfZ(gcode.layerZ, c.printZ);
                    if (idx < 0) return null;
                    const pct = gcode.layerCount > 1 ? (idx / (gcode.layerCount - 1)) * 100 : 0;
                    return (
                      <button
                        key={c.printZ}
                        className={`marker ${c.type}`}
                        style={{ left: `${pct}%`, background: c.type === 'color_change' ? c.color : undefined }}
                        title={`${CODE_LABEL[c.type]} at Z ${c.printZ.toFixed(2)} mm – click to jump`}
                        onClick={() => setRange([Math.min(range[0], idx), idx])}
                      />
                    );
                  })}
                </div>
              </div>
              <label className="small">Bottom</label>
              <input type="range" min={0} max={gcode.layerCount - 1} value={range[0]} onChange={(e) => setRange([Number(e.target.value), Math.max(range[1], Number(e.target.value))])} />
              <LayerCodes
                printZ={gcode.layerZ[range[1]]}
                firstLayer={range[1] === 0}
                maxZ={gcode.layerZ[gcode.layerCount - 1] ?? 0}
              />
              <label className="checkbox small">
                <input type="checkbox" checked={showTravel} onChange={(e) => setShowTravel(e.target.checked)} /> Show travel moves
              </label>
              <label className="view-mode small">
                <span>View</span>
                <select value={colorMode} onChange={(e) => setColorMode(e.target.value as 'feature' | 'colorprint')}>
                  <option value="feature">Feature type</option>
                  <option value="colorprint">Color print</option>
                </select>
              </label>
              {colorMode === 'colorprint' ? (
                <ul className="legend">
                  {colorPrintSegments(baseColor, customGcodes, gcode.layerZ[gcode.layerCount - 1] ?? 0).map((s, i) => (
                    <li key={i}>
                      <span className="swatch" style={{ background: s.color }} />
                      <span className="name">{i === 0 ? 'Default color' : `Color ${i}`}</span>
                      <span className="muted">
                        {s.fromZ.toFixed(2)} – {s.toZ.toFixed(2)} mm
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="legend">
                  {gcode.featureTypes.map((f) => (
                    <li key={f} className={vis[f] === false ? 'off' : ''} onClick={() => toggle(f)}>
                      <span className="swatch" style={{ background: FEATURE_COLORS[f] || FEATURE_COLORS.Unknown }} />
                      <span className="name">{f}</span>
                      <span className="muted">{((gcode.featureLength[f] || 0) / 1000).toFixed(1)} m</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {!gcode && gcodeLoading && <div className="muted small">Loading preview…</div>}
          {!gcode && !gcodeLoading && job.outputName.endsWith('.gcode') && (
            <button className="secondary" onClick={() => loadGcodePreview(job.id).catch((e) => toast('error', e.message))}>
              Load toolpath preview
            </button>
          )}
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
