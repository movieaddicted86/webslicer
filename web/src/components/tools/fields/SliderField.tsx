/**
 * The slider + number building block of a tool panel (T-046): a labelled row with a range slider, a
 * number field that edits the same value, and the unit behind it. Every tool with a numeric option
 * uses it, so the panels look the same.
 */
import { NumericField } from '../../common/NumericField';
import './toolFields.css';

export function SliderField({
  label,
  value,
  min,
  max,
  step,
  unit,
  title,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** shown behind the number field (`mm`, `°`, `%`) */
  unit?: string;
  title?: string;
  onChange: (v: number) => void;
  /** how the number field prints and parses the value; default: the plain number */
  format?: { show: (v: number) => string; parse: (text: string) => number | undefined };
}) {
  const show = format ? format.show(value) : String(value);
  return (
    <label className="tool-field" title={title}>
      <span className="tool-field-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <NumericField
        className="tool-field-number"
        text={show}
        step={step}
        min={min}
        max={max}
        onText={(text) => {
          const v = format ? format.parse(text) : Number(text);
          if (v === undefined || !Number.isFinite(v)) return;
          onChange(Math.min(max, Math.max(min, v)));
        }}
      />
      {unit && <span className="unit">{unit}</span>}
    </label>
  );
}
