import { useMemo } from 'react';
import { useStore, instanceBounds, selectedInstance, type PlaterObject } from '../../state/store';
import { objectInfo } from '../../plater/info';
import { NumericField } from '../common/NumericField';
import { TransformInputs } from './TransformInputs';
import { PaintPanel } from './PaintPanel';
import { RangePanel } from './RangePanel';
import { VariableLayerHeightPanel } from './VariableLayerHeightPanel';
import { AXES } from './axes';
import { fmt } from '../../format';
import type { Placement } from '../../api';

/** The manipulation panel of the selected object (instance placement, copies, mirror, painting) */
export function ObjectManipulation({ o }: { o: PlaterObject }) {
  const updateInstance = useStore((s) => s.updateInstance);
  const drop = useStore((s) => s.dropToBed);
  const openDialog = useStore((s) => s.openDialog);
  const extruders = useStore((s) => s.extruderCount());
  const recordHistory = useStore((s) => s.recordHistory);
  const mirror = useStore((s) => s.mirror);
  const splitToObjects = useStore((s) => s.splitToObjects);
  const splitToParts = useStore((s) => s.splitToParts);
  const setInstanceCount = useStore((s) => s.setInstanceCount);
  const fillBedWithInstances = useStore((s) => s.fillBedWithInstances);
  // the manipulation fields edit the selected instance (instance 1 when none is selected)
  const selectedIds = useStore((s) => s.selectedIds);
  const selectedInstanceId = useStore((s) => s.selectedInstanceId);
  const inst = selectedInstance({ selectedIds, selectedInstanceId }, o);
  const update = (id: string, patch: Partial<Omit<PlaterObject, 'instances'>>) => {
    recordHistory();
    useStore.getState().updateObject(id, patch);
  };
  const set = (patch: Partial<Placement>) => {
    recordHistory();
    updateInstance(o.id, inst.id, patch);
    drop(o.id);
  };
  const box = instanceBounds(o, inst);
  // size, volume and manifold state of the whole object (T-042); a full mesh measurement, so memoised
  const info = useMemo(() => objectInfo(o), [o]);
  return (
    <div className="manip">
      <TransformInputs
        t={inst}
        size={[o.size[0], o.size[1], o.size[2]]}
        onChange={(patch) => {
          // uniform scaling from the scale/size rows keeps proportions like PrusaSlicer's default.
          // A mirrored axis keeps its sign, otherwise typing a value would un-mirror the instance
          if (patch.scale) {
            const changed = patch.scale.findIndex((v, i) => v !== inst.scale[i]);
            const f = changed >= 0 ? Math.abs(patch.scale[changed]) : Math.abs(patch.scale[0]);
            set({ scale: inst.scale.map((v) => (v < 0 ? -f : f)) as [number, number, number] });
          } else set(patch);
        }}
      />
      <div className="manip-row instances">
        <span>Instances</span>
        {/* the typed count stays visible while it is edited, so a half-typed "1" of "12" does not
            immediately shrink the plater; leaving the field puts the count of the store back */}
        <NumericField
          text={String(o.instances.length)}
          keepText
          apply="input"
          min={1}
          max={1000}
          step={1}
          onText={(text) => {
            const n = Number(text);
            // AC-2.1: out-of-range or non-integer input is rejected without touching the plater
            if (Number.isInteger(n) && n >= 1 && n <= 1000) setInstanceCount(o.id, n);
          }}
        />
        <button title="Add as many instances as fit on the bed" onClick={() => fillBedWithInstances(o.id)}>
          Fill bed
        </button>
      </div>
      <div className="muted small">
        Bounding box: {fmt(box.max.x - box.min.x)} × {fmt(box.max.y - box.min.y)} × {fmt(box.max.z - box.min.z)} mm
      </div>
      <div className="object-info-panel muted small" title="Volume, triangles, manifold state and instance count of this object">
        {fmt(info.size[0])} × {fmt(info.size[1])} × {fmt(info.size[2])} mm · {fmt(info.volume, 2)} cm³ · {info.triangles.toLocaleString()}{' '}
        triangles · {info.instances} {info.instances === 1 ? 'instance' : 'instances'}
        {info.openEdges > 0 && <span className="not-manifold"> · Not manifold – {info.openEdges} open edges</span>}
      </div>
      <div className="manip-actions mirror">
        {AXES.map((a, i) => (
          <button key={a} title={`Mirror along the ${a} axis`} onClick={() => mirror(i as 0 | 1 | 2)}>
            Mirror {a}
          </button>
        ))}
      </div>
      <div className="manip-actions split">
        {/* PrusaSlicer splits an object with several separate shells into objects or into parts */}
        <button
          title={o.volumes.length ? 'Remove modifiers and parts first' : 'Split the connected shells into separate objects'}
          disabled={o.volumes.length > 0}
          onClick={() => splitToObjects(o.id)}
        >
          Split to objects
        </button>
        <button title="Turn the connected shells into parts of this object" onClick={() => splitToParts(o.id)}>
          Split to parts
        </button>
      </div>
      <div className="manip-actions">
        <button onClick={() => set({ rotation: [0, 0, 0] })}>Reset rotation</button>
        <button onClick={() => set({ scale: [1, 1, 1] })}>Reset scale</button>
        <button onClick={() => set({ rotation: [0, 0, 0], scale: [1, 1, 1] })}>Reset all</button>
      </div>
      <PaintPanel o={o} />
      <RangePanel o={o} />
      <VariableLayerHeightPanel o={o} />
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
