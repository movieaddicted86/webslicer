/**
 * The second step of the custom printer in the configuration wizard: the filament that belongs to it.
 *
 * PrusaSlicer's wizard asks for the temperatures and the filament diameter with the printer; the
 * values are stored as a user filament preset named `<printer> – <filament>` and selected with the
 * printer, so the first slice already uses them. Every field faces the shared configuration limits
 * (S1-d/S1-e): a blocking value reddens the field, names the limit and disables Save – the server
 * refuses the same value as well, so the UI cannot talk it into the store.
 */
import { useEffect, useMemo, useRef } from 'react';
import { checkConfigValues, type ConfigIssue } from '@webslicer/shared';
import { useStore } from '../../state/store';
import { NumericField } from '../common/NumericField';
import type { CustomFilamentTemperatures } from '../../state/slices/preset';
import '../OptionField.css';

/** The option rows of the step: the preset key, the label and the value the form edits. */
const FIELDS: Array<{ key: keyof CustomFilamentTemperatures; presetKey: string; label: string; integer: boolean }> = [
  { key: 'temperature', presetKey: 'temperature', label: 'Other layers temperature (°C)', integer: true },
  { key: 'firstLayerTemperature', presetKey: 'first_layer_temperature', label: 'First layer temperature (°C)', integer: true },
  { key: 'bedTemperature', presetKey: 'bed_temperature', label: 'Other layers bed temperature (°C)', integer: true },
  { key: 'firstLayerBedTemperature', presetKey: 'first_layer_bed_temperature', label: 'First layer bed temperature (°C)', integer: true },
  { key: 'diameter', presetKey: 'filament_diameter', label: 'Filament diameter (mm)', integer: false },
];

/** The config the limits are checked against – the keys the preset will store. */
function configOf(values: CustomFilamentTemperatures): Record<string, string> {
  return {
    temperature: String(values.temperature),
    first_layer_temperature: String(values.firstLayerTemperature),
    bed_temperature: String(values.bedTemperature),
    first_layer_bed_temperature: String(values.firstLayerBedTemperature),
    filament_diameter: String(values.diameter),
    filament_type: 'PLA',
  };
}

/** The issue of one field; a blocked value wins over a warning of the same field. */
function issueOf(issues: ConfigIssue[], presetKey: string): ConfigIssue | undefined {
  const own = issues.filter((i) => i.key === presetKey || i.key.startsWith(`${presetKey}[`));
  return own.find((i) => i.severity === 'block') ?? own[0];
}

interface Props {
  filamentName: string;
  onFilamentName: (name: string) => void;
  values: CustomFilamentTemperatures;
  onValues: (values: CustomFilamentTemperatures) => void;
  saving: boolean;
  onBack: () => void;
  onSave: () => void;
}

export function FilamentForPrinterStep({ filamentName, onFilamentName, values, onValues, saving, onBack, onSave }: Props) {
  const exists = useStore((s) => s.presetLists.filament.some((p) => p.name === filamentName));
  const issues = useMemo(() => checkConfigValues('filament', configOf(values)), [values]);
  const blocked = issues.some((i) => i.severity === 'block');
  const first = useRef<HTMLInputElement>(null);
  // the dialog keeps the focus it took when it opened; a step change has to land on its first field
  useEffect(() => first.current?.focus(), []);
  const set = (key: keyof CustomFilamentTemperatures, text: string) => {
    const n = Number(text);
    if (text.trim() !== '' && Number.isFinite(n)) onValues({ ...values, [key]: n });
  };

  return (
    <div className="custom-printer filament-for-printer">
      <p className="muted small">
        The new printer gets a filament preset of its own, named after it. These values are stored with it and selected together with the
        printer.
      </p>
      <label htmlFor="custom-filament-name">
        Filament preset name{' '}
        <input
          id="custom-filament-name"
          ref={first}
          value={filamentName}
          onChange={(e) => onFilamentName(e.target.value)}
          aria-describedby={exists ? 'custom-filament-name-exists' : undefined}
        />
      </label>
      {FIELDS.map((field) => {
        const issue = issueOf(issues, field.presetKey);
        const id = `custom-filament-${field.presetKey}`;
        return (
          <div key={field.key} className={`option ${issue ? `issue-${issue.severity}` : ''}`} id={`opt-${field.presetKey}`}>
            <label htmlFor={id} title={field.presetKey}>
              {field.label}
            </label>
            <div className="control">
              <NumericField
                id={id}
                text={String(values[field.key])}
                onText={(text) => set(field.key, text)}
                apply="input"
                keepText
                step={field.integer ? 1 : 'any'}
              />
              {issue && (
                <p className={`field-issue ${issue.severity}`} role={issue.severity === 'block' ? 'alert' : 'status'}>
                  {issue.message}
                </p>
              )}
            </div>
          </div>
        );
      })}
      {blocked && <div className="error small">Save is disabled until the value is corrected.</div>}
      {exists && (
        <div className="warn small" id="custom-filament-name-exists">
          A filament preset with this name exists and will be overwritten.
        </div>
      )}
      <div className="modal-actions">
        <span className="muted small">Step 2 of 2 – Filament</span>
        <button onClick={onBack}>Back</button>
        <button className="primary" onClick={onSave} disabled={saving || blocked || !filamentName.trim()}>
          Save
        </button>
      </div>
    </div>
  );
}
