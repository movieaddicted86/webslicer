import { useEffect, useRef, useState } from 'react';
import { useStore, isModified, bedShapeOf, instanceBounds, selectedInstance, pickedInstanceId, VOLUME_LABELS, type PlaterObject, type PlaterVolume } from '../state/store';
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

const EXTRUDER_CSS = ['#e6b84a', '#73c2fb', '#d96fd9', '#84d08a', '#f09b59', '#a9a9f5'];

/** Height range modifiers of the selected object (variable layer height and per-range settings) */
function RangePanel({ o }: { o: PlaterObject }) {
  const addRange = useStore((s) => s.addRange);
  const updateRange = useStore((s) => s.updateRange);
  const removeRange = useStore((s) => s.removeRange);
  const openDialog = useStore((s) => s.openDialog);
  const num = (v: string, fallback: number) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  };
  return (
    <div className="range-panel">
      <div className="section-head">
        <span>Height ranges</span>
        <button onClick={() => addRange(o.id)} title="Add a height range with its own layer height / settings">
          ＋ Range
        </button>
      </div>
      {o.ranges.length > 0 && (
        <div className="range-rows">
          <div className="range-row head">
            <span>From</span>
            <span>To</span>
            <span>Layer h.</span>
            <span />
            <span />
          </div>
          {o.ranges.map((r) => (
            <div key={r.id} className={`range-row ${r.maxZ > r.minZ ? '' : 'invalid'}`}>
              <input type="number" step="0.5" value={r.minZ} onChange={(e) => updateRange(o.id, r.id, { minZ: num(e.target.value, r.minZ) })} />
              <input type="number" step="0.5" value={r.maxZ} onChange={(e) => updateRange(o.id, r.id, { maxZ: num(e.target.value, r.maxZ) })} />
              <input
                type="number"
                step="0.05"
                value={r.config.layer_height ?? ''}
                placeholder="–"
                onChange={(e) => {
                  const c = { ...r.config };
                  if (e.target.value === '') delete c.layer_height;
                  else c.layer_height = e.target.value;
                  updateRange(o.id, r.id, { config: c });
                }}
              />
              <button className="icon" title="Settings for this range" onClick={() => openDialog('objectSettings', { objectId: o.id, rangeId: r.id })}>
                ⚙{Object.keys(r.config).filter((k) => k !== 'layer_height').length ? '•' : ''}
              </button>
              <button className="icon" title="Remove range" onClick={() => removeRange(o.id, r.id)}>
                ✕
              </button>
            </div>
          ))}
          <div className="muted small">Z in mm from the object bottom. Ranges may not overlap.</div>
        </div>
      )}
    </div>
  );
}

