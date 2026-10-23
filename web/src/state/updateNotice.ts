/**
 * The update notice's client side (T-058): the server's answer, and which `latest` the user has
 * dismissed.
 *
 * Dismissing is remembered per `latest` value: a newer commit on the tracked branch is a new notice
 * even after an earlier one was dismissed. The store field is deliberately kept out of the slice
 * creators – it is one `localStorage` key and a small module, like the arrange settings.
 */
import type { UpdateStatus } from '../api';

const DISMISS_KEY = 'webslicer.updateDismissed';

/** The `latest` the user dismissed; `undefined` when nothing was dismissed (or storage is unavailable). */
export function dismissedLatest(): string | undefined {
  try {
    return localStorage.getItem(DISMISS_KEY) || undefined;
  } catch {
    return undefined;
  }
}

/** Remember that the notice for this `latest` was dismissed; a failure to store just shows it again. */
export function dismissUpdate(latest: string): void {
  try {
    localStorage.setItem(DISMISS_KEY, latest);
  } catch {
    /* private window: the notice is dismissed for this page only */
  }
}

/** Whether the notice is worth showing: something changed, and this `latest` was not dismissed. */
export function showUpdateNotice(status: UpdateStatus | undefined, dismissed: string | undefined): boolean {
  return !!status && status.enabled && (!!status.tag || status.behind > 0) && dismissed !== status.latest;
}
