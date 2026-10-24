import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { useStore } from '../../state/store';
import { api, type BundleRefusal, type InstalledPrinter, type Vendor, type VendorUpdateList, type VendorUpdateResult } from '../../api';
import './AddPrinterDialog.css';

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
 * The vendor profile updates: what upstream offers for the installed vendors, one Update button per
 * vendor, Update all, and one-step Revert. With the check switched off the section says so and offers
 * "Install from file" instead, so an air-gapped install can still update.
 *
 * The check runs on the server (once a day at most, never here) and installing is always a click.
 * A refused bundle shows the findings that refused it and changes nothing.
 */
function VendorUpdates({ onChange }: { onChange: () => Promise<void> }) {
  const toast = useStore((s) => s.toast);
  const [list, setList] = useState<VendorUpdateList>();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [outcome, setOutcome] = useState<Outcome>();

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

  const rows = list?.vendors ?? [];
  const updates = rows.filter((v) => v.update);
  const online = !!list?.enabled;
  const updateAll = () =>
    void run(
      'all',
      updates.map((v) => () => api.installVendorUpdate(v.id)),
    );
  return (
    <section className="vendor-updates" aria-label="Vendor profile updates">
      <div className="vendor-updates-head">
        <h3>Updates</h3>
        {online ? (
          <>
            <span className="muted small">
              {loading ? 'Checking…' : list?.checkedAt ? `Checked ${new Date(list.checkedAt).toLocaleString()}` : 'Not checked yet'}
            </span>
            <button className="small" onClick={() => void load(true)} disabled={loading || !!busy}>
              Check for updates
            </button>
            {updates.length > 0 && (
              <button className="primary small" onClick={updateAll} disabled={!!busy}>
                Update all ({updates.length})
              </button>
            )}
          </>
        ) : (
          <span className="muted small">Online updates are disabled</span>
        )}
      </div>
      {online && (
        <ul className="vendor-update-list">
          {rows.map((v) => (
            <li key={v.id}>
              <span className="name">{v.name}</span>
              <span className="muted small versions">
                {v.installed ?? 'unknown'}
                {v.available && v.available !== v.installed ? ` → ${v.available}` : ''}
                {v.url ? (
                  <>
                    {' '}
                    ·{' '}
                    <a href={v.url} target="_blank" rel="noreferrer">
                      source
                    </a>
                  </>
                ) : null}
              </span>
              {v.update ? (
                <button className="small" onClick={() => void run(v.id, [() => api.installVendorUpdate(v.id)])} disabled={!!busy}>
                  {busy === v.id ? 'Updating…' : 'Update'}
                </button>
              ) : (
                v.reason && <span className="muted small">{v.reason}</span>
              )}
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

/** "Add / remove printers…": vendor profiles to install, or a custom printer from the default profile. */
export function AddPrinterDialog({ onClose }: { onClose: () => void }) {
  const vendors = useStore((s) => s.vendors);
  const installed = useStore((s) => s.installed);
  const installPrinters = useStore((s) => s.installPrinters);
  const refreshVendors = useStore((s) => s.refreshVendors);
  const selectPreset = useStore((s) => s.selectPreset);
  const toast = useStore((s) => s.toast);
  const [vendorId, setVendorId] = useState(vendors[0]?.id || '');
  const [filter, setFilter] = useState('');
  const [sel, setSel] = useState<InstalledPrinter[]>(installed);
  const [tab, setTab] = useState<'vendor' | 'custom'>('vendor');
  const [custom, setCustom] = useState({ name: 'My Printer', x: 220, y: 220, z: 250, nozzle: 0.4, flavor: 'marlin2' });
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
  const saveCustom = async () => {
    try {
      const def = await api.getPreset('printer', '- default FFF -');
      const cfg = {
        ...def.config,
        bed_shape: `0x0,${custom.x}x0,${custom.x}x${custom.y},0x${custom.y}`,
        max_print_height: String(custom.z),
        nozzle_diameter: String(custom.nozzle),
        gcode_flavor: custom.flavor,
        printer_technology: 'FFF',
      };
      await api.savePreset('printer', custom.name, cfg);
      await useStore.getState().refreshPresetLists();
      await selectPreset('printer', custom.name);
      onClose();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  return (
    <Modal title="Printers" onClose={onClose} wide>
      <div className="subtabs">
        <button className={tab === 'vendor' ? 'active' : ''} onClick={() => setTab('vendor')}>
          Vendor profiles
        </button>
        <button className={tab === 'custom' ? 'active' : ''} onClick={() => setTab('custom')}>
          Custom printer
        </button>
      </div>
      {tab === 'vendor' ? (
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
            <div className="modal-actions">
              <span className="muted small">{sel.length} printer variants selected</span>
              <button className="primary" onClick={save}>
                Apply
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="custom-printer">
          <label>
            Name <input value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} />
          </label>
          <label>
            Bed size X (mm) <input type="number" value={custom.x} onChange={(e) => setCustom({ ...custom, x: Number(e.target.value) })} />
          </label>
          <label>
            Bed size Y (mm) <input type="number" value={custom.y} onChange={(e) => setCustom({ ...custom, y: Number(e.target.value) })} />
          </label>
          <label>
            Max print height (mm){' '}
            <input type="number" value={custom.z} onChange={(e) => setCustom({ ...custom, z: Number(e.target.value) })} />
          </label>
          <label>
            Nozzle diameter (mm){' '}
            <input
              type="number"
              step="0.05"
              value={custom.nozzle}
              onChange={(e) => setCustom({ ...custom, nozzle: Number(e.target.value) })}
            />
          </label>
          <label>
            Firmware flavor
            <select value={custom.flavor} onChange={(e) => setCustom({ ...custom, flavor: e.target.value })}>
              {[
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
              ].map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small">
            Creates a user printer preset from the default profile. Adjust start/end G-code and retraction afterwards in Printer Settings.
          </p>
          <div className="modal-actions">
            <button className="primary" onClick={saveCustom} disabled={!custom.name.trim()}>
              Create printer
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
