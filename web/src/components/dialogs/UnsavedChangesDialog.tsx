import { useMemo, useState } from 'react';
import { Modal } from './Modal';
import { useStore, type PendingPresetSwitch } from '../../state/store';
import { presetDiff, shortValue } from '../../plater/presetDiff';
import './changes.css';

/**
 * PrusaSlicer's "Unsaved Changes" dialog: the user picked another preset while the current one has
 * changes. It lists them and asks what happens to them – transfer, save, discard or cancel.
 */
export function UnsavedChangesDialog({ onClose, payload }: { onClose: () => void; payload: PendingPresetSwitch }) {
  const schema = useStore((s) => s.schema);
  const selectPreset = useStore((s) => s.selectPreset);
  const transferChanges = useStore((s) => s.transferChanges);
  const toast = useStore((s) => s.toast);
  const savePendingPreset = useStore((s) => s.savePendingPreset);
  const lists = useStore((s) => s.presetLists[payload.type]);
  const [busy, setBusy] = useState(false);
  const changes = useMemo(() => presetDiff(payload.source.saved, payload.source.current), [payload]);
  const [name, setName] = useState(
    payload.source.system ? `${payload.source.name.replace(/^- default (FFF|SLA) -$/, 'My preset')} - Copy` : payload.source.name,
  );
  // Printer settings describe the machine, so they are never transferred to another printer preset.
  const transferDisabled = payload.type === 'printer';
  const targetLabel =
    payload.type === 'filament' && payload.extruderIdx > 0 ? `${payload.target} (extruder ${payload.extruderIdx + 1})` : payload.target;
  const exists = lists.find((p) => p.name === name.trim());
  const nameTaken = !!exists?.system;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      onClose();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  /** Cancel / Esc / ✕: nothing happens – the select falls back to the preset it still shows. */
  const cancel = () => onClose();
  const discard = () => run(() => selectPreset(payload.type, payload.target, payload.extruderIdx));
  const transfer = () => run(transferChanges);
  const save = () => run(() => savePendingPreset(name.trim()));

  // the schema is loaded before a dialog can open (App waits for `ready`)
  if (!schema) return null;
  return (
    <Modal title="Unsaved Changes" onClose={onClose} wide>
      <p>
        “{payload.source.name}” has unsaved changes. What should happen to them before switching to “{targetLabel}”?
      </p>
      <table className="changes">
        <thead>
          <tr>
            <th>Option</th>
            <th>Old value</th>
            <th>New value</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((c) => (
            <tr key={c.key} title={c.key}>
              <td>{schema.options[c.key]?.label || c.key}</td>
              <td className="mono" title={c.from}>
                {shortValue(c.from) || <span className="muted">(unchanged)</span>}
              </td>
              <td className="mono" title={c.to}>
                {shortValue(c.to) || <span className="muted">(removed)</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!changes.length && <p className="muted">No option differs from the saved preset.</p>}
      <div className="form save-in-dialog">
        <label>
          Save as{' '}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !nameTaken && name.trim() && save()}
          />
        </label>
        {nameTaken && <div className="error small">A system preset with this name exists; choose a different name.</div>}
      </div>
      <div className="modal-actions" data-testid="modal-actions">
        <button onClick={cancel}>Cancel</button>
        <button onClick={discard} disabled={busy}>
          Discard
        </button>
        <button onClick={save} disabled={busy || !name.trim() || name.trim().startsWith('-') || nameTaken}>
          Save
        </button>
        <button
          className="primary"
          data-testid="modal-primary"
          disabled={transferDisabled || busy}
          title={transferDisabled ? 'Printer settings are not transferred to another printer' : 'Keep the changes in the new preset'}
          onClick={transfer}
        >
          Transfer
        </button>
      </div>
    </Modal>
  );
}
