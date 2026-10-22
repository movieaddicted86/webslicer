import { useMemo, useState } from 'react';
import { checkSend, preflightSendIssues, printerLimitIssues, sendMatch, type PresetLink, type PreflightIssue } from '@webslicer/shared';
import { Modal } from './Modal';
import { useStore } from '../../state/store';
import { api, type SendIssue, type SendResult } from '../../api';

/** Is the error a refused send? The client attaches the gate's issues to it. */
function issuesOf(error: unknown): SendIssue[] {
  const issues = (error as { issues?: unknown })?.issues;
  return Array.isArray(issues) ? (issues as SendIssue[]) : [];
}

/** A preflight finding carries the line it stands on; a preset issue does not. */
function isPreflight(issue: SendIssue): issue is PreflightIssue {
  return typeof (issue as PreflightIssue).line === 'number';
}

/** One issue as the dialog lists it: the message, and for a preflight finding the line behind it. */
function IssueLine({ issue }: { issue: SendIssue }) {
  if (!isPreflight(issue)) return <div>{issue.message}</div>;
  return (
    <div>
      {issue.message}
      {issue.text ? (
        <div className="muted small gcode-line">
          Line {issue.line}: {issue.text}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The host to preselect: one set up for exactly the job's preset, else one set up for a preset derived
 * from it (in either direction), else the first host. Never a sibling – that is a mismatch.
 */
function preselect(
  printers: ReturnType<typeof useStore.getState>['physicalPrinters'],
  jobPrinterPreset: string,
  presets: readonly PresetLink[],
): string {
  const kind = (p: (typeof printers)[number]): string => (p.presetName ? sendMatch(jobPrinterPreset, p.presetName, { presets }) : 'none');
  const exact = printers.find((p) => kind(p) === 'exact');
  const derived = printers.find((p) => kind(p) === 'derived');
  return (exact ?? derived ?? printers[0])?.id || '';
}

/**
 * Upload the finished G-code to one of the configured printers (S1-b).
 *
 * The dialog takes the job's printer preset seriously: it preselects the host that is set up for the
 * same preset (a derived one only when there is no exact one), runs the same pure check the server
 * enforces and shows its issues. A **block** (the G-code was sliced for another printer) needs an
 * override – the checkbox and a written reason, which the server audits. A **warn** (a derived
 * preset, or a host not linked to a preset) needs a confirmation when the print should start right
 * away.
 */
export function SendToPrinterDialog({ onClose }: { onClose: () => void }) {
  const printers = useStore((s) => s.physicalPrinters);
  const job = useStore((s) => s.job);
  const printerPresets = useStore((s) => s.presetLists.printer);
  const toast = useStore((s) => s.toast);
  const jobPreset = job?.presets.printer || '';
  const links = useMemo(
    () => printerPresets.map((p): PresetLink => ({ name: p.name, alias: p.alias, inherits: p.inherits })),
    [printerPresets],
  );
  const [printerId, setPrinterId] = useState(() => preselect(printers, jobPreset, links));
  const [filename, setFilename] = useState(job?.outputName || 'print.gcode');
  const [start, setStart] = useState(false);
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState('');
  const [warnConfirmed, setWarnConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  const printer = printers.find((p) => p.id === printerId);
  const issues: SendIssue[] = useMemo(() => {
    if (!printer || !job) return [];
    // S1-c/S1-d: the preflight issues of the finished file and the target's own safety limits join the
    // preset issues – the server merges the same lists, so the dialog shows what the gate will enforce
    return [
      ...checkSend({ presets: { printer: jobPreset } }, printer, { presets: links }),
      ...printerLimitIssues(job.temperatures, printer.safety),
      ...preflightSendIssues(job.info?.preflight),
    ];
  }, [printer, job, jobPreset, links]);

  const blocking = issues.filter((i) => i.severity === 'block');
  const warnings = issues.filter((i) => i.severity === 'warn');
  const blocked = blocking.length > 0 && !(override && reason.trim());
  const warnUnconfirmed = warnings.length > 0 && start && !warnConfirmed;

  const send = async () => {
    if (!job) return;
    setBusy(true);
    try {
      const r: SendResult = await api.sendToPrinter(job.id, printerId, filename, start, override && reason.trim() ? { reason } : undefined);
      toast(r.ok ? 'success' : 'error', r.message);
      if (r.ok) onClose();
    } catch (e) {
      const serverIssues = issuesOf(e);
      toast('error', serverIssues.length ? serverIssues.map((i) => i.message).join(' ') : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Send G-code to printer" onClose={onClose}>
      <div className="form">
        <div className="muted small">
          Sliced for the printer preset <b>{jobPreset || '—'}</b>
        </div>
        <label>
          Printer
          <select
            value={printerId}
            onChange={(e) => {
              setPrinterId(e.target.value);
              setOverride(false);
              setReason('');
              setWarnConfirmed(false);
            }}
          >
            {printers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.type}){p.presetName ? ` · ${p.presetName}` : ' · no preset'}
              </option>
            ))}
          </select>
        </label>
        <label>
          File name <input value={filename} onChange={(e) => setFilename(e.target.value)} />
        </label>
        {blocking.length > 0 && (
          <div className="warn issue-list">
            {blocking.map((i, index) => (
              <IssueLine key={`${i.rule}-${index}`} issue={i} />
            ))}
          </div>
        )}
        {warnings.length > 0 && (
          <div className="warn issue-list">
            {warnings.map((i, index) => (
              <IssueLine key={`${i.rule}-${index}`} issue={i} />
            ))}
          </div>
        )}
        {blocking.length > 0 && (
          <>
            <label className="checkbox">
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Send anyway (override)
            </label>
            {override && (
              <label>
                Reason{' '}
                <input
                  value={reason}
                  maxLength={500}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why this G-code fits this printer"
                />
              </label>
            )}
          </>
        )}
        <label className="checkbox">
          <input type="checkbox" checked={start} onChange={(e) => setStart(e.target.checked)} /> Start printing after upload
        </label>
        {warnUnconfirmed && (
          <label className="checkbox">
            <input type="checkbox" checked={warnConfirmed} onChange={(e) => setWarnConfirmed(e.target.checked)} /> I understand the warning
            and want to start the print
          </label>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={send} disabled={busy || !printerId || blocked || warnUnconfirmed}>
            {busy ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