/** Support / seam painting controls for the selected object */
function PaintPanel({ o }: { o: PlaterObject }) {
  const paintMode = useStore((s) => s.paintMode);
  const paintTool = useStore((s) => s.paintTool);
  const brushRadius = useStore((s) => s.brushRadius);
  const startPaint = useStore((s) => s.startPaint);
  const stopPaint = useStore((s) => s.stopPaint);
  const setPaintTool = useStore((s) => s.setPaintTool);
  const setBrushRadius = useStore((s) => s.setBrushRadius);
  const clearPaint = useStore((s) => s.clearPaint);
  const extruders = useStore((s) => s.extruderCount());
  const paintExtruder = useStore((s) => s.paintExtruder);
  const setPaintExtruder = useStore((s) => s.setPaintExtruder);
  const count = (arr?: Uint8Array) => (arr ? arr.reduce((a, v) => a + (v ? 1 : 0), 0) : 0);
  const nSup = count(o.paint?.supports);
  const nSeam = count(o.paint?.seam);
  const nMmu = count(o.paint?.mmu);
  if (!paintMode) {
    return (
      <div className="paint-panel">
        <div className="manip-actions">
          <button onClick={() => startPaint(o.id, 'supports')} title="Paint support enforcers / blockers (L)">
            🖌 Supports{nSup ? ` (${nSup})` : ''}
          </button>
          <button onClick={() => startPaint(o.id, 'seam')} title="Paint seam enforcers / blockers (P)">
            🖌 Seam{nSeam ? ` (${nSeam})` : ''}
          </button>
          {extruders > 1 && (
            <button onClick={() => startPaint(o.id, 'mmu')} title="Paint extruder per triangle (multi-material)">
              🖌 Extruder{nMmu ? ` (${nMmu})` : ''}
            </button>
          )}
        </div>
      </div>
    );
  }
  const title = paintMode === 'supports' ? 'Paint supports' : paintMode === 'seam' ? 'Paint seam' : 'Paint extruder';
  return (
    <div className="paint-panel active">
      <div className="section-head">
        <span>{title}</span>
        <button className="primary" onClick={stopPaint}>
          Done
        </button>
      </div>
      {paintMode === 'mmu' ? (
        <div className="paint-tools">
          {Array.from({ length: extruders }, (_, i) => i + 1).map((n) => (
            <label key={n} className={`tool extruder ${paintExtruder === n ? 'active' : ''}`} style={{ borderColor: paintExtruder === n ? EXTRUDER_CSS[(n - 1) % EXTRUDER_CSS.length] : undefined }}>
              <input type="radio" checked={paintExtruder === n} onChange={() => setPaintExtruder(n)} />
              <span className="swatch" style={{ background: EXTRUDER_CSS[(n - 1) % EXTRUDER_CSS.length] }} /> {n}
            </label>
          ))}
        </div>
      ) : (
      <div className="paint-tools">
        <label className={`tool enforcer ${paintTool === 'enforcer' ? 'active' : ''}`} title="Left mouse button">
          <input type="radio" checked={paintTool === 'enforcer'} onChange={() => setPaintTool('enforcer')} /> Enforcer
        </label>
        <label className={`tool blocker ${paintTool === 'blocker' ? 'active' : ''}`} title="Left mouse button (or right button any time)">
          <input type="radio" checked={paintTool === 'blocker'} onChange={() => setPaintTool('blocker')} /> Blocker
        </label>
        <label className={`tool erase ${paintTool === 'erase' ? 'active' : ''}`} title="Left mouse button (or Shift+left any time)">
          <input type="radio" checked={paintTool === 'erase'} onChange={() => setPaintTool('erase')} /> Erase
        </label>
      </div>
      )}
      <label className="brush">
        <span>Brush {brushRadius.toFixed(1)} mm</span>
        <input type="range" min={0.5} max={25} step={0.5} value={brushRadius} onChange={(e) => setBrushRadius(Number(e.target.value))} />
      </label>
      <div className="manip-actions">
        <button onClick={() => clearPaint(o.id, paintMode)} disabled={!(paintMode === 'supports' ? nSup : paintMode === 'seam' ? nSeam : nMmu)}>
          Clear all
        </button>
      </div>
      <div className="muted small">
        {paintMode === 'supports'
          ? 'Enforcers force supports, blockers prevent them. Set Supports to "For support enforcers only" or "Everywhere".'
          : paintMode === 'seam'
            ? 'Enforcers attract the seam, blockers repel it.'
            : 'Painted triangles are printed with the selected extruder; unpainted ones use the object extruder.'}
      </div>
    </div>
  );
}

