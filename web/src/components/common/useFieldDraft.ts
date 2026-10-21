import { useState, type KeyboardEvent } from 'react';

/** When the typed text reaches the store: every keystroke, or the end of the edit. */
export type FieldApply = 'input' | 'commit';

export interface FieldDraft {
  /** the text the field shows */
  text: string;
  /** a keystroke – stores the draft and, for `apply: 'input'`, hands the text over at once */
  set: (text: string) => void;
  /** Enter or blur – commits the draft and drops it */
  commit: () => void;
  /** entering the field – drops a draft left over from the last visit */
  reset: () => void;
  /** the Enter handler of a single-line field */
  onKeyDown: (e: KeyboardEvent) => void;
}

/**
 * The one controlled-input skeleton (F-20): a field shows the value of the store, and while it is
 * edited it can show the typed text instead (a draft) and hand the text over either on every
 * keystroke (`apply: 'input'`, the plater fields follow each character like on `main`) or when the
 * edit ends (`apply: 'commit'`, the settings fields wait for Enter or blur).
 *
 * `keepText` keeps the typed text visible even when the store ignored it – the instance count uses
 * it, so a half-typed "12" does not jump back to "1", and blur puts the store value back. Such a
 * field also drops a stale draft when it is entered again, so it always starts from the store.
 */
export function useFieldDraft(
  value: string,
  onApply: (text: string) => void,
  { apply = 'commit', keepText = false }: { apply?: FieldApply; keepText?: boolean } = {},
): FieldDraft {
  // a draft is only shown for the fields that keep it – the plater fields stay plain controlled
  const showsDraft = keepText || apply === 'commit';
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    if (apply === 'commit' && draft !== value) onApply(draft);
    setDraft(null);
  };
  return {
    text: showsDraft && draft !== null ? draft : value,
    set: (text: string) => {
      if (showsDraft) setDraft(text);
      if (apply === 'input') onApply(text);
    },
    commit,
    reset: () => setDraft(null),
    onKeyDown: (e) => {
      if (e.key === 'Enter') commit();
    },
  };
}
