import { useFieldDraft, type FieldApply } from './useFieldDraft';

interface NumericFieldProps {
  /** the text shown while the field is not edited – the store value, formatted by the caller */
  text: string;
  /** the text the user typed; the caller parses it and decides what reaches the store */
  onText: (text: string) => void;
  apply?: FieldApply;
  keepText?: boolean;
  step?: number | 'any';
  min?: number;
  max?: number;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  title?: string;
  /** lets the caller's `<label htmlFor>` name the control (W10) */
  id?: string;
}

/** A controlled number input (F-20) – a thin face over the one draft/commit skeleton. */
export function NumericField({
  text,
  onText,
  apply,
  keepText,
  step,
  min,
  max,
  placeholder,
  disabled,
  className,
  title,
  id,
}: NumericFieldProps) {
  const field = useFieldDraft(text, onText, { apply, keepText });
  return (
    <input
      type="number"
      // a phone's numeric keyboard carries the decimal point (and a minus sign) – the keypad
      // without `inputmode` has neither
      inputMode="decimal"
      id={id}
      className={className}
      step={step}
      min={min}
      max={max}
      placeholder={placeholder}
      disabled={disabled}
      title={title}
      value={field.text}
      onChange={(e) => field.set(e.target.value)}
      onFocus={field.reset}
      onBlur={field.commit}
      onKeyDown={field.onKeyDown}
    />
  );
}
