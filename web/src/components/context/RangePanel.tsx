import { useStore, type PlaterObject } from '../../state/store';
import { NumericField } from '../common/NumericField';
import { Icon } from '../../icons/Icon';
import './RangePanel.css';

/**
 * The height ranges of the selected object: one row of from/to/layer height per range, the settings
 * button for the range's own overrides and the remove button. The settings button carries Prusa's
 * height-range icon, so it cannot be mistaken for Preferences. The heading and the "add" button are the Layer ranges
 * card's (`ContextPanel`), so the rows stand alone here.
 */
export function RangePanel({ o }: { o: PlaterObject }) {
  const updateRange = useStore((s) => s.updateRange);
  const removeRange = useStore((s) => s.removeRange);
  const openDialog = useStore((s) => s.openDialog);
  const num = (v: string, fallback: number) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  };
  if (!o.ranges.length) {
    return <div className="muted small">No range. A range prints a band of the object with its own layer height and settings.</div>;
  }
  return (
    <div className="range-panel">
      <div className="range-rows" data-testid="range-list">
        <div className="range-row head">
          <span>From</span>
          <span>To</span>
          <span>Layer h.</span>
          <span />
          <span />
        </div>
        {o.ranges.map((r) => (
          <div key={r.id} className={`range-row ${r.maxZ > r.minZ ? '' : 'invalid'}`}>
            <NumericField
              text={String(r.minZ)}
              step={0.5}
              apply="input"
              onText={(t) => updateRange(o.id, r.id, { minZ: num(t, r.minZ) })}
            />
            <NumericField
              text={String(r.maxZ)}
              step={0.5}
              apply="input"
              onText={(t) => updateRange(o.id, r.id, { maxZ: num(t, r.maxZ) })}
            />
            <NumericField
              text={r.config.layer_height ?? ''}
              step={0.05}
              apply="input"
              placeholder="–"
              onText={(t) => {
                const c = { ...r.config };
                if (t === '') delete c.layer_height;
                else c.layer_height = t;
                updateRange(o.id, r.id, { config: c });
              }}
            />
            <button
              className="icon"
              title="Settings for this range"
              aria-label="Settings for this range"
              onClick={() => openDialog('objectSettings', { objectId: o.id, rangeId: r.id })}
            >
              <Icon name="rangeSettings" size={14} />
              {Object.keys(r.config).filter((k) => k !== 'layer_height').length ? <span aria-hidden="true">•</span> : ''}
            </button>
            <button className="icon" title="Remove range" aria-label="Remove range" onClick={() => removeRange(o.id, r.id)}>
              <Icon name="remove" size={14} />
            </button>
          </div>
        ))}
        <div className="muted small">Z in mm from the object bottom. Ranges may not overlap.</div>
      </div>
    </div>
  );
}
