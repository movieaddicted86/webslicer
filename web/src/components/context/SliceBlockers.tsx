import { useStore } from '../../state/store';
import type { SliceBlocker } from '../../state/sliceGuard';
import './SliceBlockers.css';

/**
 * The reasons a slice will not start, as the Preview shows them: the same plate and limit blockers the
 * Prepare footer lists, so a plate that fails the checks never leaves the user guessing why the button
 * is grey. A limit blocker opens the settings field that caused it, like the list in the footer.
 */
export function SliceBlockers({ blockers }: { blockers: readonly SliceBlocker[] }) {
  const focusSetting = useStore((s) => s.focusSetting);
  if (!blockers.length) return null;
  return (
    <ul className="slice-blockers" data-testid="preview-blockers" aria-label="The slice is blocked">
      {blockers.map((b, n) => (
        <li key={n} title={b.message}>
          {b.target ? (
            <button type="button" className="link" onClick={() => focusSetting(b.target!)}>
              {b.message}
            </button>
          ) : (
            b.message
          )}
        </li>
      ))}
    </ul>
  );
}
