import { useMemo } from 'react';
import { useStore, instanceBounds, selectedInstance, type PlaterObject } from '../../state/store';
import { objectInfo } from '../../plater/info';
import { NumericField } from '../common/NumericField';
import { PanelCard } from './PanelCard';
import { TransformInputs } from './TransformInputs';
import { AXES } from './axes';
import { fmt } from '../../format';
import type { Placement } from '../../api';
import './manipulation.css';

/**
 * The Transform card of the selected object: position, rotation, scale and size of the picked
 * instance, the instance count with "Fill bed", the measurements, the mirror actions, the two splits
 * and the resets.
 *
 * The per-object settings, the parts and the height ranges have cards of their own; a part's own
 * transform is in the Parts card. Painting and variable layer height are tools with their own panels
 * in the 3D view, opened from the tool bar.
 */
export function TransformCard({ o }: { o: PlaterObject }) {
  const updateInstance = useStore((s) => s.updateInstance);
  const drop = useStore((s) => s.dropToBed);
  const recordHistory = useStore((s) => s.recordHistory);
  const mirror = useStore((s) => s.mirror);
  const select = useStore((s) => s.select);
  const splitToObjects = useStore((s) => s.splitToObjects);
  const splitToParts = useStore((s) => s.splitToParts);
  const setInstanceCount = useStore((s) => s.setInstanceCount);
  const fillBedWithInstances = useStore((s) => s.fillBedWithInstances);
  // the fields edit the selected instance (instance 1 when none is selected)
  const selectedIds = useStore((s) => s.selectedIds);
  const selectedInstanceId = useStore((s) => s.selectedInstanceId);
  const inst = selectedInstance({ selectedIds, selectedInstanceId }, o);
  const set = (patch: Partial<Placement>) => {
    recordHistory();
    updateInstance(o.id, inst.id, patch);
    drop(o.id);
  };
  const box = instanceBounds(o, inst);
  // size, volume and manifold state of the whole object; a full mesh measurement, so memoised
  const info = useMemo(() => objectInfo(o), [o]);
  return (
    <PanelCard title="Transform" icon="move" testId="object-transform">
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
            // out-of-range or non-integer input is rejected without touching the plater
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
        {/* both splits came from the object row; the row is a plain list entry now */}
        <button
          title={o.volumes.length ? 'Remove modifiers and parts first' : 'Split the connected shells into separate objects'}
          disabled={o.volumes.length > 0}
          onClick={() => {
            select([o.id]);
            void splitToObjects(o.id);
          }}
        >
          Split to objects
        </button>
        <button
          title="Turn the connected shells into parts of this object"
          onClick={() => {
            select([o.id]);
            void splitToParts(o.id);
          }}
        >
          Split to parts
        </button>
      </div>
      <div className="manip-actions">
        <button onClick={() => set({ rotation: [0, 0, 0] })}>Reset rotation</button>
        <button onClick={() => set({ scale: [1, 1, 1] })}>Reset scale</button>
        <button onClick={() => set({ rotation: [0, 0, 0], scale: [1, 1, 1] })}>Reset all</button>
      </div>
      <div className="muted small">
        {o.triangles.toLocaleString()} triangles · {o.modelId ? 'uploaded' : o.uploadError ? 'upload failed' : 'uploading…'}
      </div>
    </PanelCard>
  );
}
