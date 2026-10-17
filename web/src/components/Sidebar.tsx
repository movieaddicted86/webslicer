import { useEffect, useRef, useState } from 'react';
import { useStore, isModified, objectBounds, bedShapeOf, VOLUME_LABELS, type PlaterObject, type PlaterVolume } from '../state/store';
import { PresetSelect } from './PresetSelect';
import { PreviewPanel } from './PreviewPanel';
import { objectIsOutside } from '../three/Viewer';
import { toBool } from '../values';
import { createPrimitive, type PrimitiveShape } from '../three/primitives';
import { loadModelFile } from '../three/loaders';
import type { VolumeType } from '../api';

function fmt(n: number, d = 2) {
  return Number.isFinite(n) ? n.toFixed(d).replace(/\.?0+$/, '') : '0';
}
const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;
const AXES = ['X', 'Y', 'Z'] as const;

const VOLUME_ICONS: Record<VolumeType, string> = {
  ModelPart: '◆',
  ParameterModifier: '◧',
  SupportEnforcer: '▲',
  SupportBlocker: '⛔',
  NegativeVolume: '◌',
};

interface TransformLike {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

function TransformInputs({
  t,
  size,
  onChange,
}: {
  t: TransformLike;
  size: [number, number, number];
  onChange: (patch: Partial<TransformLike>) => void;
}) {
  const num = (v: string, fallback: number) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  };
  return (
    <>
      <div className="manip-row head">
        <span />
        {AXES.map((a) => (
          <span key={a} className={`axis ${a}`}>
            {a}
          </span>
        ))}
      </div>
      <div className="manip-row">
        <span>Position</span>
        {AXES.map((a, i) => (
          <input
            key={a}
            type="number"
            step="1"
            value={fmt(t.position[i])}
            onChange={(e) => {
              const p = [...t.position] as [number, number, number];
              p[i] = num(e.target.value, p[i]);
              onChange({ position: p });
            }}
          />
        ))}
      </div>
      <div className="manip-row">
        <span>Rotation °</span>
        {AXES.map((a, i) => (
          <input
            key={a}
            type="number"
            step="15"
            value={fmt(deg(t.rotation[i]), 1)}
            onChange={(e) => {
              const r = [...t.rotation] as [number, number, number];
              r[i] = rad(num(e.target.value, deg(r[i])));
              onChange({ rotation: r });
            }}
          />
        ))}
      </div>
      <div className="manip-row">
        <span>Scale %</span>
        {AXES.map((a, i) => (
          <input
            key={a}
            type="number"
            step="5"
            value={fmt(t.scale[i] * 100, 1)}
            onChange={(e) => {
              const v = num(e.target.value, t.scale[i] * 100) / 100;
              if (v <= 0) return;
              const s = [...t.scale] as [number, number, number];
              s[i] = v;
              onChange({ scale: s });
            }}
          />
        ))}
      </div>
      <div className="manip-row">
        <span>Size mm</span>
        {AXES.map((a, i) => (
          <input
            key={a}
            type="number"
            step="1"
            value={fmt(size[i] * t.scale[i])}
            onChange={(e) => {
              const v = num(e.target.value, size[i] * t.scale[i]);
              if (v <= 0 || size[i] <= 0) return;
              const s = [...t.scale] as [number, number, number];
              s[i] = v / size[i];
              onChange({ scale: s });
            }}
          />
        ))}
      </div>
    </>
  );
}

function ObjectManipulation({ o }: { o: PlaterObject }) {
  const update = useStore((s) => s.updateObject);
  const drop = useStore((s) => s.dropToBed);
  const openDialog = useStore((s) => s.openDialog);
  const extruders = useStore((s) => s.extruderCount());
  const set = (patch: Partial<TransformLike>) => {
    update(o.id, patch);
    drop(o.id);
  };
  const box = objectBounds(o);
  return (
    <div className="manip">
      <TransformInputs
        t={o}
        size={[o.size[0], o.size[1], o.size[2]]}
        onChange={(patch) => {
          // uniform scaling from the scale/size rows keeps proportions like PrusaSlicer's default
          if (patch.scale) {
            const changed = patch.scale.findIndex((v, i) => v !== o.scale[i]);
            const f = changed >= 0 ? patch.scale[changed] : patch.scale[0];
            set({ scale: [f, f, f] });
          } else set(patch);
        }}
      />
      <div className="muted small">
        Bounding box: {fmt(box.max.x - box.min.x)} × {fmt(box.max.y - box.min.y)} × {fmt(box.max.z - box.min.z)} mm
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
        <button className="full" onClick={() => openDialog('objectSettings', { objectId: o.id })}>
          ⚙ Per-object settings{Object.keys(o.config).length ? ` (${Object.keys(o.config).length})` : ''}
        </button>
      </div>
      <div className="muted small">
        {o.triangles.toLocaleString()} triangles · {o.modelId ? 'uploaded' : o.uploadError ? 'upload failed' : 'uploading…'}
      </div>
    </div>
  );
}

