import { useMemo, useState } from 'react';
import { SERVER_ONLY_KEYS } from '@webslicer/shared';
import { useStore } from '../state/store';
import { PresetSelect } from './PresetSelect';
import { OptionField } from './OptionField';
import { ServerOnlyOption } from './ServerOnlyOption';
import { MODE_RANK } from '../values';
import type { PresetType } from '../api';

export function SettingsView() {
  const view = useStore((s) => s.view) as PresetType;
  const schema = useStore((s) => s.schema);
  const mode = useStore((s) => s.mode);
  const presets = useStore((s) => s.presets);
  const setOption = useStore((s) => s.setOption);
  const resetOption = useStore((s) => s.resetOption);
  const extruders = useStore((s) => s.extruderCount());
  const setExtruderCount = useStore((s) => s.setExtruderCount);
  const [extruderIdx, setExtruderIdx] = useState(0);
  const [pageIdx, setPageIdx] = useState(0);
  const [search, setSearch] = useState('');

  const type: PresetType = view;
  const tech = presets.printer.current.printer_technology === 'SLA' ? 'SLA' : 'FFF';
  const tabType: PresetType =
    tech === 'SLA' && type === 'print' ? 'sla_print' : tech === 'SLA' && type === 'filament' ? 'sla_material' : type;
  const tab = schema ? schema.layout.find((t) => t.presetType === tabType) || schema.layout.find((t) => t.presetType === type) : undefined;
  const slot =
    type === 'filament' ? presets.filament[Math.min(extruderIdx, presets.filament.length - 1)] : presets[type as 'print' | 'printer'];

  const rank = MODE_RANK[mode];
  const visibleKey = (k: string) => {
    const d = schema?.options[k];
    if (!d) return false;
    // options the server drops before slicing (SEC-1) are not editable – a preset may still carry
    // them, so they are listed read-only with the reason instead of silently doing nothing
    if (SERVER_ONLY_KEYS.has(k)) return false;
    // hide options of the other printer technology (e.g. SLA display settings on an FFF printer)
    if (d.technology && d.technology !== 'any' && d.technology !== tech) return false;
    const r = MODE_RANK[d.mode || 'expert'];
    return r <= rank;
  };

  const pages = useMemo(() => {
    if (!schema || !tab) return [];
    const q = search.trim().toLowerCase();
    if (!q) return tab.pages;
    return tab.pages
      .map((p) => ({
        ...p,
        groups: p.groups
          .map((g) => ({
            ...g,
            keys: g.keys.filter((k) => {
              const d = schema.options[k];
              return d && (k.includes(q) || d.label.toLowerCase().includes(q) || d.tooltip.toLowerCase().includes(q));
            }),
          }))
          .filter((g) => g.keys.length),
      }))
      .filter((p) => p.groups.length);
  }, [tab, search, schema]);

  // the schema is loaded before the settings view can be shown (App waits for `ready`), and so is a tab
  if (!schema || !tab) return null;
  const page = search ? undefined : pages[Math.min(pageIdx, pages.length - 1)];
  const shownPages = search ? pages : page ? [page] : [];

  return (
    <div className="settings">
      <div className="settings-side">
        <div className="settings-preset">
          {type === 'filament' && extruders > 1 && (
            <select value={extruderIdx} onChange={(e) => setExtruderIdx(Number(e.target.value))}>
              {Array.from({ length: extruders }, (_, i) => (
                <option key={i} value={i}>
                  Extruder {i + 1}
                </option>
              ))}
            </select>
          )}
          <PresetSelect type={type} slot={slot} extruderIdx={extruderIdx} label={tab.title} />
        </div>
        <input className="search" placeholder="Search settings…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <ul className="pages">
          {!search &&
            tab.pages.map((p, i) => {
              const anyVisible = p.groups.some((g) => g.keys.some(visibleKey));
              if (!anyVisible) return null;
              return (
                <li key={i} className={pageIdx === i ? 'active' : ''} onClick={() => setPageIdx(i)}>
                  {p.title === 'Extruder' && extruders > 1 ? `Extruders (${extruders})` : p.title}
                </li>
              );
            })}
        </ul>
      </div>
      <div className="settings-main">
        {shownPages.map((p) => (
          <div key={p.title} className="page">
            {search && <h2>{p.title}</h2>}
            {p.groups.map((g) => {
              const keys = g.keys.filter(visibleKey);
              // a group may hold nothing but server-only keys (SEC-1), e.g. "Post-processing scripts":
              // it still has to show the read-only rows, so the emptiness test counts them too
              const serverOnly = g.keys.filter((k) => SERVER_ONLY_KEYS.has(k));
              if (!keys.length && !serverOnly.length) return null;
              return (
                <div key={g.title} className="group">
                  <h3>{g.title}</h3>
                  {type === 'printer' && g.title === 'Capabilities' && !search && (
                    <div className="option">
                      <label title="Number of extruders. Resizes all per-extruder settings and filament slots.">Extruders</label>
                      <div className="control">
                        <input
                          type="number"
                          min={1}
                          max={16}
                          value={extruders}
                          onChange={(e) => setExtruderCount(Number(e.target.value))}
                        />
                      </div>
                    </div>
                  )}
                  {keys.map((k) => {
                    const def = schema.options[k];
                    return (
                      <OptionField
                        key={k}
                        def={def}
                        value={slot.current[k]}
                        savedValue={slot.saved[k]}
                        extruders={extruders}
                        singleElement={type === 'filament'}
                        onChange={(v) => setOption(type, k, v, extruderIdx)}
                        onReset={() => resetOption(type, k, extruderIdx)}
                      />
                    );
                  })}
                  {serverOnly.map((k) => (
                    <ServerOnlyOption key={k} def={schema.options[k]} />
                  ))}
                </div>
              );
            })}
          </div>
        ))}
        {!shownPages.length && <div className="muted">No settings match your search in this mode.</div>}
      </div>
    </div>
  );
}
