import { useEffect, useRef, useState } from 'react';
import { checkConfigValues, type ConfigIssue } from '@webslicer/shared';

import { useStore } from '../../../state/store';
import { api, type BundleRefusal, type InstalledPrinter, type Vendor, type VendorUpdateList, type VendorUpdateResult } from '../../../api';
import { FilamentStep } from '../FilamentStep';
import { FilamentForPrinterStep } from '../FilamentForPrinterStep';
import type { CustomFilamentTemperatures } from '../../../state/slices/preset';
import { repositoryUrl, summaryLine, vendorView } from './vendorUpdates';
import './PrinterSetup.css';

/** The refused bundle's findings, taken from the error the client raised from the 409 body. */
function refusalsOf(error: unknown): BundleRefusal[] {
  const refusals = (error as { refusals?: unknown })?.refusals;
  return Array.isArray(refusals) ? (refusals as BundleRefusal[]) : [];
}

/** What one install, revert or file install answered, as the section reports it. */
type Outcome = { kind: 'success' | 'error'; lines: string[]; refusals: BundleRefusal[] };

/** "Updated Prusa Research 2.4.14 → 2.4.15", plus the user presets that lost their parent. */
function successLines(results: VendorUpdateResult[]): string[] {
  return results.flatMap((r) => {
    const versions = r.from && r.to ? ` ${r.from} → ${r.to}` : '';
    const orphans = r.orphaned.length
      ? ` · ${r.orphaned.length} user preset${r.orphaned.length === 1 ? '' : 's'} reference removed profiles`
      : '';
    return [`Updated ${r.vendor}${versions}${orphans}`];
  });
}

/**
 * The vendor profile updates: one summary line (up to date, or how many vendors have one), the time
 * of the last check and the two actions, then only the rows that matter – the vendors with an update
 * and the vendors the user has printers from. Every other vendor, and every pre-release upstream
 * ships, waits behind "Show all vendors". A version that is not newer is never shown as an arrow.
 *
 * The check runs on the server (once a day at most, never here) and installing is always a click.
 * A refused bundle shows the findings that refused it and changes nothing.
 */
