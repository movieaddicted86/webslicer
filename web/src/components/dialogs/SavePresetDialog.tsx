import { useState } from 'react';
import { Modal } from './Modal';
import { useStore, isModified } from '../../state/store';
import type { PresetType } from '../../api';
import './changes.css';

/** "Save preset as…": the name, the overwrite warning and the system-preset guard. */
export function SavePresetDialog({ onClose, payload }: { onClose: () => void; payload: { type: PresetType; extruderIdx: number } }) {
  const presets = useStore((s) => s.presets);
  const savePresetAs = useStore((s) => s.savePresetAs);
  const toast = useStore((s) => s.toast);
  const slot = payload.type === 'filament' ? presets.filament[payload.extruderIdx] : presets[payload.type as 'print' | 'printer'];
  const suggested = slot.system ? `${slot.name.replace(/^- default (FFF|SLA) -$/, 'My preset')} - Copy` : slot.name;
  const [name, setName] = useState(suggested);
  const lists = useStore((s) => s.presetLists[payload.type]);
  const exists = lists.find((p) => p.name === name.trim());
  const save = async () => {
    try {
      await savePresetAs(payload.type, name.trim(), payload.extruderIdx);
      onClose();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  return (
    <Modal title={`Save ${payload.type} preset`} onClose={onClose}>
      <div className="form">
        <label>
          Preset name{' '}
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && !exists?.system && save()}
          />
        </label>
        {exists?.system && <div className="error small">A system preset with this name exists; choose a different name.</div>}
        {exists && !exists.system && <div className="warn small">User preset will be overwritten.</div>}
        {!isModified(slot) && <div className="muted small">No changes yet – saving creates a copy of the current preset.</div>}
        <div className="modal-actions" data-testid="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            data-testid="modal-primary"
            onClick={save}
            disabled={!name.trim() || name.trim().startsWith('-') || !!exists?.system}
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}
