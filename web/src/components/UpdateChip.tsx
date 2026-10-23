/**
 * The quiet "Update available" chip in the top bar (T-058, Robert): one line, dismissible, never a
 * modal and never a toast. Clicking it opens the comparison (or release) page in a new tab; the ✕
 * hides it for this `latest` value (`state/updateNotice.ts` remembers that in `localStorage`).
 *
 * The chip renders nothing when the server is up to date, when the check is switched off or when the
 * user dismissed this `latest` – so a self-hosted install that is current sees no extra pixel.
 */
import { useState } from 'react';
import { useStore } from '../state/store';
import { updateLabel, updateAvailable } from '@webslicer/shared';
import { dismissedLatest, dismissUpdate, showUpdateNotice } from '../state/updateNotice';
import './UpdateChip.css';

export function UpdateChip() {
  const status = useStore((s) => s.updateStatus);
  // read once on mount: `localStorage` is not reactive, and the store does not carry the dismissal
  const [dismissed, setDismissed] = useState(() => dismissedLatest());

  if (!status || !updateAvailable(status) || !showUpdateNotice(status, dismissed)) return null;
  const label = updateLabel(status);
  return (
    <div className="update-chip" role="status" aria-label={label}>
      <a href={status.url} target="_blank" rel="noreferrer" title={`${label} – opens the release notes`}>
        {label}
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
