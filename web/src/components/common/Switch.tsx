import './Switch.css';

/**
 * An on/off switch, as the mockup draws it: a 36 × 20 track with a knob in the accent colour while it
 * is on. The control is a real checkbox underneath – keyboard, screen reader and the E2E suite see a
 * checkbox with its state, the picture is only the skin.
 *
 * The root is a `label.checkbox`, like the checkboxes it replaces: the whole row of the old control
 * stays the hit area and an existing selector (`label.checkbox input`) keeps finding the control.
 */
export function Switch({
  checked,
  onChange,
  label,
  title,
  testId,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** the accessible name; the surrounding row usually shows it as text, so this may repeat it */
  label: string;
  title?: string;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`checkbox switch ${checked ? 'on' : ''}`} data-testid={testId} title={title}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        title={title}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="knob" aria-hidden="true" />
    </label>
  );
}
