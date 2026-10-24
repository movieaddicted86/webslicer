import { useStore, type PlaterObject } from '../../state/store';
import { PanelCard } from './PanelCard';
import './SettingsCard.css';

/**
 * The Settings card of the selected object: its extruder and the per-object overrides (PrusaSlicer's
 * "Object settings"). Simple mode hides the overrides, as it did in the object row.
 *
 * The dialog itself is unchanged; this card is the door to it, with the count of the overrides in the
 * button, as before.
 */
export function SettingsCard({ o }: { o: PlaterObject }) {
  const openDialog = useStore((s) => s.openDialog);
  const updateObject = useStore((s) => s.updateObject);
  const recordHistory = useStore((s) => s.recordHistory);
  const extruders = useStore((s) => s.extruderCount());
  const overrides = Object.keys(o.config).length;
  return (
    <PanelCard title="Settings" icon="settings" testId="object-settings-card">
      <div className="manip-row extruder">
        {extruders > 1 && (
          <>
            <span>Extruder</span>
            <select
              value={o.extruder}
              onChange={(e) => {
                recordHistory();
                updateObject(o.id, { extruder: Number(e.target.value) });
              }}
            >
              <option value={0}>default</option>
              {Array.from({ length: extruders }, (_, i) => (
                <option key={i} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </>
        )}
        <button
          className="full"
          data-testid="object-settings"
          onClick={() => openDialog('objectSettings', { objectId: o.id })}
          title="Override print settings for this object only"
        >
          ⚙ Per-object settings{overrides ? ` (${overrides})` : ''}
        </button>
      </div>
    </PanelCard>
  );
}
