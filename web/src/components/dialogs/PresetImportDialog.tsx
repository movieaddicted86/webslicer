import { useState } from 'react';
import { Modal } from './Modal';
import { useStore } from '../../state/store';
import { api, type PresetClash, type PresetClashChoice, type PresetImportPreview, type PresetType } from '../../api';
import './PresetImportDialog.css';

/** The preset types a bundle can hold, in the order the dialog lists them. */
const TYPES: PresetType[] = ['print', 'filament', 'printer', 'sla_print', 'sla_material'];

const TYPE_LABEL: Record<PresetType, string> = {
  print: 'Print',
  filament: 'Filament',
  printer: 'Printer',
  sla_print: 'SLA print',
  sla_material: 'SLA material',
};

const CHOICES: Array<{ value: PresetClashChoice; label: string }> = [
  { value: 'skip', label: 'Skip' },
  { value: 'overwrite', label: 'Overwrite' },
  { value: 'keep-both', label: 'Keep both' },
];

/**
 * The import dialog: pick a config bundle (`.ini`, exported from PrusaSlicer or WebSlicer) or a
 * G-code file, see exactly what it holds – per type, the keys the validation dropped and the names
 * that clash – and then import it with one answer per clash.
 *
 * Nothing is written until "Import" is pressed; the file's text is only read, never executed.
 */
export function PresetImportDialog({ onClose }: { onClose: () => void }) {
  const toast = useStore((s) => s.toast);
  const importConfigBundle = useStore((s) => s.importConfigBundle);
  const [preview, setPreview] = useState<PresetImportPreview>();
  const [source, setSource] = useState('');
  const [choices, setChoices] = useState<Record<string, PresetClashChoice>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const keyOf = (c: { type: string; name: string }) => `${c.type}\u0000${c.name}`;

  const readBundle = async (file: File) => {
    setBusy(true);
    setError('');
    setDone('');
    try {
      setSource(`bundle ${file.name}`);
      setPreview(await api.previewConfigBundle(await file.text()));
      setChoices({});
    } catch (e) {
      setError((e as Error).message);
      setPreview(undefined);
    } finally {
      setBusy(false);
    }
  };

  const readGcode = async (file: File) => {
    setBusy(true);
    setError('');
    setDone('');
    try {
      setSource(`G-code ${file.name}`);
      setPreview(await api.previewGcodeConfig(file));
      setChoices({});
    } catch (e) {
      setError((e as Error).message);
      setPreview(undefined);
    } finally {
      setBusy(false);
    }
  };

  const importNow = async () => {
    if (!preview) return;
    // every clash needs an explicit answer – no silent overwrite
    const unanswered = preview.clashes.filter((c) => !choices[keyOf(c)]);
    if (unanswered.length) {
      setError(`Choose what to do with ${unanswered.length === 1 ? 'the clashing preset' : 'the ${unanswered.length} clashing presets'}.`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const answers = preview.clashes.map((c) => ({ ...c, choice: choices[keyOf(c)] }));
      const result = await importConfigBundle(preview.bundle, answers);
      setDone(
        [
          `${result.imported.length} preset${result.imported.length === 1 ? '' : 's'} imported`,
          preview.rejected.length ? `${preview.rejected.length} setting${preview.rejected.length === 1 ? '' : 's'} not imported` : '',
          result.skipped.length ? `${result.skipped.length} skipped` : '',
          preview.invalid.length ? `${preview.invalid.length} section${preview.invalid.length === 1 ? '' : 's'} not usable` : '',
          preview.physicalPrinters.length ? `${preview.physicalPrinters.length} physical printer(s) were in the bundle (not imported)` : '',
        ]
          .filter(Boolean)
          .join(' · '),
      );
      toast('success', `${result.imported.length} preset(s) imported`);
      setPreview(undefined);
      setChoices({});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const byType = (type: PresetType) => preview?.presets.filter((p) => p.type === type) ?? [];
  const rejectedOf = (type: PresetType) =>
    preview?.rejected.filter((r) => r.type === type && preview.presets.some((p) => p.name === r.name)) ?? [];

  return (
    <Modal title="Import presets" onClose={onClose} wide>
      <div className="form preset-import">
        <div className="import-sources">
          <label className="import-file">
            Config bundle (.ini)
            <input
              type="file"
              accept=".ini,text/plain"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void readBundle(f);
                e.target.value = '';
              }}
            />
          </label>
          <label className="import-file">
            G-code file (.gcode)
            <input
              type="file"
              accept=".gcode,.gco,.g"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void readGcode(f);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        <div className="muted small">
          A bundle holds the user presets of PrusaSlicer or WebSlicer. A G-code file is read for its embedded PrusaSlicer config block only
          – the print itself is not touched. Settings the server refuses (scripts, unknown options) are listed and never imported.
        </div>
        {busy && <div className="muted small">Reading {source}…</div>}
        {error && <div className="error small">{error}</div>}
        {done && <div className="success small">{done}</div>}

        {preview && (
          <>
            {preview.fromGcode && <div className="muted small">The config block of this G-code describes these presets ({source}).</div>}
            {TYPES.filter((t) => byType(t).length).map((type) => (
              <section key={type} className="import-type">
                <h3>
                  {TYPE_LABEL[type]} presets <span className="muted">({byType(type).length})</span>
                </h3>
                <ul>
                  {byType(type).map((p) => {
                    const clash = preview.clashes.find((c) => c.type === p.type && c.name === p.name);
                    const dropped = rejectedOf(type).filter((r) => r.name === p.name);
                    return (
                      <li key={p.name} className="import-preset">
                        <span className="name" title={p.name}>
                          {p.name}
                        </span>
                        <span className="muted">{Object.keys(p.config).length} settings</span>
                        {clash && (
                          <ClashChoice
                            clash={clash}
                            value={choices[keyOf(clash)]}
                            onChange={(v) => setChoices({ ...choices, [keyOf(clash)]: v })}
                          />
                        )}
                        {dropped.length > 0 && (
                          <ul className="dropped" aria-label={`Settings not imported from ${p.name}`}>
                            {dropped.map((r) => (
                              <li key={r.key}>
                                <code>{r.key}</code> – {r.reason}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {preview.fromGcode && !preview.presets.length && (
              <div className="warn small">No preset could be read from this file’s config block.</div>
            )}
            {preview.invalid.length > 0 && (
              <div className="warn small">Not imported: {preview.invalid.map((i) => `${i.type} "${i.name}" (${i.reason})`).join(', ')}</div>
            )}
            {preview.physicalPrinters.length > 0 && (
              <div className="muted small">
                The bundle names {preview.physicalPrinters.length} physical printer(s). They are not imported: a print host’s address and
                API key are not part of a preset.
              </div>
            )}
            <div className="modal-actions">
              <button onClick={onClose}>Close</button>
              <button className="primary" onClick={importNow} disabled={busy || !preview.presets.length}>
                Import
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** The three answers for one clashing name; the system-preset case has no "overwrite". */
function ClashChoice({
  clash,
  value,
  onChange,
}: {
  clash: PresetClash;
  value?: PresetClashChoice;
  onChange: (v: PresetClashChoice) => void;
}) {
  return (
    <span className="clash">
      <span className="clash-warn">{clash.system ? 'System preset with this name' : 'Already exists'}</span>
      <select
        aria-label={`What to do with ${clash.name}`}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value as PresetClashChoice)}
      >
        <option value="" disabled>
          Choose…
        </option>
        {CHOICES.filter((c) => !(clash.system && c.value === 'overwrite')).map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </span>
  );
}
