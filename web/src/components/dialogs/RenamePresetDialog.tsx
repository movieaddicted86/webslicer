import { useState } from 'react';
import { Modal } from './Modal';
import { useStore } from '../../state/store';
import type { PresetType } from '../../api';
import './changes.css';

/** "Rename preset": validates the name up front, so a clash or a system preset is refused before the call. */
export function RenamePresetDialog({ onClose, payload }: { onClose: () => void; payload: { type: PresetType; name: string } }) {
  const lists = useStore((s) => s.presetLists[payload.type]);
  const renamePreset = useStore((s) => s.renamePreset);
  const toast = useStore((s) => s.toast);
  const [name, setName] = useState(payload.name);
  const trimmed = name.trim();
  const exists = lists.find((p) => p.name === trimmed && p.name !== payload.name);
  const unchanged = trimmed === payload.name;
  const save = async () => {
    try {
      await renamePreset(payload.type, payload.name, trimmed);
      onClose();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  return (
    <Modal title={`Rename ${payload.type} preset`} onClose={onClose}>
      <div className="form">
        <label>
          Preset name{' '}
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && trimmed && !exists && !unchanged && save()}
          />
        </label>
        {exists?.system && <div className="error small">A system preset with this name exists; choose a different name.</div>}
        {exists && !exists.system && <div className="error small">A user preset with this name exists; choose a different name.</div>}
        <div className="muted small">
          Other presets that inherit from this one, print hosts bound to it and stored projects keep working – their references follow the
          new name.
        </div>
        <div className="modal-actions" data-testid="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            data-testid="modal-primary"
            onClick={save}
            disabled={!trimmed || trimmed.startsWith('-') || !!exists || unchanged}
          >
            Rename
          </button>
        </div>
      </div>
    </Modal>
  );
}
