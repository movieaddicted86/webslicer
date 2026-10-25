import { useState } from 'react';
import { Modal } from './Modal';
import { useStore } from '../../state/store';
import type { Mode } from '../../api';
import './PreferencesDialog.css';

/** The three visibility modes, in the order PrusaSlicer lists them. */
const MODES: Array<{ id: Mode; label: string; hint: string }> = [
  { id: 'simple', label: 'Simple', hint: 'The essentials: the plater, the presets and the slice button.' },
  { id: 'advanced', label: 'Advanced', hint: 'The common print, filament and printer settings.' },
  { id: 'expert', label: 'Expert', hint: 'Every setting of the PrusaSlicer engine.' },
];

/**
 * The application preferences – a small dialog, not a settings page. Three blocks: the visibility
 * mode (which used to sit in the menu), the read-only online-services status (the
 * `WEBSLICER_UPDATE_CHECK` switch the server answers with) and a reset of the stored panel layout.
 *
 * The print, filament and printer settings are not here: they open from **Menu → Settings** and from
 * the button in each preset row.
 */
export function PreferencesDialog({ onClose }: { onClose: () => void }) {
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const update = useStore((s) => s.updateStatus);
  const resetLayout = useStore((s) => s.resetLayout);
  const toast = useStore((s) => s.toast);
  const [resetDone, setResetDone] = useState(false);

  const online = update?.enabled !== false;
  const checked = update?.checkedAt ? new Date(update.checkedAt).toLocaleString() : 'not yet';

  return (
    <Modal title="Preferences" onClose={onClose}>
      <section className="pref-block" aria-label="Mode">
        <h3>Mode</h3>
        <p className="muted small">How many settings the print, filament and printer views show.</p>
        <div className="pref-modes" role="radiogroup" aria-label="Visibility mode">
          {MODES.map((m) => (
            <label key={m.id} className={mode === m.id ? 'pref-mode active' : 'pref-mode'}>
              <input type="radio" name="pref-mode" checked={mode === m.id} onChange={() => setMode(m.id)} />
              <span>
                <b>{m.label}</b>
                <span className="muted small">{m.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="pref-block" aria-label="Online services">
        <h3>Online services</h3>
        <table className="kv">
          <tbody>
            <tr>
              <td>Update check</td>
              <td>
                {online ? 'on' : 'off'}
                <span className="muted small"> — version and vendor profile checks</span>
              </td>
            </tr>
            <tr>
              <td>Last check</td>
              <td>{online ? checked : '—'}</td>
            </tr>
            <tr>
              <td>Setting</td>
              <td>
                <code>WEBSLICER_UPDATE_CHECK</code>
              </td>
            </tr>
          </tbody>
        </table>
        <p className="muted small">
          The switch is set on the server (<code>WEBSLICER_UPDATE_CHECK=off</code> stops every outbound request); see the{' '}
          <a
            href="https://github.com/movieaddicted86/webslicer/blob/main/docs/installation.md#update-notice"
            target="_blank"
            rel="noreferrer"
          >
            installation guide
          </a>
          .
        </p>
      </section>

      <section className="pref-block" aria-label="Interface">
        <h3>Interface</h3>
        <p className="muted small">
          The panel sizes, the folded cards and the hidden side panels are remembered in this browser. This puts all of them back to their
          defaults.
        </p>
        <div className="modal-actions" data-testid="modal-actions">
          {resetDone && <span className="success small">Panel layout reset.</span>}
          <button
            onClick={() => {
              resetLayout();
              setResetDone(true);
              toast('success', 'Panel layout reset');
            }}
            data-testid="preferences-reset-layout"
          >
            Reset panel layout
          </button>
        </div>
      </section>
    </Modal>
  );
}
