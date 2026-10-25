import { useMemo, useState } from 'react';
import { useStore, instanceBounds, selectedInstance, type PlaterObject } from '../../state/store';
import { objectInfo } from '../../plater/info';
import { NumericField } from '../common/NumericField';
import { PanelCard } from './PanelCard';
import { TransformInputs } from './TransformInputs';
import { Icon } from '../../icons/Icon';
import { fmt } from '../../format';
import type { Placement } from '../../api';
import './manipulation.css';

/** The mirror buttons: the picture and the hook of each world axis, from the one icon table. */
const MIRRORS = [
  { axis: 'X', index: 0, icon: 'mirrorX', testId: 'object-mirror-X' },
  { axis: 'Y', index: 1, icon: 'mirrorY', testId: 'object-mirror-Y' },
  { axis: 'Z', index: 2, icon: 'mirrorZ', testId: 'object-mirror-Z' },
] as const;

/**
 * The Transform card of the selected object: position, rotation, size and scale of the picked
 * instance, the instance count with "Fill bed", the measurements, and one row of icon buttons for the
 * mirror axes, the resets, the proportions lock, the two splits and adding a copy.
 *
 * The icon row is the mockup's answer to the wall of text buttons: every action keeps its name as a
 * tooltip and accessible name, and every picture comes from `table.ts`. The proportions lock is the
 * Scale row's behaviour – locked, a typed scale moves all three axes together (PrusaSlicer's default);
 * unlocked, it moves the one axis only.
 *
 * The per-object settings, the parts and the height ranges have cards of their own; a part's own
 * transform is in the Parts card. Painting and variable layer height are tools with their own panels
 * in the 3D view, opened from the tool strip.
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
  const addInstances = useStore((s) => s.addInstances);
  const [locked, setLocked] = useState(true);
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
          if (patch.scale && locked) {
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
          title="How many copies of this object are on the plate"
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
      <div className="object-info-panel muted small" title="Volume, triangles, manifold state and instance count of this object">
        {fmt(info.size[0])} × {fmt(info.size[1])} × {fmt(info.size[2])} mm · {fmt(info.volume, 2)} cm³ · {info.triangles.toLocaleString()}{' '}
        triangles · {info.instances} {info.instances === 1 ? 'instance' : 'instances'}
        {info.openEdges > 0 && <span className="not-manifold"> · Not manifold – {info.openEdges} open edges</span>}
      </div>
      <div className="muted small">
        Bounding box: {fmt(box.max.x - box.min.x)} × {fmt(box.max.y - box.min.y)} × {fmt(box.max.z - box.min.z)} mm
      </div>
      {/* the icon row of the mockup: one 34 px button per action, the tooltip is the label */}
      <div className="object-actions" data-testid="object-actions">
        {MIRRORS.map((m) => (
          <button
            key={m.axis}
            className="icon"
            data-testid={m.testId}
            title={`Mirror ${m.axis}`}
            aria-label={`Mirror ${m.axis}`}
            onClick={() => mirror(m.index)}
          >
            <Icon name={m.icon} size={18} />
          </button>
        ))}
        <span className="tool-sep" aria-hidden="true" />
        <button
          className="icon"
          data-testid="object-reset-rotation"
          title="Reset rotation"
          aria-label="Reset rotation"
          onClick={() => set({ rotation: [0, 0, 0] })}
        >
          <Icon name="resetRotation" size={18} />
        </button>
        <button
          className="icon"
          data-testid="object-reset-scale"
          title="Reset scale"
          aria-label="Reset scale"
          onClick={() => set({ scale: [1, 1, 1] })}
        >
          <Icon name="resetScale" size={18} />
        </button>
        <button
          className="icon"
          data-testid="object-reset-all"
          title="Reset all"
          aria-label="Reset all"
          onClick={() => set({ rotation: [0, 0, 0], scale: [1, 1, 1] })}
        >
          <Icon name="reset" size={18} />
        </button>
        <button
          className="icon"
          data-testid="object-lock-proportions"
          title={locked ? 'Lock proportions: on' : 'Lock proportions: off'}
          aria-label="Lock proportions"
          aria-pressed={locked}
          onClick={() => setLocked((on) => !on)}
        >
          <Icon name={locked ? 'lockProportions' : 'unlockProportions'} size={18} />
        </button>
        <span className="tool-sep" aria-hidden="true" />
        <button
          className="icon"
          data-testid="object-split-objects"
          title={o.volumes.length ? 'Split to objects: remove modifiers and parts first' : 'Split to objects'}
          aria-label="Split to objects"
          disabled={o.volumes.length > 0}
          onClick={() => {
            select([o.id]);
            void splitToObjects(o.id);
          }}
        >
          <Icon name="splitToObjects" size={18} />
        </button>
        <button
          className="icon"
          data-testid="object-split-parts"
          title="Split to parts"
          aria-label="Split to parts"
          onClick={() => {
            select([o.id]);
            void splitToParts(o.id);
          }}
        >
          <Icon name="splitToParts" size={18} />
        </button>
        <span className="tool-sep" aria-hidden="true" />
        <button
          className="icon"
          data-testid="object-add-instance"
          title="Add a copy"
          aria-label="Add a copy"
          onClick={() => addInstances(o.id, 1)}
        >
          <Icon name="addInstance" size={18} />
        </button>
      </div>
      <div className="muted small">
        {o.triangles.toLocaleString()} triangles · {o.modelId ? 'uploaded' : o.uploadError ? 'upload failed' : 'uploading…'}
      </div>
    </PanelCard>
  );
}
