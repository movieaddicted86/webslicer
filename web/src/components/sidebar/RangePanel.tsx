import { useStore, type PlaterObject } from '../../state/store';
import { NumericField } from '../common/NumericField';
import { SectionHeader } from '../common/SectionHeader';
import { ACTION_ICONS } from '../common/icons';
import './RangePanel.css';

/** Height range modifiers of the selected object (variable layer height and per-range settings) */
export function RangePanel({ o }: { o: PlaterObject }) {
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
      <SectionHeader title="Height ranges">
        <button onClick={() => addRange(o.id)} title="Add a height range with its own layer height / settings">
          ＋ Range
        </button>
      </SectionHeader>
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
                ⚙{Object.keys(r.config).filter((k) => k !== 'layer_height').length ? '•' : ''}
              </button>
              <button className="icon" title="Remove range" aria-label="Remove range" onClick={() => removeRange(o.id, r.id)}>
                <ACTION_ICONS.remove size={14} strokeWidth={2} aria-hidden="true" focusable="false" />
              </button>
            </div>
          ))}
          <div className="muted small">Z in mm from the object bottom. Ranges may not overlap.</div>
        </div>
      )}
    </div>
  );
}
