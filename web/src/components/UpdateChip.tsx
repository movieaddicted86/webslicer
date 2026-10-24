/**
 * The quiet "Update available" chip (T-058, Robert): one line, dismissible, never a modal and never a
 * toast. Clicking it opens the comparison (or release) page in a new tab; the ✕ hides it for this
 * `latest` value (`state/updateNotice.ts` remembers that in `localStorage`).
 *
 * The chip renders nothing when the server is up to date, when the check is switched off or when the
 * user dismissed this `latest` – so a self-hosted install that is current sees no extra pixel.
 *
 * `compact` is the rail's version of it (layout 3.0): the 64 px column has no room for the sentence,
 * so the chip is a small round button with an arrow, and the sentence stays in the DOM (visually
 * hidden) as the link's text. The name, the link and the dismissal are the same in both forms.
 */
import { useState } from 'react';
import { useStore } from '../state/store';
import { updateLabel, updateAvailable } from '@webslicer/shared';
import { dismissedLatest, dismissUpdate, showUpdateNotice } from '../state/updateNotice';
import './UpdateChip.css';

export function UpdateChip({ compact = false }: { compact?: boolean }) {
  const status = useStore((s) => s.updateStatus);
  // read once on mount: `localStorage` is not reactive, and the store does not carry the dismissal
  const [dismissed, setDismissed] = useState(() => dismissedLatest());

  if (!status || !updateAvailable(status) || !showUpdateNotice(status, dismissed)) return null;
  const label = updateLabel(status);
  return (
    <div className={`update-chip ${compact ? 'compact' : ''}`} role="status" aria-label={label}>
      <a href={status.url} target="_blank" rel="noreferrer" title={`${label} – opens the release notes`}>
        <span className="update-chip-label">{label}</span>
      </a>
      <button
        className="update-chip-dismiss"
        aria-label="Dismiss the update notice"
        title="Dismiss the update notice"
        onClick={() => {
          dismissUpdate(status.latest);
          setDismissed(status.latest);
        }}
      >
        ✕
      </button>
    </div>
  );
}
