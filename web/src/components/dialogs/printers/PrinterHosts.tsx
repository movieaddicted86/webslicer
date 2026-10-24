import { useState } from 'react';

import { useStore } from '../../../state/store';
import { api, type PhysicalPrinter } from '../../../api';
import './PrinterHosts.css';

/** A limit field as a number: an empty or broken input means "not set". */
function numberOrUndefined(value: string): number | undefined {
  const n = Number(value.trim());
  return value.trim() === '' || !Number.isFinite(n) || n <= 0 ? undefined : n;
}

/** The safety block after one edit; an empty block clears the stored limits (`{}` survives JSON, `undefined` would not). */
function safetyOf(
  edit: Partial<PhysicalPrinter>,
  change: Partial<NonNullable<PhysicalPrinter['safety']>>,
): NonNullable<PhysicalPrinter['safety']> {
  const next = { ...edit.safety, ...change };
  return next.maxHotend === undefined && next.maxBed === undefined ? {} : next;
}

/**
 * The My printers tab of the Printers dialog: the print hosts WebSlicer can send G-code to (PrusaLink,
 * OctoPrint, Moonraker). A tab body – the dialog frame and the tab strip belong to `PrintersDialog`.
 */
export function PrinterHosts() {
  const printers = useStore((s) => s.physicalPrinters);
  const refresh = useStore((s) => s.refreshPhysicalPrinters);
  const toast = useStore((s) => s.toast);
  // the preset a host is bound to is what the send gate compares the G-code against (S1-b)
  const printerPresets = useStore((s) => s.presetLists.printer);
  const empty: Partial<PhysicalPrinter> = { name: '', type: 'prusalink', host: '', apiKey: '' };
  const [edit, setEdit] = useState<Partial<PhysicalPrinter> | null>(printers.length ? null : empty);
  const [testing, setTesting] = useState<string>('');

  const save = async () => {
    if (!edit) return;
    try {
      if (edit.id) await api.updatePrinter(edit.id, edit);
      else await api.addPrinter(edit);
      await refresh();
      setEdit(null);
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  const test = async () => {
    if (!edit) return;
    setTesting('…');
    const r =
      edit.id && (!edit.apiKey || edit.apiKey === '••••••••')
        ? await api.testPrinterById(edit.id).catch((e) => ({ ok: false, message: e.message }))
        : await api.testPrinter(edit).catch((e) => ({ ok: false, message: e.message }));
    setTesting(r.ok ? `✓ ${r.message}` : `✗ ${r.message}`);
  };
  return (
    <>
      {!edit && (
        <>
          <ul className="printer-list">
            {printers.map((p) => (
              <li key={p.id}>
                <div>
                  <b>{p.name}</b>{' '}
                  <span className="muted small">
                    {p.type} · {p.host}
                  </span>
                </div>
                <div>
                  <button onClick={() => setEdit({ ...p, apiKey: p.hasApiKey ? '••••••••' : '' })}>Edit</button>
                  <button
                    onClick={async () => {
                      if (!confirm(`Delete ${p.name}?`)) return;
                      await api.deletePrinter(p.id);
                      void refresh();
                    }}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
            {!printers.length && <li className="muted">No printers configured.</li>}
          </ul>
          <div className="modal-actions" data-testid="modal-actions">
            <button className="primary" data-testid="modal-primary" onClick={() => setEdit(empty)}>
              Add printer
            </button>
          </div>
        </>
      )}
      {edit && (
        <div className="form">
          <label>
            Name <input value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          </label>
          <label>
            Host type
            <select value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value as PhysicalPrinter['type'] })}>
              <option value="prusalink">PrusaLink (MK4/MK3.9/XL/MINI, MK3S with Pi)</option>
              <option value="octoprint">OctoPrint</option>
              <option value="moonraker">Klipper / Moonraker (Mainsail, Fluidd)</option>
            </select>
          </label>
          <label>
            Hostname / IP{' '}
            <input
              placeholder="192.168.1.50 or http://printer.local"
              value={edit.host || ''}
              onChange={(e) => setEdit({ ...edit, host: e.target.value })}
            />
          </label>
          <label>
            API key{' '}
            <input
              value={edit.apiKey || ''}
              onChange={(e) => setEdit({ ...edit, apiKey: e.target.value })}
              placeholder={edit.type === 'moonraker' ? 'optional' : 'required'}
            />
          </label>
          <label>
            Printer preset{' '}
            <select value={edit.presetName || ''} onChange={(e) => setEdit({ ...edit, presetName: e.target.value || undefined })}>
              <option value="">— not linked —</option>
              {printerPresets.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {/^https:/i.test(edit.host || '') && (
            <label className="checkbox">
              <input type="checkbox" checked={!!edit.ignoreTls} onChange={(e) => setEdit({ ...edit, ignoreTls: e.target.checked })} />{' '}
              Accept self-signed certificate (skip TLS verification)
            </label>
          )}
          {/* S1-d: the machine's own ceilings – the send gate refuses G-code that goes above them */}
          <fieldset className="safety-limits">
            <legend>Safety limits</legend>
            <div className="muted small">
              Optional. A job whose temperatures go above these is refused at the send gate (overridable with a reason).
            </div>
            <label>
              Max hotend °C{' '}
              <input
                type="number"
                min={0}
                max={450}
                placeholder="none"
                value={edit.safety?.maxHotend ?? ''}
                onChange={(e) => setEdit({ ...edit, safety: safetyOf(edit, { maxHotend: numberOrUndefined(e.target.value) }) })}
              />
            </label>
            <label>
              Max bed °C{' '}
              <input
                type="number"
                min={0}
                max={150}
                placeholder="none"
                value={edit.safety?.maxBed ?? ''}
                onChange={(e) => setEdit({ ...edit, safety: safetyOf(edit, { maxBed: numberOrUndefined(e.target.value) }) })}
              />
            </label>
            <button
              type="button"
              className="small"
              title="A PTFE-lined hotend must not go above 240 °C"
              onClick={() => setEdit({ ...edit, safety: safetyOf(edit, { maxHotend: 240 }) })}
            >
              PTFE hotend (max 240 °C)
            </button>
          </fieldset>
          {testing && <div className={`small ${testing.startsWith('✓') ? 'success' : 'error'}`}>{testing}</div>}
          <div className="modal-actions" data-testid="modal-actions">
            <button onClick={() => setEdit(null)}>Cancel</button>
            <button onClick={test} disabled={!edit.host}>
              Test connection
            </button>
            <button className="primary" data-testid="modal-primary" onClick={save} disabled={!edit.host || !edit.name}>
              Save
            </button>
          </div>
        </div>
      )}
    </>
  );
}
