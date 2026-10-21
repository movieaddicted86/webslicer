import { useStore, VOLUME_LABELS, type PlaterObject, type PlaterVolume } from '../../state/store';
import { TransformInputs } from './TransformInputs';
import type { VolumeType } from '../../api';

/** The manipulation panel of a selected sub-volume (type, placement, settings) */
export function VolumeManipulation({ o, v }: { o: PlaterObject; v: PlaterVolume }) {
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
