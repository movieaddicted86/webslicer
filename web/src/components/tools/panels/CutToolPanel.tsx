import { useStore, selectedInstance } from '../../../state/store';
import { SliderField } from '../fields/SliderField';
import { ToggleRow } from '../fields/ToggleRow';
import { ToolSection } from '../fields/ToolSection';
import { ToolPanel } from '../ToolPanel';

/**
 * The cut panel (T-046, moved out of the sidebar; the tool itself is T-044): the height and tilt of
 * the plane, the parts to keep and the two placement options. "Perform cut" sends the model and the
 * plane to the server, which cuts with the PrusaSlicer CLI. The translucent plane in the 3D view is
 * drawn while the tool is open (`useCutPlane`).
 */
export function CutToolPanel() {
  const settings = useStore((s) => s.cutSettings);
  const setSettings = useStore((s) => s.setCutSettings);
  const close = useStore((s) => s.closeTool);
  const run = useStore((s) => s.cutSelection);
  const busy = useStore((s) => s.cutBusy);
  const selectedIds = useStore((s) => s.selectedIds);
  const selectedInstanceId = useStore((s) => s.selectedInstanceId);
  const o = useStore((s) => s.objects.find((x) => x.id === s.selectedIds[0]));
  if (!o) return null;
  const inst = selectedInstance({ selectedIds, selectedInstanceId }, o);
  // the object's height in the world is its own height times the instance scale (a mirrored scale
  // counts by its magnitude)
  const maxZ = Math.max(0, +(o.size[2] * Math.abs(inst.scale[2])).toFixed(2));
  const canCut = !!o.modelId && !o.uploadError && !busy;
  return (
    <ToolPanel
      title="Cut"
      onClose={close}
      footer={
        <>
          <button
            className="primary"
            disabled={!canCut}
            title={canCut ? 'Cut the selected instance with the plane' : 'The model is not uploaded yet'}
            onClick={() => void run()}
          >
            Perform cut
          </button>
          <span className="muted small">Z in mm from the object bottom · the plane is the light area in the 3D view</span>
        </>
      }
    >
      <ToolSection>
        <SliderField
          label="Height"
          value={Math.min(settings.z, maxZ)}
          min={0}
          max={maxZ}
          step={0.1}
          unit="mm"
          title="Height of the cut plane above the object's bottom"
          onChange={(z) => setSettings({ z })}
          // the field shows the stored height even when the slider clamps it to the object's top
          format={{ show: () => String(settings.z), parse: (t) => (Number.isFinite(Number(t)) ? Number(t) : undefined) }}
        />
        <SliderField
          label="Tilt X"
          value={settings.rotX}
          min={-90}
          max={90}
          step={1}
          unit="°"
          title="Tilt of the plane about the object's X axis"
          onChange={(rotX) => setSettings({ rotX })}
        />
        <SliderField
          label="Tilt Y"
          value={settings.rotY}
          min={-90}
          max={90}
          step={1}
          unit="°"
          title="Tilt of the plane about the object's Y axis"
          onChange={(rotY) => setSettings({ rotY })}
        />
        <label className="tool-field">
          <span className="tool-field-label">Keep</span>
          <select
            className="tool-field-select"
            value={settings.keep}
            onChange={(e) => setSettings({ keep: e.target.value as typeof settings.keep })}
          >
            <option value="both">Both parts</option>
            <option value="upper">Upper part</option>
            <option value="lower">Lower part</option>
          </select>
        </label>
        <ToggleRow label="Place on cut" checked={settings.placeOnCut} onChange={(placeOnCut) => setSettings({ placeOnCut })} />
        <ToggleRow label="Flip upper part" checked={settings.flipUpper} onChange={(flipUpper) => setSettings({ flipUpper })} />
      </ToolSection>
    </ToolPanel>
  );
}
