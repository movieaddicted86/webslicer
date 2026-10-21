import { useState } from 'react';
import { Modal } from './Modal';
import { useStore } from '../../state/store';
import { api } from '../../api';

/** Upload the finished G-code to one of the configured printers. */
export function SendToPrinterDialog({ onClose }: { onClose: () => void }) {
  const printers = useStore((s) => s.physicalPrinters);
  const job = useStore((s) => s.job);
  const toast = useStore((s) => s.toast);
  const [printerId, setPrinterId] = useState(printers[0]?.id || '');
  const [filename, setFilename] = useState(job?.outputName || 'print.gcode');
  const [start, setStart] = useState(false);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!job) return;
    setBusy(true);
    try {
      const r = await api.sendToPrinter(job.id, printerId, filename, start);
      toast(r.ok ? 'success' : 'error', r.message);
      if (r.ok) onClose();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Send G-code to printer" onClose={onClose}>
      <div className="form">
        <label>
          Printer
          <select value={printerId} onChange={(e) => setPrinterId(e.target.value)}>
            {printers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.type})
              </option>
            ))}
          </select>
        </label>
        <label>
          File name <input value={filename} onChange={(e) => setFilename(e.target.value)} />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={start} onChange={(e) => setStart(e.target.checked)} /> Start printing after upload
        </label>
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={send} disabled={busy || !printerId}>
            {busy ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