function VolumeManipulation({ o, v }: { o: PlaterObject; v: PlaterVolume }) {
  const updateVolume = useStore((s) => s.updateVolume);
  const removeVolume = useStore((s) => s.removeVolume);
  const drop = useStore((s) => s.dropToBed);
  const openDialog = useStore((s) => s.openDialog);
  const extruders = useStore((s) => s.extruderCount());
  const set = (patch: Partial<PlaterVolume>) => {
    updateVolume(o.id, v.id, patch);
    if (v.type === 'ModelPart' || patch.scale) drop(o.id);
  };
  const canHaveSettings = v.type === 'ModelPart' || v.type === 'ParameterModifier';
  return (
    <div className="manip volume">
      <div className="manip-row extruder">
        <span>Type</span>
        <select value={v.type} onChange={(e) => set({ type: e.target.value as VolumeType })}>
          {(Object.keys(VOLUME_LABELS) as VolumeType[]).map((t) => (
            <option key={t} value={t}>
              {VOLUME_LABELS[t]}
            </option>
          ))}
        </select>
      </div>
      <div className="muted small">Position relative to the object origin.</div>
      <TransformInputs t={v} size={v.size} onChange={(patch) => set(patch)} />
      <div className="manip-actions">
        <button onClick={() => set({ rotation: [0, 0, 0] })}>Reset rotation</button>
        <button onClick={() => set({ scale: [1, 1, 1] })}>Reset scale</button>
        <button onClick={() => removeVolume(o.id, v.id)}>Delete volume</button>
      </div>
      <div className="manip-row extruder">
        {extruders > 1 && v.type === 'ModelPart' && (
          <>
            <span>Extruder</span>
            <select value={v.extruder} onChange={(e) => set({ extruder: Number(e.target.value) })}>
              <option value={0}>default</option>
              {Array.from({ length: extruders }, (_, i) => (
                <option key={i} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </>
        )}
        {canHaveSettings && (
          <button className="full" onClick={() => openDialog('objectSettings', { objectId: o.id, volumeId: v.id })}>
            ⚙ {v.type === 'ParameterModifier' ? 'Modifier settings' : 'Part settings'}
            {Object.keys(v.config).length ? ` (${Object.keys(v.config).length})` : ''}
          </button>
        )}
      </div>
      <div className="muted small">
        {v.triangles.toLocaleString()} triangles · {v.modelId ? 'uploaded' : v.uploadError ? 'upload failed' : 'uploading…'}
      </div>
    </div>
  );
}

/** Popover to add a sub-volume to an object */
function AddVolumeMenu({ o, onClose }: { o: PlaterObject; onClose: () => void }) {
  const addVolume = useStore((s) => s.addVolume);
  const toast = useStore((s) => s.toast);
  const bedShape = useStore((s) => s.presets.printer.current.bed_shape || '');
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileType, setFileType] = useState<VolumeType>('ModelPart');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const bed = bedShapeOf({ bed_shape: bedShape });
  const side = Math.max(5, 0.1 * Math.max(bed.max[0] - bed.min[0], bed.max[1] - bed.min[1]));
  const objSize: [number, number, number] = [o.size[0] * o.scale[0], o.size[1] * o.scale[1], o.size[2] * o.scale[2]];

  const addPrimitive = async (type: VolumeType, shape: PrimitiveShape) => {
    const geometry = createPrimitive(shape, side, [o.size[0], o.size[1], o.size[2]]);
    geometry.computeBoundingBox();
    const h = geometry.boundingBox!.max.z - geometry.boundingBox!.min.z;
    // modifiers etc. start at the object centre; slabs and new parts sit on the bed
    const position: [number, number, number] = shape === 'slab' || type === 'ModelPart' ? [0, 0, h / 2] : [0, 0, objSize[2] / 2 / o.scale[2]];
    await addVolume(o.id, { name: `${VOLUME_LABELS[type]} ${shape}`, type, geometry, position });
    onClose();
  };
  const addFromFile = async (file: File) => {
    try {
      const models = await loadModelFile(file);
      for (const m of models) await addVolume(o.id, { name: m.name, type: fileType, geometry: m.geometry });
    } catch (e) {
      toast('error', (e as Error).message);
    }
    onClose();
  };
  const rows: Array<{ type: VolumeType; shapes: PrimitiveShape[] }> = [
    { type: 'ParameterModifier', shapes: ['box', 'cylinder', 'sphere', 'slab'] },
    { type: 'SupportEnforcer', shapes: ['box', 'cylinder', 'sphere', 'slab'] },
    { type: 'SupportBlocker', shapes: ['box', 'cylinder', 'sphere', 'slab'] },
    { type: 'NegativeVolume', shapes: ['box', 'cylinder', 'sphere'] },
    { type: 'ModelPart', shapes: ['box', 'cylinder', 'sphere'] },
  ];
  return (
    <div className="add-volume" ref={ref}>
      <div className="add-volume-title">Add to “{o.name}”</div>
      {rows.map((r) => (
        <div key={r.type} className="add-volume-row">
          <span className={`vtype ${r.type}`}>
            {VOLUME_ICONS[r.type]} {VOLUME_LABELS[r.type]}
          </span>
          <div>
            {r.shapes.map((s) => (
              <button key={s} onClick={() => addPrimitive(r.type, s)}>
                {s}
              </button>
            ))}
            <button
              onClick={() => {
                setFileType(r.type);
                fileRef.current?.click();
              }}
              title="Load a mesh file as this volume"
            >
              file…
            </button>
          </div>
        </div>
      ))}
      <input
        ref={fileRef}
        type="file"
        accept=".stl,.obj,.3mf,.amf"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) addFromFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

export function Sidebar() {
  const view = useStore((s) => s.view);
  const presets = useStore((s) => s.presets);
  const objects = useStore((s) => s.objects);
  const selectedIds = useStore((s) => s.selectedIds);
  const selectedVolumeId = useStore((s) => s.selectedVolumeId);
  const select = useStore((s) => s.select);
  const selectVolume = useStore((s) => s.selectVolume);
  const removeObjects = useStore((s) => s.removeObjects);
  const removeVolume = useStore((s) => s.removeVolume);
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
  const [addMenuFor, setAddMenuFor] = useState<string | null>(null);

  const selected = objects.filter((o) => selectedIds.includes(o.id));
  const selectedVolume = selected.length === 1 ? selected[0].volumes.find((v) => v.id === selectedVolumeId) : undefined;
  const anyOutside = objects.some((o) => objectIsOutside(o, bedShape, maxHeight));
  const running = job && (job.status === 'running' || job.status === 'queued');
  const anyModified = isModified(presets.print) || isModified(presets.printer) || presets.filament.some(isModified);

  const deleteSelection = () => {
    if (selectedVolume && selected.length === 1) removeVolume(selected[0].id, selectedVolume.id);
    else removeObjects(selectedIds);
  };

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
                <button title="Delete selected object or volume (Del)" onClick={deleteSelection} disabled={!selected.length}>
                  🗑
                </button>
                <button title="Delete all" onClick={() => objects.length && confirm('Remove all objects?') && clear()} disabled={!objects.length}>
                  ✕
                </button>
              </div>
            </div>
            <ul className="object-list">
              {objects.map((o) => {
                const isSel = selectedIds.includes(o.id);
                return (
                  <li key={o.id} className="object-item">
                    <div
                      className={`object-row ${isSel && !selectedVolumeId ? 'selected' : ''} ${objectIsOutside(o, bedShape, maxHeight) ? 'outside' : ''}`}
                      onClick={(e) => select([o.id], e.ctrlKey || e.shiftKey)}
                    >
                      <input
                        type="checkbox"
                        checked={o.visible}
                        onChange={(e) => update(o.id, { visible: e.target.checked })}
                        onClick={(e) => e.stopPropagation()}
                        title="Visible / printable"
                      />
                      <span className="name" title={o.name}>
                        {o.name}
                      </span>
                      {o.extruder > 0 && <span className="badge">E{o.extruder}</span>}
                      {Object.keys(o.config).length > 0 && <span className="badge">⚙</span>}
                      <button
                        className="icon add"
                        title="Add modifier / support enforcer / blocker / part"
                        onClick={(e) => {
                          e.stopPropagation();
                          setAddMenuFor(addMenuFor === o.id ? null : o.id);
                        }}
                      >
                        ＋
                      </button>
                    </div>
                    {addMenuFor === o.id && <AddVolumeMenu o={o} onClose={() => setAddMenuFor(null)} />}
                    {o.volumes.length > 0 && (
                      <ul className="volume-list">
                        {o.volumes.map((v) => (
                          <li
                            key={v.id}
                            className={`volume-row ${isSel && selectedVolumeId === v.id ? 'selected' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              selectVolume(o.id, v.id);
                            }}
                            title={`${VOLUME_LABELS[v.type]}: ${v.name}`}
                          >
                            <span className={`vtype ${v.type}`}>{VOLUME_ICONS[v.type]}</span>
                            <span className="name">{v.name}</span>
                            <span className="muted small">{VOLUME_LABELS[v.type]}</span>
                            {Object.keys(v.config).length > 0 && <span className="badge">⚙</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
              {!objects.length && <li className="empty">Drop STL / OBJ / 3MF / AMF files onto the 3D view or use Import.</li>}
            </ul>
            {selected.length === 1 && selectedVolume && <VolumeManipulation o={selected[0]} v={selectedVolume} />}
            {selected.length === 1 && !selectedVolume && <ObjectManipulation o={selected[0]} />}
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
