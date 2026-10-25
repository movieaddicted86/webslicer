import { useStore, type PlaterObject } from '../../state/store';
import { Icon } from '../../icons/Icon';
import { PanelRow } from '../common/PanelRow';
import { PanelCard } from './PanelCard';
import './SettingsCard.css';

/**
 * The Settings card of the selected object: its extruder and the per-object overrides (PrusaSlicer's
 * "Object settings"). Simple mode hides the overrides, as it did in the object row.
 *
 * The rows are the mockup's labelled rows – the name on the left, a compact "Edit…" button on the
 * right. The dialog itself is unchanged; this card is the door to it, with the count of the overrides
 * in the button, as before. The icon is Prusa's object with its override dot, never the cog: that one
 * means Preferences.
 */
export function SettingsCard({ o }: { o: PlaterObject }) {
  const openDialog = useStore((s) => s.openDialog);
  const updateObject = useStore((s) => s.updateObject);
  const recordHistory = useStore((s) => s.recordHistory);
  const extruders = useStore((s) => s.extruderCount());
  const overrides = Object.keys(o.config).length;
  return (
    <PanelCard title="Settings" icon="objectSettings" testId="object-settings-card">
      {extruders > 1 && (
        <PanelRow label="Extruder" title="Which extruder prints this object">
          <select
            value={o.extruder}
            onChange={(e) => {
              recordHistory();
              updateObject(o.id, { extruder: Number(e.target.value) });
            }}
            title="Extruder"
          >
            <option value={0}>default</option>
            {Array.from({ length: extruders }, (_, i) => (
              <option key={i} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
        </PanelRow>
      )}
      <PanelRow label="Per-object settings" title="Override print settings for this object only">
        <button
          className="edit"
          data-testid="object-settings"
          onClick={() => openDialog('objectSettings', { objectId: o.id })}
          title="Override print settings for this object only"
        >
          <Icon name="objectSettings" size={14} />
          Edit…
          {overrides > 0 && <span className="count">({overrides})</span>}
        </button>
      </PanelRow>
    </PanelCard>
  );
}
