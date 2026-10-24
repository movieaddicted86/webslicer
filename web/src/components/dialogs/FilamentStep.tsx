/**
 * The filament step of the "Add / remove printers…" dialog (the configuration wizard): which system
 * filaments the filament selector offers, grouped by vendor and material.
 *
 * The step is a *filter*, not a deletion: `None` leaves the list empty, which means "show all" – the
 * behaviour every install had before – and the selector keeps user presets, the defaults and the
 * preset that is selected at the moment. `Apply` stores the ticks through the preset API, so they
 * survive a reload like the installed printers do.
 */
import { useEffect, useMemo, useState } from 'react';
import { api, type FilamentCatalogEntry } from '../../api';
import { useStore } from '../../state/store';
import { groupFilaments, type FilamentVendorGroup } from '../../filamentVisibility';
import { VendorFilaments, tickedCount } from './VendorFilaments';

/** What a quick button does with a vendor's ticks. */
export type QuickAction = 'all' | 'none' | 'only';

/** The names a quick action leaves ticked: everything, nothing, or one material type of the vendor. */
export function quickNames(group: FilamentVendorGroup, action: QuickAction, material?: string): string[] {
  if (action === 'none') return [];
  return group.sections.filter((s) => action === 'all' || s.material === material).flatMap((s) => s.entries.map((e) => e.name));
}

/** The filament step: vendor tabs, type sections, quick buttons, counts and a text filter. */
export function FilamentStep({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
  const printerName = useStore((s) => s.presets.printer.name);
  const visibleFilaments = useStore((s) => s.visibleFilaments);
  const setVisibleFilaments = useStore((s) => s.setVisibleFilaments);
  const toast = useStore((s) => s.toast);
  const [catalog, setCatalog] = useState<FilamentCatalogEntry[]>();
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(visibleFilaments));
  const [filter, setFilter] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .filamentCatalog(printerName)
      .then(setCatalog)
      .catch((e: Error) => toast('error', `Could not load the filaments: ${e.message}`));
  }, [printerName, toast]);

  const groups = useMemo(() => groupFilaments(catalog ?? [], filter), [catalog, filter]);
  // the chosen vendor, or the first of the (possibly filtered) list when it is not there any more
  const active = groups.find((g) => g.vendorId === vendorId) ?? groups[0];
  const toggle = (name: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  /** A quick action replaces the vendor's ticks; "Only this type" leaves the other materials out. */
  const quick = (group: FilamentVendorGroup, action: QuickAction, material?: string) => {
    const names = new Set(quickNames(group, action, material));
    setTicked((prev) => {
      const next = new Set(prev);
      for (const entry of group.sections.flatMap((s) => s.entries)) next.delete(entry.name);
      for (const name of names) next.add(name);
      return next;
    });
  };

  const save = async () => {
    setBusy(true);
    try {
      // the whole list goes to the server: an empty one is "show all", not an error
      await setVisibleFilaments([...ticked]);
      onSave();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const selectedText = ticked.size
    ? `${ticked.size} selected – the filament selector shows those`
    : 'Nothing selected – the selector shows every filament';

  return (
    <div className="filament-step">
      <div className="filament-step-head">
        <input placeholder="Filter filaments…" aria-label="Filter filaments" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="muted small">{selectedText}</span>
      </div>
      {!catalog ? (
        <div className="muted">Loading the filament list…</div>
      ) : !groups.length ? (
        <div className="muted">No filament matches the filter.</div>
      ) : (
        <div className="filament-step-body">
          <div className="vendor-list">
            <ul>
              {groups.map((g) => (
                <li key={g.vendorId} className={g.vendorId === active?.vendorId ? 'active' : ''} onClick={() => setVendorId(g.vendorId)}>
                  {g.vendorName}
                  {tickedCount(g, ticked) > 0 && <span className="badge">{tickedCount(g, ticked)}</span>}
                </li>
              ))}
            </ul>
          </div>
          <div className="filament-types active">
            {active && <VendorFilaments group={active} ticked={ticked} onToggle={toggle} onQuick={quick} />}
          </div>
        </div>
      )}
      <div className="modal-actions" data-testid="modal-actions">
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" data-testid="modal-primary" onClick={() => void save()} disabled={busy || !catalog}>
          Apply
        </button>
      </div>
    </div>
  );
}
