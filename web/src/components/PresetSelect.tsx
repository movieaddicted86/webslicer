import { useId } from 'react';
import { useStore, isModified, type PresetSlot } from '../state/store';
import type { PresetSummary, PresetType } from '../api';
import { filterSystemFilaments } from '../filamentVisibility';
import './PresetSelect.css';
import { Icon } from '../icons/Icon';
import { PRESET_PRINTERS_ENTRY, settingsEntryFor } from '../nav/navMap';
import { openNavDialog, runNavAction } from '../nav/actions';

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
function collapseAliases(
  list: PresetSummary[],
  currentName: string,
  showIncompatible: boolean,
): Array<{ value: string; label: string; p: PresetSummary }> {
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
  const showAllFilaments = useStore((s) => s.showAllFilaments);
  const visibleFilaments = useStore((s) => s.visibleFilaments);
  const requestPresetSwitch = useStore((s) => s.requestPresetSwitch);
  const openDialog = useStore((s) => s.openDialog);
  const deletePreset = useStore((s) => s.deletePreset);
  const discard = useStore((s) => s.discardChanges);
  const toast = useStore((s) => s.toast);
  const modified = isModified(slot);
  // W10: the label names the select; useId keeps it unique with several selects on screen
  const selectId = useId();

  // the wizard's filament step is a filter over the system presets; user presets and the active one stay
  const shown = type === 'filament' ? filterSystemFilaments(list, slot.name, visibleFilaments, showAllFilaments) : list;
  const entries = collapseAliases(shown, slot.name, showIncompatible);
  const groups = new Map<string, typeof entries>();
  for (const e of entries) {
    const g = !e.p.system ? 'User presets' : e.p.vendorName ? `System presets – ${e.p.vendorName}` : 'Default';
    groups.set(g, [...(groups.get(g) || []), e]);
  }
  const current = list.find((p) => p.name === slot.name);
  // the cog of a preset row opens its view; SLA presets use the print/filament views like FFF ones
  const settingsEntry = settingsEntryFor(type === 'sla_print' ? 'print' : type === 'sla_material' ? 'filament' : type);
  const change = async (name: string) => {
    // the dropdown's setup entry opens the one printers dialog on its vendor profiles tab
    if (name === PRESET_PRINTERS_ENTRY.id) return openNavDialog('printers', { tab: 'vendor' });
    // modified presets go through the "Unsaved Changes" dialog (transfer / save / discard / cancel)
    try {
      await requestPresetSwitch(type, name, extruderIdx);
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  return (
    <div className="preset-select" data-testid={`preset-select-${type}`}>
      <label htmlFor={selectId}>{label}</label>
      <div className="preset-row">
        <select id={selectId} value={slot.name} onChange={(e) => change(e.target.value)} title={slot.name}>
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
              <option value={PRESET_PRINTERS_ENTRY.id}>＋ {PRESET_PRINTERS_ENTRY.label}</option>
            </optgroup>
          )}
        </select>
        {/* the one door to the full settings view of this preset: the cog (Icons-and-UX §2) */}
        <button
          className="icon"
          title={`${settingsEntry.label}…`}
          aria-label={`${settingsEntry.label}…`}
          onClick={() => void runNavAction(settingsEntry.action)}
          data-testid={`settings-open-${type}`}
          data-nav-id={settingsEntry.id}
        >
          <Icon name="settings" size={14} />
        </button>
        <button
          className={`icon ${modified ? 'accent' : ''}`}
          title="Save preset"
          aria-label="Save preset"
          onClick={() => openDialog('savePreset', { type, extruderIdx })}
        >
          <Icon name="save" size={14} />
        </button>
        {modified && (
          <button className="icon" title="Discard changes" aria-label="Discard changes" onClick={() => discard(type, extruderIdx)}>
            <Icon name="reset" size={14} />
          </button>
        )}
        {current && !current.system && (
          <>
            <button
              className="icon"
              title="Rename user preset"
              aria-label="Rename user preset"
              onClick={() => openDialog('renamePreset', { type, name: slot.name })}
            >
              <Icon name="rename" size={14} />
            </button>
            <button
              className="icon"
              title="Delete user preset"
              aria-label="Delete user preset"
              onClick={() =>
                confirm(`Delete preset "${slot.name}"?`) && deletePreset(type, slot.name).catch((e) => toast('error', e.message))
              }
            >
              <Icon name="delete" size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