function VendorUpdates({ onChange }: { onChange: () => Promise<void> }) {
  const toast = useStore((s) => s.toast);
  const installedPrinters = useStore((s) => s.installed);
  const printers = useStore((s) => s.presets.printer);
  const printerPresets = useStore((s) => s.presetLists.printer);
  const [list, setList] = useState<VendorUpdateList>();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [outcome, setOutcome] = useState<Outcome>();
  const [showAll, setShowAll] = useState(false);

  const load = async (refresh: boolean) => {
    setLoading(true);
    try {
      setList(await api.vendorUpdates(refresh));
    } catch (e) {
      // offline, or a server that cannot reach the repository: the list simply stays as it was
      toast('error', `Could not check vendor profiles: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load(false);
  }, []);

  /**
   * One change of the installed bundles; a refusal is a result, not a toast – its reasons are listed.
   * `Update all` hands in several actions: they run one after the other, and a refused bundle does not
   * stop the others (each vendor is a file of its own).
   */
  const run = async (who: string, actions: Array<() => Promise<VendorUpdateResult>>): Promise<void> => {
    setBusy(who);
    setOutcome(undefined);
    const done: VendorUpdateResult[] = [];
    let failure: Outcome | undefined;
    for (const action of actions) {
      try {
        done.push(await action());
      } catch (e) {
        failure = { kind: 'error', lines: [(e as Error).message], refusals: refusalsOf(e) };
        break;
      }
    }
    if (done.length) {
      setOutcome({ kind: failure ? 'error' : 'success', lines: successLines(done), refusals: failure?.refusals ?? [] });
      await onChange();
      await load(false);
    } else if (failure) setOutcome(failure);
    setBusy('');
  };

  const installFile = async (file: File) => {
    setBusy('file');
    setOutcome(undefined);
    try {
      const result = await api.installVendorFromFile(file);
      setOutcome({ kind: 'success', lines: successLines([result]), refusals: [] });
      await onChange();
      await load(false);
    } catch (e) {
      setOutcome({ kind: 'error', lines: [(e as Error).message], refusals: refusalsOf(e) });
    } finally {
      setBusy('');
    }
  };

  const relevant = new Set<string>([
    ...installedPrinters.map((p) => p.vendorId),
    ...(printers.vendorId ? [printers.vendorId] : []),
    ...printerPresets.filter((p) => !p.system && p.vendorId).map((p) => p.vendorId as string),
  ]);
  const view = vendorView(list?.vendors ?? [], { relevant, showAll });
  const online = !!list?.enabled;
  const source = repositoryUrl(list?.vendors[0]?.url);
  const updateAll = () =>
    void run(
      'all',
      view.updates.map((v) => () => api.installVendorUpdate(v.id)),
    );
  return (
    <section className="vendor-updates" aria-label="Vendor profile updates">
      <div className="vendor-updates-head">
        {online ? (
          <>
            <span className="vendor-updates-summary" data-testid="vendor-updates-summary">
              {loading ? 'Checking for vendor profile updates…' : summaryLine(view.updates.length)}
            </span>
            <span className="muted small">
              {list?.checkedAt ? `Checked ${new Date(list.checkedAt).toLocaleString()}` : 'Not checked yet'}
            </span>
            <button className="small" onClick={() => void load(true)} disabled={loading || !!busy}>
              Check for updates
            </button>
            {view.updates.length > 0 && (
              <button className="primary small" onClick={updateAll} disabled={!!busy}>
                Update all ({view.updates.length})
              </button>
            )}
          </>
        ) : (
          <span className="muted small">Online updates are disabled</span>
        )}
      </div>
      {online && view.rows.length > 0 && (
        <ul className="vendor-update-list" data-testid="vendor-update-list">
          {view.rows.map((v) => (
            <li key={v.id} data-status={v.status}>
              <span className="name">{v.name}</span>
              <span className="versions">
                installed {v.installed ?? 'unknown'}
                {v.status === 'update' && v.available ? ` · update ${v.available}` : ''}
                {v.status === 'prerelease' && v.available ? ` · ${v.available} (pre-release)` : ''}
                {v.status === 'incompatible' && v.available ? ` · ${v.available} needs another PrusaSlicer` : ''}
              </span>
              {v.status === 'incompatible' && v.reason ? <span className="muted small reason">{v.reason}</span> : null}
              {v.status === 'update' ? (
                <button className="small" onClick={() => void run(v.id, [() => api.installVendorUpdate(v.id)])} disabled={!!busy}>
                  {busy === v.id ? 'Updating…' : 'Update'}
                </button>
              ) : null}
              {v.canRevert && (
                <button
                  className="small"
                  title="Restore the bundle this vendor had before its last update"
                  onClick={() => void run(v.id, [() => api.revertVendor(v.id)])}
                  disabled={!!busy}
                >
                  Revert
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {online && (view.hidden > 0 || showAll) && (
        <button className="link small vendor-updates-all" onClick={() => setShowAll((s) => !s)} aria-expanded={showAll}>
          {showAll ? 'Show fewer vendors' : `Show all vendors (${view.hidden} more)`}
        </button>
      )}
      {online && source ? (
        <div className="muted small">
          Versions come from{' '}
          <a href={source} target="_blank" rel="noreferrer">
            prusa3d/PrusaSlicer-settings
          </a>
          .
        </div>
      ) : null}
      {!list ? null : !online ? (
        <>
          <div className="muted small">
            The vendor profiles came with this image. With online checks switched off, a newer vendor bundle can still be installed from a
            file (the same checks apply).
          </div>
          <input
            type="file"
            accept=".ini,text/plain"
            aria-label="Vendor bundle file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void installFile(f);
              e.target.value = '';
            }}
          />
        </>
      ) : null}
      {busy === 'file' && <div className="muted small">Checking the bundle…</div>}
      {outcome && (
        <div className={outcome.kind === 'success' ? 'success small' : 'error small'}>
          {outcome.lines.map((line) => (
            <div key={line}>{line}</div>
          ))}
          {outcome.refusals.length > 0 && (
            <ul className="refusals" aria-label="Reasons the bundle was refused">
              {outcome.refusals.map((r, i) => (
                <li key={`${r.preset}-${r.rule}-${i}`}>
                  <b>{r.preset}</b>: {r.message} <span className="muted">({r.rule})</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** The default filament of a new printer, named `<printer> – <filament>`. */
const DEFAULT_FILAMENT = 'Generic';

/** The filament values a new printer starts with: PLA, both layers alike, 1.75 mm. */
const DEFAULT_TEMPERATURES: CustomFilamentTemperatures = {
  temperature: 215,
  firstLayerTemperature: 215,
  bedTemperature: 60,
  firstLayerBedTemperature: 60,
  diameter: 1.75,
};

const FLAVORS = [
  'marlin2',
  'marlin',
  'klipper',
  'reprapfirmware',
  'repetier',
  'smoothie',
  'sailfish',
  'mach3',
  'machinekit',
  'teacup',
  'no-extrusion',
];

/** The preset name of the new printer's filament; the en dash is what PrusaSlicer's wizard uses. */
function filamentNameFor(printerName: string, filament = DEFAULT_FILAMENT): string {
  return `${printerName.trim()} – ${filament}`;
}

/** The name rule of the preset routes: a stored preset cannot start with "-" or carry a path. */
function printerNameProblem(name: string): string | undefined {
  if (!name.trim()) return 'A name is required.';
  if (name.trim().startsWith('-') || /[/\\]/.test(name)) return 'The name cannot start with "-" or contain a slash.';
  return undefined;
}

/**
 * The printer setup of the Printers dialog: the body of the Vendor profiles, Filaments and Custom
 * printer tabs. The dialog owns the tab strip; the component stays mounted for all three tabs, so a
 * half-done selection survives a look at another tab. `onClose` is used where a step ends the dialog.
 */
export type PrinterSetupTab = 'vendor' | 'filaments' | 'custom';

export function PrinterSetup({ tab, onClose }: { tab: PrinterSetupTab; onClose: () => void }) {
  const vendors = useStore((s) => s.vendors);
  const installed = useStore((s) => s.installed);
  const installPrinters = useStore((s) => s.installPrinters);
  const createCustomPrinter = useStore((s) => s.createCustomPrinter);
  const refreshVendors = useStore((s) => s.refreshVendors);
  const selectPreset = useStore((s) => s.selectPreset);
  const toast = useStore((s) => s.toast);
  const [vendorId, setVendorId] = useState(vendors[0]?.id || '');
  const [filter, setFilter] = useState('');
  const [sel, setSel] = useState<InstalledPrinter[]>(installed);
  const [custom, setCustom] = useState({ name: 'My Printer', x: 220, y: 220, z: 250, nozzle: 0.4, flavor: 'marlin2' });
  const [step, setStep] = useState<1 | 2>(1);
  const [temperatures, setTemperatures] = useState<CustomFilamentTemperatures>(DEFAULT_TEMPERATURES);
  // until the user names the filament itself, it follows the printer name
  const [ownFilamentName, setOwnFilamentName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // entering the custom printer starts at its first step, whatever a previous visit left
  const previousTab = useRef(tab);
  useEffect(() => {
    if (tab === 'custom' && previousTab.current !== 'custom') setStep(1);
    previousTab.current = tab;
  }, [tab]);
  const vendor: Vendor | undefined = vendors.find((v) => v.id === vendorId);
  const has = (m: { vendorId: string; id: string }, variant: string) =>
    sel.some((i) => i.vendorId === m.vendorId && i.modelId === m.id && i.variant === variant);
  const toggleVariant = (m: { vendorId: string; id: string }, variant: string) =>
    setSel((s) =>
      has(m, variant)
        ? s.filter((i) => !(i.vendorId === m.vendorId && i.modelId === m.id && i.variant === variant))
        : [...s, { vendorId: m.vendorId, modelId: m.id, variant }],
    );
  const models = (vendor?.models || []).filter((m) => !filter || m.name.toLowerCase().includes(filter.toLowerCase()));
  const families = [...new Set(models.map((m) => m.family || 'Other'))];

  // the printer step's own limits: the nozzle is the only bounded value it sets
  const printerIssues = checkConfigValues('printer', { nozzle_diameter: String(custom.nozzle) }).filter((i) => i.severity === 'block');
  const nameProblem = printerNameProblem(custom.name);
  const nextBlocked = !!nameProblem || printerIssues.length > 0;
  const filamentName = ownFilamentName ?? filamentNameFor(custom.name);

  const save = async () => {
    try {
      await installPrinters(sel);
      const added = sel.find(
        (i) => !installed.some((x) => x.vendorId === i.vendorId && x.modelId === i.modelId && x.variant === i.variant),
      );
      if (added) {
        const lists = useStore.getState().presetLists.printer;
        const p = lists.find(
          (x) => x.vendorId === added.vendorId && x.printerModel === added.modelId && x.printerVariant === added.variant,
        );
        if (p) await selectPreset('printer', p.name);
      }
      onClose();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  /** The second step: the printer preset and its filament, then both are selected. */
  const saveCustom = async () => {
    setSaving(true);
    try {
      await createCustomPrinter({
        name: custom.name.trim(),
        bedX: custom.x,
        bedY: custom.y,
        height: custom.z,
        nozzle: custom.nozzle,
        flavor: custom.flavor,
        filamentName,
        temperatures,
      });
      onClose();
    } catch (e) {
      toast('error', (e as Error).message);
      setSaving(false);
    }
  };

  return (
    <>
      {tab === 'vendor' && (
        <>
          <VendorUpdates onChange={refreshVendors} />
          <div className="add-printer">
            <div className="vendor-list">
              <input placeholder="Filter models…" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <ul>
                {vendors.map((v) => (
                  <li key={v.id} className={v.id === vendorId ? 'active' : ''} onClick={() => setVendorId(v.id)}>
                    {v.name}
                    {sel.some((i) => i.vendorId === v.id) && <span className="badge">{sel.filter((i) => i.vendorId === v.id).length}</span>}
                  </li>
                ))}
              </ul>
            </div>
            <div className="model-list">
              {families.map((fam) => (
                <div key={fam} className="family">
                  <h3>{fam}</h3>
                  {models
                    .filter((m) => (m.family || 'Other') === fam)
                    .map((m) => (
                      <div key={m.id} className="model">
                        {m.thumbnail && (
                          <img
                            src={`/api/vendors/${m.vendorId}/asset/${m.thumbnail}`}
                            alt=""
                            loading="lazy"
                            onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
                          />
                        )}
                        <div className="model-body">
                          <div className="model-name">
                            {m.name} <span className="muted small">{m.technology}</span>
                          </div>
                          <div className="variants">
                            {(m.variants.length ? m.variants : ['']).map((v) => (
                              <label key={v} className="checkbox">
                                <input type="checkbox" checked={has(m, v)} onChange={() => toggleVariant(m, v)} />{' '}
                                {v ? `${v} mm` : 'default'}
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              ))}
              {!models.length && <div className="muted">No models.</div>}
            </div>
            <div className="modal-actions" data-testid="modal-actions">
              <span className="muted small">{sel.length} printer variants selected</span>
              <button className="primary" data-testid="modal-primary" onClick={save}>
                Apply
              </button>
            </div>
          </div>
        </>
      )}
      {tab === 'filaments' && <FilamentStep onSave={onClose} onCancel={onClose} />}
      {tab === 'custom' && step === 1 && (
        <div className="custom-printer">
          <label htmlFor="custom-printer-name">
            Name{' '}
            <input
              id="custom-printer-name"
              value={custom.name}
              onChange={(e) => setCustom({ ...custom, name: e.target.value })}
              aria-invalid={!!nameProblem}
            />
          </label>
          <label htmlFor="custom-printer-x">
            Bed size X (mm){' '}
            <input
              id="custom-printer-x"
              type="number"
              value={custom.x}
              onChange={(e) => setCustom({ ...custom, x: Number(e.target.value) })}
            />
          </label>
          <label htmlFor="custom-printer-y">
            Bed size Y (mm){' '}
            <input
              id="custom-printer-y"
              type="number"
              value={custom.y}
              onChange={(e) => setCustom({ ...custom, y: Number(e.target.value) })}
            />
          </label>
          <label htmlFor="custom-printer-z">
            Max print height (mm){' '}
            <input
              id="custom-printer-z"
              type="number"
              value={custom.z}
              onChange={(e) => setCustom({ ...custom, z: Number(e.target.value) })}
            />
          </label>
          <div className={`option ${printerIssues.length ? 'issue-block' : ''}`} id="opt-nozzle_diameter">
            <label htmlFor="custom-printer-nozzle">Nozzle diameter (mm)</label>
            <div className="control">
              <input
                id="custom-printer-nozzle"
                type="number"
                step="0.05"
                value={custom.nozzle}
                onChange={(e) => setCustom({ ...custom, nozzle: Number(e.target.value) })}
              />
              {printerIssues.map((issue: ConfigIssue) => (
                <p key={issue.key} className="field-issue block" role="alert">
                  {issue.message}
                </p>
              ))}
            </div>
          </div>
          <label htmlFor="custom-printer-flavor">
            Firmware flavor
            <select id="custom-printer-flavor" value={custom.flavor} onChange={(e) => setCustom({ ...custom, flavor: e.target.value })}>
              {FLAVORS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          {nameProblem && <div className="error small">{nameProblem}</div>}
          <p className="muted small">
            Creates a user printer preset from the default profile. The next step asks for the filament that belongs to it; start/end G-code
            and retraction are adjusted afterwards in Printer Settings.
          </p>
          <div className="modal-actions" data-testid="modal-actions">
            <span className="muted small">Step 1 of 2 – Printer</span>
            <button className="primary" data-testid="modal-primary" disabled={nextBlocked} onClick={() => setStep(2)}>
              Next
            </button>
          </div>
        </div>
      )}
      {tab === 'custom' && step === 2 && (
        <FilamentForPrinterStep
          filamentName={filamentName}
          onFilamentName={setOwnFilamentName}
          values={temperatures}
          onValues={setTemperatures}
          saving={saving}
          onBack={() => setStep(1)}
          onSave={() => void saveCustom()}
        />
      )}
    </>
  );
}