function ObjectManipulation({ o }: { o: PlaterObject }) {
  const updateInstance = useStore((s) => s.updateInstance);
  const drop = useStore((s) => s.dropToBed);
  const openDialog = useStore((s) => s.openDialog);
  const extruders = useStore((s) => s.extruderCount());
  const recordHistory = useStore((s) => s.recordHistory);
  const setInstanceCount = useStore((s) => s.setInstanceCount);
  const fillBedWithInstances = useStore((s) => s.fillBedWithInstances);
  // the instance count field keeps the typed text while it is edited, so a half-typed "1" of "12"
  // does not immediately shrink the plater
  const [countText, setCountText] = useState(() => String(o.instances.length));
  const [editingCount, setEditingCount] = useState(false);
  // the manipulation fields edit the selected instance (instance 1 when none is selected)
  const selectedIds = useStore((s) => s.selectedIds);
  const selectedInstanceId = useStore((s) => s.selectedInstanceId);
  const inst = selectedInstance({ selectedIds, selectedInstanceId }, o);
  const update = (id: string, patch: Partial<Omit<PlaterObject, 'instances'>>) => {
    recordHistory();
    useStore.getState().updateObject(id, patch);
  };
  const set = (patch: Partial<TransformLike>) => {
    recordHistory();
    updateInstance(o.id, inst.id, patch);
    drop(o.id);
  };
  const box = instanceBounds(o, inst);
  return (
    <div className="manip">
      <TransformInputs
        t={inst}
        size={[o.size[0], o.size[1], o.size[2]]}
        onChange={(patch) => {
          // uniform scaling from the scale/size rows keeps proportions like PrusaSlicer's default
          if (patch.scale) {
            const changed = patch.scale.findIndex((v, i) => v !== inst.scale[i]);
            const f = changed >= 0 ? patch.scale[changed] : patch.scale[0];
            set({ scale: [f, f, f] });
          } else set(patch);
        }}
      />
      <div className="manip-row instances">
        <span>Instances</span>
        <input
          type="number"
          min={1}
          max={1000}
          step={1}
          value={editingCount ? countText : String(o.instances.length)}
          onChange={(e) => {
            setCountText(e.target.value);
            const n = Number(e.target.value);
            // AC-2.1: out-of-range or non-integer input is rejected without touching the plater
            if (Number.isInteger(n) && n >= 1 && n <= 1000) setInstanceCount(o.id, n);
          }}
          onFocus={() => {
            setCountText(String(o.instances.length));
            setEditingCount(true);
          }}
          onBlur={() => setEditingCount(false)}
        />
        <button title="Add as many instances as fit on the bed" onClick={() => fillBedWithInstances(o.id)}>
          Fill bed
        </button>
      </div>
      <div className="muted small">
        Bounding box: {fmt(box.max.x - box.min.x)} × {fmt(box.max.y - box.min.y)} × {fmt(box.max.z - box.min.z)} mm
      </div>
      <div className="manip-actions">
        <button onClick={() => set({ rotation: [0, 0, 0] })}>Reset rotation</button>
        <button onClick={() => set({ scale: [1, 1, 1] })}>Reset scale</button>
        <button onClick={() => set({ rotation: [0, 0, 0], scale: [1, 1, 1] })}>Reset all</button>
      </div>
      <PaintPanel o={o} />
      <RangePanel o={o} />
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
  const recordHistory = useStore((s) => s.recordHistory);
  const set = (patch: Partial<PlaterVolume>) => {
    recordHistory();
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
  const selectedIds = useStore((s) => s.selectedIds);
  const selectedInstanceId = useStore((s) => s.selectedInstanceId);
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
  const objScale = selectedInstance({ selectedIds, selectedInstanceId }, o).scale;
  const objSize: [number, number, number] = [o.size[0] * objScale[0], o.size[1] * objScale[1], o.size[2] * objScale[2]];

  const addPrimitive = async (type: VolumeType, shape: PrimitiveShape) => {
    const geometry = createPrimitive(shape, side, [o.size[0], o.size[1], o.size[2]]);
    geometry.computeBoundingBox();
    const h = geometry.boundingBox!.max.z - geometry.boundingBox!.min.z;
    // modifiers etc. start at the object centre; slabs and new parts sit on the bed
    const position: [number, number, number] = shape === 'slab' || type === 'ModelPart' ? [0, 0, h / 2] : [0, 0, objSize[2] / 2 / objScale[2]];
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

/**
 * PrusaSlicer-style quick settings on the plater: supports, infill density, brim.
 * They edit the current print preset (marking it modified) like in PrusaSlicer.
 */
function QuickSettings() {
  const print = useStore((s) => s.presets.print);
  const setOption = useStore((s) => s.setOption);
  const setView = useStore((s) => s.setView);
  const tech = useStore((s) => s.presets.printer.current.printer_technology);
  if (tech === 'SLA') return null;
  const c = print.current;
  const supports = !toBool(c.support_material)
    ? 'none'
    : !toBool(c.support_material_auto)
      ? 'enforcers'
      : toBool(c.support_material_buildplate_only)
        ? 'buildplate'
        : 'everywhere';
  const setSupports = (v: string) => {
    if (v === 'none') setOption('print', 'support_material', '0');
    else {
      setOption('print', 'support_material', '1');
      setOption('print', 'support_material_auto', v === 'enforcers' ? '0' : '1');
      setOption('print', 'support_material_buildplate_only', v === 'buildplate' ? '1' : '0');
    }
  };
  const density = c.fill_density || '20%';
  const densities = ['0%', '5%', '10%', '15%', '20%', '25%', '30%', '40%', '50%', '60%', '70%', '80%', '90%', '100%'];
  const brim = (c.brim_type || 'outer_only') !== 'no_brim' && Number(c.brim_width) > 0;
  return (
    <div className="quick-settings">
      <label className="span">
        <span>Supports</span>
        <select value={supports} onChange={(e) => setSupports(e.target.value)}>
          <option value="none">None</option>
          <option value="buildplate">Support on build plate only</option>
          <option value="enforcers">For support enforcers only</option>
          <option value="everywhere">Everywhere</option>
        </select>
      </label>
      <label>
        <span>Infill</span>
        <select value={density} onChange={(e) => setOption('print', 'fill_density', e.target.value)}>
          {!densities.includes(density) && <option value={density}>{density}</option>}
          {densities.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select value={c.fill_pattern || 'grid'} onChange={(e) => setOption('print', 'fill_pattern', e.target.value)} title="Infill pattern">
          {(useStore.getState().schema?.options.fill_pattern?.enumValues || ['grid']).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={brim}
          onChange={(e) => {
            setOption('print', 'brim_type', e.target.checked ? 'outer_only' : 'no_brim');
            if (e.target.checked && !(Number(c.brim_width) > 0)) setOption('print', 'brim_width', '5');
          }}
        />
        Brim
        {brim && <span className="muted small"> ({c.brim_width} mm)</span>}
      </label>
      <button className="link" onClick={() => setView('print')}>
        All print settings…
      </button>
    </div>
  );
}

export function Sidebar() {
  const view = useStore((s) => s.view);
  const presets = useStore((s) => s.presets);
  const objects = useStore((s) => s.objects);
  const selectedIds = useStore((s) => s.selectedIds);
  const selectedVolumeId = useStore((s) => s.selectedVolumeId);
  const selectedInstanceId = useStore((s) => s.selectedInstanceId);
  const select = useStore((s) => s.select);
  const selectVolume = useStore((s) => s.selectVolume);
  const removeObjects = useStore((s) => s.removeObjects);
  const removeVolume = useStore((s) => s.removeVolume);
  const addInstances = useStore((s) => s.addInstances);
  const removeInstance = useStore((s) => s.removeInstance);
  const selectInstance = useStore((s) => s.selectInstance);
  const instanceToObject = useStore((s) => s.instanceToObject);
  const duplicate = useStore((s) => s.duplicateObjects);
  const arrange = useStore((s) => s.arrange);
  const clear = useStore((s) => s.clearObjects);
  const update = useStore((s) => s.updateObject);
  const transformMode = useStore((s) => s.transformMode);
  const setTransformMode = useStore((s) => s.setTransformMode);
  const placeOnFace = useStore((s) => s.placeOnFace);
  const setPlaceOnFace = useStore((s) => s.setPlaceOnFace);
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
  // Like PrusaSlicer: the object list (and with it modifiers, painting, height ranges) is an Advanced/Expert feature.
  const mode = useStore((s) => s.mode);
  const simple = mode === 'simple';
  const binaryGcode = useStore((s) => s.binaryGcode);
  const [addMenuFor, setAddMenuFor] = useState<string | null>(null);
  // which objects show their instance sub-list (like the volume list, collapsed by default)
  const [instancesOpen, setInstancesOpen] = useState<Record<string, boolean>>({});
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.undoStack.length > 0);
  const canRedo = useStore((s) => s.redoStack.length > 0);
  const recordHistory = useStore((s) => s.recordHistory);
  const autosaveInfo = useStore((s) => s.autosaveInfo);
  const autosaveState = useStore((s) => s.autosaveState);
  const restoreAutosave = useStore((s) => s.restoreAutosave);
  const discardAutosave = useStore((s) => s.discardAutosave);
  const openDialog = useStore((s) => s.openDialog);

  const selected = objects.filter((o) => selectedIds.includes(o.id));
  const selectedVolume = selected.length === 1 ? selected[0].volumes.find((v) => v.id === selectedVolumeId) : undefined;
  const anyOutside = objects.some((o) => objectIsOutside(o, bedShape, maxHeight));
  const running = job && (job.status === 'running' || job.status === 'queued');
  const anyModified = isModified(presets.print) || isModified(presets.printer) || presets.filament.some(isModified);

  // an instance counts as picked only when clicking it in the view or its row selected it explicitly
  const pickedInstance = selected.length === 1 ? pickedInstanceId({ selectedIds, selectedInstanceId }, selected[0]) : undefined;

  const deleteSelection = () => {
    if (selectedVolume && selected.length === 1) removeVolume(selected[0].id, selectedVolume.id);
    // AC-4.4: Del removes the instance that was picked; without one the whole object goes
    else if (selected.length === 1 && pickedInstance && selected[0].instances.length > 1) removeInstance(selected[0].id, pickedInstance);
    else removeObjects(selectedIds);
  };

  const addInstance = () => {
    if (selected.length === 1) addInstances(selected[0].id);
  };
  const removeOneInstance = () => {
    // AC-1.2: "−" always drops the last copy, whatever is selected
    if (selected.length === 1) removeInstance(selected[0].id);
  };
  const instanceCount = selected.length === 1 ? selected[0].instances.length : 0;

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
      {view !== 'preview' && (
        <section className="quick">
          <QuickSettings />
        </section>
      )}

      {view === 'preview' ? (
        <PreviewPanel />
      ) : (
        <>
          {!simple && (
          <section className="objects">
            <div className="section-head">
              <span>Objects ({objects.length})</span>
              <div className="tools">
                <button title="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo}>
                  ↶
                </button>
                <button title="Redo (Ctrl+Y)" onClick={redo} disabled={!canRedo}>
                  ↷
                </button>
                <button className={transformMode === 'translate' ? 'active' : ''} title="Move (M)" onClick={() => setTransformMode('translate')}>
                  ✥
                </button>
                <button className={transformMode === 'rotate' ? 'active' : ''} title="Rotate (R)" onClick={() => setTransformMode('rotate')}>
                  ⟳
                </button>
                <button className={transformMode === 'scale' ? 'active' : ''} title="Scale (S)" onClick={() => setTransformMode('scale')}>
                  ⤢
                </button>
                <button
                  className={placeOnFace ? 'active' : ''}
                  title="Place on face (F): click a face in the 3D view to lay it flat on the bed"
                  onClick={() => setPlaceOnFace(!placeOnFace)}
                  disabled={!objects.length}
                >
                  ▱
                </button>
                <button title="Arrange (A)" onClick={arrange} disabled={!objects.length}>
                  ▦
                </button>
                <button title="Add instance (+)" onClick={addInstance} disabled={selected.length !== 1}>
                  +
                </button>
                <button title="Remove the last instance (−)" onClick={removeOneInstance} disabled={selected.length !== 1 || instanceCount <= 1}>
                  −
                </button>
                <button title="Duplicate" onClick={() => duplicate(selectedIds)} disabled={!selected.length}>
                  ⧉
                </button>
                <button title="Delete the picked instance, otherwise the selected object or volume (Del)" onClick={deleteSelection} disabled={!selected.length}>
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
                        onChange={(e) => {
                          recordHistory();
                          update(o.id, { visible: e.target.checked });
                        }}
                        onClick={(e) => e.stopPropagation()}
                        title="Visible / printable"
                      />
                      <span className="name" title={o.name}>
                        {o.name}
                      </span>
                      {o.extruder > 0 && <span className="badge">E{o.extruder}</span>}
                      {Object.keys(o.config).length > 0 && <span className="badge">⚙</span>}
                      {o.instances.length > 1 && (
                        <button
                          className="badge inst"
                          title={`${o.instances.length} instances – click to show them`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setInstancesOpen((m) => ({ ...m, [o.id]: !m[o.id] }));
                          }}
                        >
                          ×{o.instances.length}
                        </button>
                      )}
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
                    {o.instances.length > 1 && instancesOpen[o.id] && (
                      <ul className="instance-list">
                        {o.instances.map((inst, i) => (
                          <li
                            key={inst.id}
                            className={`instance-row ${isSel && selectedInstanceId === inst.id ? 'selected' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              selectInstance(o.id, inst.id);
                            }}
                            title={`Instance ${i + 1} of ${o.instances.length}`}
                          >
                            <span className="iname">Instance {i + 1}</span>
                            <span className="muted small">
                              {inst.position.map((v) => fmt(v)).join(' / ')}
                            </span>
                            <button
                              className="icon"
                              title="Set as separate object"
                              onClick={(e) => {
                                e.stopPropagation();
                                instanceToObject(o.id, inst.id);
                              }}
                            >
                              ⧉
                            </button>
                            <button
                              className="icon"
                              title="Delete instance"
                              disabled={o.instances.length <= 1}
                              onClick={(e) => {
                                e.stopPropagation();
                                removeInstance(o.id, inst.id);
                              }}
                            >
                              🗑
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
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
              {!objects.length && autosaveInfo && (
                <li className="empty restore">
                  <div>
                    Unsaved session from {new Date(autosaveInfo.savedAt).toLocaleString()} found.
                  </div>
                  <div className="manip-actions">
                    <button className="primary" onClick={restoreAutosave}>
                      Restore
                    </button>
                    <button onClick={discardAutosave}>Discard</button>
                  </div>
                </li>
              )}
              {!objects.length && !autosaveInfo && (
                <li className="empty">
                  Drop STL / OBJ / 3MF / AMF files onto the 3D view, use Import or{' '}
                  <a href="#" onClick={(e) => { e.preventDefault(); openDialog('library', 'open'); }}>
                    open the library
                  </a>
                  .
                </li>
              )}
            </ul>
            {selected.length === 1 && selectedVolume && <VolumeManipulation o={selected[0]} v={selectedVolume} />}
            {selected.length === 1 && !selectedVolume && <ObjectManipulation o={selected[0]} />}
            {selected.length > 1 && <div className="muted small">{selected.length} objects selected</div>}
          </section>
          )}
          {simple && (
            <section className="objects simple">
              <div className="section-head">
                <span>Objects ({objects.length})</span>
                <div className="tools">
                  <button title="Arrange (A)" onClick={arrange} disabled={!objects.length}>
                    ▦
                  </button>
                  <button title="Add instance (+)" onClick={addInstance} disabled={selected.length !== 1}>
                    +
                  </button>
                  <button title="Remove the last instance (−)" onClick={removeOneInstance} disabled={selected.length !== 1 || instanceCount <= 1}>
                    −
                  </button>
                  <button title="Delete the picked instance, otherwise the selected object (Del)" onClick={deleteSelection} disabled={!selected.length}>
                    🗑
                  </button>
                  <button title="Delete all" onClick={() => objects.length && confirm('Remove all objects?') && clear()} disabled={!objects.length}>
                    ✕
                  </button>
                </div>
              </div>
              {!objects.length && autosaveInfo && (
                <div className="restore">
                  <div>Unsaved session from {new Date(autosaveInfo.savedAt).toLocaleString()} found.</div>
                  <div className="manip-actions">
                    <button className="primary" onClick={restoreAutosave}>
                      Restore
                    </button>
                    <button onClick={discardAutosave}>Discard</button>
                  </div>
                </div>
              )}
              {!objects.length && !autosaveInfo && (
                <div className="muted small">
                  Drop STL / OBJ / 3MF / AMF files onto the 3D view, use Import or{' '}
                  <a href="#" onClick={(e) => { e.preventDefault(); openDialog('library', 'open'); }}>
                    open the library
                  </a>
                  .
                </div>
              )}
              <div className="muted small">
                Simple mode: move objects with the gizmo in the 3D view. Switch to <b>Advanced</b> or <b>Expert</b> (top right) for the object list,
                per-object settings, modifiers, painting and height ranges.
              </div>
            </section>
          )}

          <section className="slice-panel">
            {anyOutside && <div className="warn">An object is outside the print volume.</div>}
            {anyModified && <div className="muted small">Using modified (unsaved) settings.</div>}
            {objects.length > 0 && autosaveState !== 'idle' && (
              <div className="muted small" title="The plater is autosaved on the server and offered for restore after a reload.">
                {autosaveState === 'saving' ? 'Autosaving…' : autosaveState === 'saved' ? 'Autosaved' : 'Autosave failed'}
              </div>
            )}
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
