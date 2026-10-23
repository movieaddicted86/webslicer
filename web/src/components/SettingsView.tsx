import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { SERVER_ONLY_KEYS } from '@webslicer/shared';
import { useStore } from '../state/store';
import { useLimitIssues } from '../state/useLimitIssues';
import { fieldIssueOf, type LimitSection } from '../safety/configIssues';
import { PresetSelect } from './PresetSelect';
import { OptionField } from './OptionField';
import { ServerOnlyOption } from './ServerOnlyOption';
import { MODE_RANK } from '../values';
import type { PresetType } from '../api';
import './SettingsView.css';

export function SettingsView() {
  const view = useStore((s) => s.view) as PresetType;
  const schema = useStore((s) => s.schema);
  const mode = useStore((s) => s.mode);
  const presets = useStore((s) => s.presets);
  const setOption = useStore((s) => s.setOption);
  const resetOption = useStore((s) => s.resetOption);
  const extruders = useStore((s) => s.extruderCount());
  const setExtruderCount = useStore((s) => s.setExtruderCount);
  const settingFocus = useStore((s) => s.settingFocus);
  // S1-e: the limits of the current presets – the same shared check the server runs – at the field
  const issues = useLimitIssues();
  const [extruderIdx, setExtruderIdx] = useState(0);
  const [pageIdx, setPageIdx] = useState(0);
  const [search, setSearch] = useState('');
  /** the option a limit issue in the slice panel pointed at; scrolled to and focused after the render */
  const [focusKey, setFocusKey] = useState<string>();
  // W10: the page list is a real tablist – only the pages with a visible setting are tabs, and the
  // arrows move between those (a page hidden in the current mode is not reachable from the keyboard)
  const tabRefs = useRef<Array<HTMLLIElement | null>>([]);

  const type: PresetType = view;
  const tech = presets.printer.current.printer_technology === 'SLA' ? 'SLA' : 'FFF';
  const tabType: PresetType =
    tech === 'SLA' && type === 'print' ? 'sla_print' : tech === 'SLA' && type === 'filament' ? 'sla_material' : type;
  const tab = schema ? schema.layout.find((t) => t.presetType === tabType) || schema.layout.find((t) => t.presetType === type) : undefined;
  // S1-e: which of the shared checks this tab shows. The server checks SLA print/material configs as
  // `sla_print`/`sla_material`, which split along the same print/filament line
  const section: LimitSection = tabType === 'printer' ? 'printer' : tabType === 'print' || tabType === 'sla_print' ? 'print' : 'filament';
  const issueOf = (key: string) => fieldIssueOf(issues, section, key, extruderIdx);
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

  // S1-e: a click on a limit issue in the slice panel opens this tab (the store did that) and the
  // field it names – search cleared, the page picked and, for a filament issue, the extruder slot.
  // The jump is a one-shot: the request is taken back out of the store here.
  useEffect(() => {
    if (!settingFocus || !tab) return;
    if (settingFocus.section === 'filament') setExtruderIdx(settingFocus.filamentIndex);
    setSearch('');
    const page = tab.pages.findIndex((p) => p.groups.some((g) => g.keys.includes(settingFocus.key)));
    if (page >= 0) setPageIdx(page);
    setFocusKey(settingFocus.key);
    useStore.setState({ settingFocus: undefined });
  }, [settingFocus, tab]);

  // the page switch renders the field one frame later; then it can be scrolled to and focused
  useEffect(() => {
    if (!focusKey) return;
    const frame = requestAnimationFrame(() => {
      const el = document.getElementById(`opt-${focusKey}`);
      el?.scrollIntoView({ block: 'center' });
      el?.querySelector<HTMLElement>('input, select, textarea')?.focus();
      setFocusKey(undefined);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusKey]);

  // the schema is loaded before the settings view can be shown (App waits for `ready`), and so is a tab
  if (!schema || !tab) return null;
  const page = search ? undefined : pages[Math.min(pageIdx, pages.length - 1)];
  const shownPages = search ? pages : page ? [page] : [];
  const visibleTabs = search
    ? []
    : tab.pages.map((p, i) => ({ page: p, index: i })).filter(({ page: p }) => p.groups.some((g) => g.keys.some(visibleKey)));
  const activeIndex = Math.min(pageIdx, pages.length - 1);

  /** Left/Right/Home/End move the selection like a native tab list; the focus follows the selection. */
  const onTabKeyDown = (e: KeyboardEvent<HTMLLIElement>, at: number) => {
    let next: number | undefined;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (at + 1) % visibleTabs.length;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (at - 1 + visibleTabs.length) % visibleTabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = visibleTabs.length - 1;
    if (next === undefined) return;
    e.preventDefault();
    setPageIdx(visibleTabs[next].index);
    tabRefs.current[next]?.focus();
  };

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
        <ul className="pages" role={visibleTabs.length ? 'tablist' : undefined} aria-label="Settings pages">
          {visibleTabs.map(({ page: p, index: i }, at) => {
            const label = p.title === 'Extruder' && extruders > 1 ? `Extruders (${extruders})` : p.title;
            const selected = activeIndex === i;
            return (
              <li
                key={i}
                ref={(el) => {
                  tabRefs.current[at] = el;
                }}
                className={selected ? 'active' : ''}
                role="tab"
                id={`settings-tab-${i}`}
                aria-selected={selected}
                aria-controls="settings-tabpanel"
                tabIndex={selected ? 0 : -1}
                onClick={() => setPageIdx(i)}
                onKeyDown={(e) => onTabKeyDown(e, at)}
              >
                {label}
              </li>
            );
          })}
        </ul>
      </div>
      <div
        className="settings-main"
        id="settings-tabpanel"
        role={visibleTabs.length ? 'tabpanel' : undefined}
        aria-labelledby={visibleTabs.length ? `settings-tab-${activeIndex}` : undefined}
        // the panel is the scroll container; making it focusable is what lets a keyboard user scroll it
        tabIndex={visibleTabs.length ? 0 : undefined}
      >
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
                        issue={issueOf(k)}
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
