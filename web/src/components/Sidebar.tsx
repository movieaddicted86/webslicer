import { useStore, isModified, objectBounds, type PlaterObject } from '../state/store';
import { PresetSelect } from './PresetSelect';
import { PreviewPanel } from './PreviewPanel';
import { objectIsOutside } from '../three/Viewer';
import { toBool } from '../values';

function fmt(n: number, d = 2) {
  return Number.isFinite(n) ? n.toFixed(d).replace(/\.?0+$/, '') : '0';
}
const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

function ObjectManipulation({ o }: { o: PlaterObject }) {
  const update = useStore((s) => s.updateObject);
  const drop = useStore((s) => s.dropToBed);
  const openDialog = useStore((s) => s.openDialog);
  const extruders = useStore((s) => s.extruderCount());
  const box = objectBounds(o);
  const size = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
  const set = (patch: Partial<PlaterObject>) => {
    update(o.id, patch);
    drop(o.id);
  };
  const num = (v: string, fallback: number) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const axes = ['X', 'Y', 'Z'] as const;
  return (
    <div className="manip">
      <div className="manip-row head">
        <span />
        {axes.map((a) => (
          <span key={a} className={`axis ${a}`}>
            {a}
          </span>
        ))}
      </div>
      <div className="manip-row">
        <span>Position</span>
        {axes.map((a, i) => (
          <input
            key={a}
            type="number"
            step="1"
            value={fmt(o.position[i])}
            onChange={(e) => {
              const p = [...o.position] as [number, number, number];
              p[i] = num(e.target.value, p[i]);
              set({ position: p });
            }}
          />
        ))}
      </div>
      <div className="manip-row">
        <span>Rotation °</span>
        {axes.map((a, i) => (
          <input
            key={a}
            type="number"
            step="15"
            value={fmt(deg(o.rotation[i]), 1)}
            onChange={(e) => {
              const r = [...o.rotation] as [number, number, number];
              r[i] = rad(num(e.target.value, deg(r[i])));
              set({ rotation: r });
            }}
          />
        ))}
      </div>
      <div className="manip-row">
        <span>Scale %</span>
        {axes.map((a, i) => (
          <input
            key={a}
            type="number"
            step="5"
            value={fmt(o.scale[i] * 100, 1)}
            onChange={(e) => {
              const v = num(e.target.value, o.scale[i] * 100) / 100;
              if (v <= 0) return;
              set({ scale: [v, v, v] });
            }}
          />
        ))}
      </div>
      <div className="manip-row">
        <span>Size mm</span>
        {axes.map((a, i) => (
          <input
            key={a}
            type="number"
            step="1"
            value={fmt(size[i])}
            onChange={(e) => {
              const v = num(e.target.value, size[i]);
              if (v <= 0 || size[i] <= 0) return;
              const f = v / size[i];
              set({ scale: [o.scale[0] * f, o.scale[1] * f, o.scale[2] * f] });
            }}
          />
        ))}
      </div>
      <div className="manip-actions">
        <button onClick={() => set({ rotation: [0, 0, 0] })}>Reset rotation</button>
        <button onClick={() => set({ scale: [1, 1, 1] })}>Reset scale</button>
        <button onClick={() => set({ rotation: [0, 0, 0], scale: [1, 1, 1] })}>Reset all</button>
      </div>
      <div className="manip-row extruder">
        {extruders > 1 && (
          <>
            <span>Extruder</span>
            <select value={o.extruder} onChange={(e) => update(o.id, { extruder: Number(e.target.value) })}>
              <option value={0}>default</option>
              {Array.from({ length: extruders }, (_, i) => (
                <option key={i} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </>
        )}
        <button className="full" onClick={() => openDialog('objectSettings', o.id)}>
          ⚙ Per-object settings{Object.keys(o.config).length ? ` (${Object.keys(o.config).length})` : ''}
        </button>
      </div>
      <div className="muted small">
        {o.triangles.toLocaleString()} triangles · {o.modelId ? 'uploaded' : o.uploadError ? 'upload failed' : 'uploading…'}
      </div>
    </div>
  );
}

export function Sidebar() {
  const view = useStore((s) => s.view);
  const presets = useStore((s) => s.presets);
  const objects = useStore((s) => s.objects);
  const selectedIds = useStore((s) => s.selectedIds);
  const select = useStore((s) => s.select);
  const removeObjects = useStore((s) => s.removeObjects);
  const duplicate = useStore((s) => s.duplicateObjects);
  const arrange = useStore((s) => s.arrange);
  const clear = useStore((s) => s.clearObjects);
  const update = useStore((s) => s.updateObject);
  const transformMode = useStore((s) => s.transformMode);
  const setTransformMode = useStore((s) => s.setTransformMode);
  const slice = useStore((s) => s.slice);
  const cancelSlice = useStore((s) => s.cancelSlice);
  const job = useStore((s) => s.job);
  const sliceDirty = useStore((s) => s.sliceDirty);
  const showIncompatible = useStore((s) => s.showIncompatible);
  const bedShape = useStore((s) => s.presets.printer.current.bed_shape || '');
  const maxHeight = useStore((s) => Number(s.presets.printer.current.max_print_height || 200));
  const extruders = useStore((s) => s.extruderCount());
  const setView = useStore((s) => s.setView);
  const printerBinary = useStore((s) => s.presets.printer.current.binary_gcode);
  const binaryGcode = useStore((s) => s.binaryGcode);

  const selected = objects.filter((o) => selectedIds.includes(o.id));
  const anyOutside = objects.some((o) => objectIsOutside(o, bedShape, maxHeight));
  const running = job && (job.status === 'running' || job.status === 'queued');
  const anyModified = isModified(presets.print) || isModified(presets.printer) || presets.filament.some(isModified);

  return (
    <aside className="sidebar">
      <section className="presets">
        <PresetSelect type="print" slot={presets.print} label="Print settings" />
        {presets.filament.slice(0, extruders).map((f, i) => (
          <PresetSelect key={i} type="filament" slot={f} extruderIdx={i} label={extruders > 1 ? `Filament (extruder ${i + 1})` : 'Filament'} />
        ))}
        <PresetSelect type="printer" slot={presets.printer} label="Printer" />
        <label className="checkbox small">
          <input type="checkbox" checked={showIncompatible} onChange={(e) => useStore.setState({ showIncompatible: e.target.checked })} /> Show
          incompatible presets
        </label>
      </section>

      {view === 'preview' ? (
        <PreviewPanel />
      ) : (
        <>
          <section className="objects">
            <div className="section-head">
              <span>Objects ({objects.length})</span>
              <div className="tools">
                <button className={transformMode === 'translate' ? 'active' : ''} title="Move (M)" onClick={() => setTransformMode('translate')}>
                  ✥
                </button>
                <button className={transformMode === 'rotate' ? 'active' : ''} title="Rotate (R)" onClick={() => setTransformMode('rotate')}>
                  ⟳
                </button>
                <button className={transformMode === 'scale' ? 'active' : ''} title="Scale (S)" onClick={() => setTransformMode('scale')}>
                  ⤢
                </button>
                <button title="Arrange (A)" onClick={arrange} disabled={!objects.length}>
                  ▦
                </button>
                <button title="Duplicate" onClick={() => duplicate(selectedIds)} disabled={!selected.length}>
                  ⧉
                </button>
                <button title="Delete (Del)" onClick={() => removeObjects(selectedIds)} disabled={!selected.length}>
                  🗑
                </button>
                <button title="Delete all" onClick={() => objects.length && confirm('Remove all objects?') && clear()} disabled={!objects.length}>
                  ✕
                </button>
              </div>
            </div>
            <ul className="object-list">
              {objects.map((o) => (
                <li
                  key={o.id}
                  className={`${selectedIds.includes(o.id) ? 'selected' : ''} ${objectIsOutside(o, bedShape, maxHeight) ? 'outside' : ''}`}
                  onClick={(e) => select([o.id], e.ctrlKey || e.shiftKey)}
                >
                  <input type="checkbox" checked={o.visible} onChange={(e) => update(o.id, { visible: e.target.checked })} onClick={(e) => e.stopPropagation()} title="Visible / printable" />
                  <span className="name" title={o.name}>
                    {o.name}
                  </span>
                  {o.extruder > 0 && <span className="badge">E{o.extruder}</span>}
                  {Object.keys(o.config).length > 0 && <span className="badge">⚙</span>}
                </li>
              ))}
              {!objects.length && <li className="empty">Drop STL / OBJ / 3MF / AMF files onto the 3D view or use Import.</li>}
            </ul>
            {selected.length === 1 && <ObjectManipulation o={selected[0]} />}
            {selected.length > 1 && <div className="muted small">{selected.length} objects selected</div>}
          </section>

          <section className="slice-panel">
            {anyOutside && <div className="warn">An object is outside the print volume.</div>}
            {anyModified && <div className="muted small">Using modified (unsaved) settings.</div>}
            {toBool(printerBinary) && (
              <label className="checkbox small" title="Binary G-code is smaller and uploads faster, but cannot be previewed in the browser.">
                <input type="checkbox" checked={binaryGcode} onChange={(e) => useStore.setState({ binaryGcode: e.target.checked, sliceDirty: true })} /> Export binary G-code
                (.bgcode) – no preview
              </label>
            )}
            {running ? (
              <>
                <div className="progress">
                  <div className="bar" style={{ width: `${job!.percent}%` }} />
                  <span>
                    {job!.percent}% · {job!.message}
                  </span>
                </div>
                <button className="secondary" onClick={cancelSlice}>
                  Cancel
                </button>
              </>
            ) : (
              <button className="primary big" onClick={slice} disabled={!objects.length}>
                {sliceDirty || !job ? 'Slice now' : job.status === 'done' ? 'Slice again' : 'Slice now'}
              </button>
            )}
            {job && job.status === 'done' && !running && (
              <button className="secondary" onClick={() => setView('preview')}>
                Show preview / export
              </button>
            )}
            {job && job.status === 'error' && <div className="error small">{job.error}</div>}
          </section>
        </>
      )}
    </aside>
  );
}
