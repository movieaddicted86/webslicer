import { useStore, isModified, type PresetSlot } from '../state/store';
import type { PresetSummary, PresetType } from '../api';

interface Props {
  type: PresetType;
  slot: PresetSlot;
  extruderIdx?: number;
  label: string;
}

export function PresetSelect({ type, slot, extruderIdx = 0, label }: Props) {
  const list = useStore((s) => s.presetLists[type]);
  const showIncompatible = useStore((s) => s.showIncompatible);
  const selectPreset = useStore((s) => s.selectPreset);
  const openDialog = useStore((s) => s.openDialog);
  const deletePreset = useStore((s) => s.deletePreset);
  const discard = useStore((s) => s.discardChanges);
  const toast = useStore((s) => s.toast);
  const modified = isModified(slot);

  const visible = list.filter((p) => showIncompatible || p.compatible !== false || p.name === slot.name);
  const groups = new Map<string, PresetSummary[]>();
  for (const p of visible) {
    const g = !p.system ? 'User presets' : p.vendorName ? `System presets – ${p.vendorName}` : 'Default';
    groups.set(g, [...(groups.get(g) || []), p]);
  }
  const current = list.find((p) => p.name === slot.name);
  const change = async (name: string) => {
    if (name === '__add_printer__') return openDialog('addPrinter');
    if (modified && !confirm(`Discard unsaved changes to "${slot.name}"?`)) return;
    try {
      await selectPreset(type, name, extruderIdx);
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  return (
    <div className="preset-select">
      <label>{label}</label>
      <div className="preset-row">
        <select value={slot.name} onChange={(e) => change(e.target.value)} title={slot.name}>
          {!list.some((p) => p.name === slot.name) && <option value={slot.name}>{slot.name}</option>}
          {[...groups.entries()].map(([g, items]) => (
            <optgroup key={g} label={g}>
              {items.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                  {p.compatible === false ? ' (incompatible)' : ''}
                  {p.name === slot.name && modified ? ' (modified)' : ''}
                </option>
              ))}
            </optgroup>
          ))}
          {type === 'printer' && (
            <optgroup label="—">
              <option value="__add_printer__">＋ Add / remove printers…</option>
            </optgroup>
          )}
        </select>
        <button
          className={`icon ${modified ? 'accent' : ''}`}
          title="Save preset"
          onClick={() => openDialog('savePreset', { type, extruderIdx })}
        >
          💾
        </button>
        {modified && (
          <button className="icon" title="Discard changes" onClick={() => discard(type, extruderIdx)}>
            ↶
          </button>
        )}
        {current && !current.system && (
          <button
            className="icon"
            title="Delete user preset"
            onClick={() => confirm(`Delete preset "${slot.name}"?`) && deletePreset(type, slot.name).catch((e) => toast('error', e.message))}
          >
            🗑
          </button>
        )}
      </div>
    </div>
  );
}
