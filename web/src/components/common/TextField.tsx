import { useFieldDraft, type FieldApply } from './useFieldDraft';

interface TextFieldProps {
  value: string;
  onChange: (text: string) => void;
  apply?: FieldApply;
  keepText?: boolean;
  multiline?: boolean;
  rows?: number;
  type?: string;
  className?: string;
  spellCheck?: boolean;
  disabled?: boolean;
  title?: string;
  /** lets the caller's `<label htmlFor>` name the control (W10) */
  id?: string;
}

/**
 * A controlled text field (F-20). A multiline field never commits on Enter – Enter belongs to the
 * text there (the G-code box behaves like that on `main`); it commits when it is left.
 */
export function TextField({
  value,
  onChange,
  apply,
  keepText,
  multiline,
  rows,
  type,
  className,
  spellCheck,
  disabled,
  title,
  id,
}: TextFieldProps) {
  const field = useFieldDraft(value, onChange, { apply, keepText });
  if (multiline) {
    return (
      <textarea
        id={id}
        className={className}
        rows={rows}
        spellCheck={spellCheck}
        disabled={disabled}
        title={title}
        value={field.text}
        onChange={(e) => field.set(e.target.value)}
        onFocus={field.reset}
        onBlur={field.commit}
      />
    );
  }
  return (
    <input
      type={type}
      id={id}
      className={className}
      spellCheck={spellCheck}
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
