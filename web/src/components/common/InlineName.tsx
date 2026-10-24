import { useEffect, useRef, useState } from 'react';
import './InlineName.css';

/**
 * An inline text field for renaming (an object row, a part): Enter or blur saves, Esc cancels. It
 * starts in edit mode and selects its text, so typing replaces the old name – PrusaSlicer's rename
 * behaves the same.
 */
export function InlineName({
  initial,
  onSave,
  onCancel,
  className,
  title,
}: {
  initial: string;
  onSave: (name: string) => void;
  onCancel: () => void;
  className?: string;
  title?: string;
}) {
  const [text, setText] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  // a cancelled edit must not report a blur save when the field unmounts
  const done = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save) onSave(text);
    else onCancel();
  };
  return (
    <input
      ref={input}
      className={`inline-name ${className || ''}`}
      value={text}
      title={title}
      onChange={(e) => setText(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
      }}
    />
  );
}
