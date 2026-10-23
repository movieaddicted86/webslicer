import { useStore, selectedInstance } from '../../state/store';
import { NumericField } from '../common/NumericField';
import { SectionHeader } from '../common/SectionHeader';
import type { PlaterObject } from '../../state/types';

/** A clamped number from the text of a field; the panel ignores anything that is not a number. */
function num(text: string, fallback: number): number {
  const n = Number(text);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * The cut panel (T-044): the height and tilt of the plane, the parts to keep and the two placement
 * options. It shows the plane in the 3D view while it is open (`useCutPlane`); "Perform cut" sends the
 * model and the plane to the server, which cuts with the PrusaSlicer CLI.
 */
export function CutPanel({ o }: { o: PlaterObject }) {
  const settings = useStore((s) => s.cutSettings);
  const setSettings = useStore((s) => s.setCutSettings);
  const close = useStore((s) => s.closeCut);
  const run = useStore((s) => s.cutSelection);
  const selectedIds = useStore((s) => s.selectedIds);
  const selectedInstanceId = useStore((s) => s.selectedInstanceId);
  const inst = selectedInstance({ selectedIds, selectedInstanceId }, o);
  // the object's height in the world is its own height times the instance scale (a mirrored scale
  // counts by its magnitude)
  const height = o.size[2] * Math.abs(inst.scale[2]);
  const maxZ = Math.max(0, height);
  const canCut = !!o.modelId && !o.uploadError;
  return (
    <div className="cut-panel">
      <SectionHeader title="Cut">
        <button title="Close the cut panel (Esc)" onClick={close}>
          Close
        </button>
      </SectionHeader>
      <label className="manip-row">
        <span>Height</span>
        <input
          type="range"
          min={0}
          max={maxZ}
          step={0.1}
          value={Math.min(settings.z, maxZ)}
          onChange={(e) => setSettings({ z: Number(e.target.value) })}
          title="Height of the cut plane above the object's bottom"
        />
        <NumericField
          text={String(settings.z)}
          step={0.1}
          min={0}
          onText={(t) => setSettings({ z: Math.min(maxZ, Math.max(0, num(t, settings.z))) })}
        />
        <span className="unit">mm</span>
      </label>
      <label className="manip-row">
        <span>Tilt X</span>
        <NumericField text={String(settings.rotX)} step={1} onText={(t) => setSettings({ rotX: num(t, settings.rotX) })} />
        <span className="unit">°</span>
      </label>
      <label className="manip-row">
        <span>Tilt Y</span>
        <NumericField text={String(settings.rotY)} step={1} onText={(t) => setSettings({ rotY: num(t, settings.rotY) })} />
        <span className="unit">°</span>
      </label>
      <label className="manip-row">
        <span>Keep</span>
        <select value={settings.keep} onChange={(e) => setSettings({ keep: e.target.value as typeof settings.keep })}>
          <option value="both">Both parts</option>
          <option value="upper">Upper part</option>
          <option value="lower">Lower part</option>
        </select>
      </label>
      <label className="arrange-check">
        <input type="checkbox" checked={settings.placeOnCut} onChange={(e) => setSettings({ placeOnCut: e.target.checked })} />
        Place on cut
      </label>
      <label className="arrange-check">
        <input type="checkbox" checked={settings.flipUpper} onChange={(e) => setSettings({ flipUpper: e.target.checked })} />
        Flip upper part
      </label>
      <div className="manip-actions">
        <button
          className="primary"
          disabled={!canCut}
          title={canCut ? 'Cut the selected instance with the plane' : 'The model is not uploaded yet'}
          onClick={() => void run()}
        >
          Perform cut
        </button>
      </div>
      <div className="muted small">Z in mm from the object bottom. The plane is the white area in the 3D view.</div>
    </div>
  );
}
