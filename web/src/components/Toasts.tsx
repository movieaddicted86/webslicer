import { useStore } from '../state/store';

/**
 * Toasts (W10). The container is a polite live region: a message that appears after a click or a
 * finished slice is read out without interrupting what the screen reader is saying. `aria-atomic` is
 * off so only the new toast is read, not the whole list again.
 *
 * The region stays in the DOM while it is empty – a live region that is inserted together with its
 * text is often not announced at all.
 */
export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite" aria-relevant="additions" aria-atomic="false">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.text}
          {t.action && (
            <button
              className="link toast-action"
              onClick={(e) => {
                e.stopPropagation();
                t.action?.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
