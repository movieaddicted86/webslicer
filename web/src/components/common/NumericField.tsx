import { useFieldDraft, type FieldApply } from './useFieldDraft';

export interface NumericFieldProps {
  /** the text shown while the field is not edited – the store value, formatted by the caller */
  text: string;
  /** the text the user typed; the caller parses it and decides what reaches the store */
  onText: (text: string) => void;
  apply?: FieldApply;
  keepText?: boolean;
  step?: number | 'any';
  min?: number;
  max?: number;
  disabled?: boolean;
  className?: string;
  title?: string;
}

/** A controlled number input (F-20) – a thin face over the one draft/commit skeleton. */
export function NumericField({ text, onText, apply, keepText, step, min, max, disabled, className, title }: NumericFieldProps) {
  const field = useFieldDraft(text, onText, { apply, keepText });
  return (
    <input
      type="number"
      className={className}
      step={step}
      min={min}
      max={max}
      disabled={disabled}
      title={title}
      value={field.text}
      onChange={(e) => field.set(e.target.value)}
      onBlur={field.commit}
      onKeyDown={field.onKeyDown}
    />
  );
}
