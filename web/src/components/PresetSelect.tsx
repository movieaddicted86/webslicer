import { useStore, isModified, type PresetSlot } from '../state/store';
import type { PresetSummary, PresetType } from '../api';

interface Props {
  type: PresetType;
  slot: PresetSlot;
  extruderIdx?: number;
  label: string;
}

/**
 * Like PrusaSlicer, system presets that share an alias ("Prusament PLA @MK4S HF0.4" and
 * "Prusament PLA @HF0.4" → "Prusament PLA") are shown once; the first compatible one is used.
 */
function collapseAliases(list: PresetSummary[], currentName: string, showIncompatible: boolean): Array<{ value: string; label: string; p: PresetSummary }> {
  const out: Array<{ value: string; label: string; p: PresetSummary }> = [];
  const seenAlias = new Set<string>();
  for (const p of list) {
    const visible = showIncompatible || p.compatible !== false || p.name === currentName;
    if (!visible) continue;
    if (p.system && p.alias && p.compatible !== false) {
      if (seenAlias.has(p.alias) && p.name !== currentName) continue;
      seenAlias.add(p.alias);
      // if the current preset shares this alias, show the current one instead of the first
      const label = showIncompatible ? p.name : p.alias;
      out.push({ value: p.name, label, p });
      continue;
    }
    out.push({ value: p.name, label: p.name, p });
  }
  // If the current preset shares an alias with an earlier entry, drop the earlier entry.
  const cur = out.find((e) => e.value === currentName);
  if (cur && cur.p.alias && cur.p.system && !showIncompatible) {
    return out.filter((e) => e === cur || !(e.p.system && e.p.alias === cur.p.alias && e.p.compatible !== false));
  }
  return out;
}

export function PresetSelect({ type, slot, extruderIdx = 0, label }: Props) {
  const list = useStore((s) => s.presetLists[type]);
  const showIncompatible = useStore((s) => s.showIncompatible);
  const requestPresetSwitch = useStore((s) => s.requestPresetSwitch);
  const openDialog = useStore((s) => s.openDialog);
  const deletePreset = useStore((s) => s.deletePreset);
  const discard = useStore((s) => s.discardChanges);
  const toast = useStore((s) => s.toast);
  const modified = isModified(slot);

  const entries = collapseAliases(list, slot.name, showIncompatible);
  const groups = new Map<string, typeof entries>();
  for (const e of entries) {
    const g = !e.p.system ? 'User presets' : e.p.vendorName ? `System presets – ${e.p.vendorName}` : 'Default';
    groups.set(g, [...(groups.get(g) || []), e]);
  }
  const current = list.find((p) => p.name === slot.name);
  const change = async (name: string) => {
    if (name === '__add_printer__') return openDialog('addPrinter');
    // modified presets go through the "Unsaved Changes" dialog (transfer / save / discard / cancel)
    try {
      await requestPresetSwitch(type, name, extruderIdx);
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  return (
    <div className="preset-select">
      <label>{label}</label>
      <div className="preset-row">
        <select value={slot.name} onChange={(e) => change(e.target.value)} title={slot.name}>
          {!entries.some((e) => e.value === slot.name) && <option value={slot.name}>{slot.name}</option>}
          {[...groups.entries()].map(([g, items]) => (
            <optgroup key={g} label={g}>
              {items.map((e) => (
                <option key={e.value} value={e.value} title={e.value}>
                  {e.label}
                  {e.p.compatible === false ? ' (incompatible)' : ''}
                  {e.value === slot.name && modified ? ' (modified)' : ''}
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
          aria-label="Save preset"
          onClick={() => openDialog('savePreset', { type, extruderIdx })}
        >
          💾
        </button>
        {modified && (
          <button className="icon" title="Discard changes" aria-label="Discard changes" onClick={() => discard(type, extruderIdx)}>
            ↶
          </button>
        )}
        {current && !current.system && (
          <button
            className="icon"
            title="Delete user preset"
            aria-label="Delete user preset"
            onClick={() => confirm(`Delete preset "${slot.name}"?`) && deletePreset(type, slot.name).catch((e) => toast('error', e.message))}
          >
            🗑
          </button>
        )}
      </div>
    </div>
  );
}
