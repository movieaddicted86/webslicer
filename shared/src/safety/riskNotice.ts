/**
 * The "print at your own risk" wording, in one place so the About dialog and the docs cannot drift.
 *
 * The long form lives in `README.md`, `SECURITY.md` and `docs/safety.md`; the app shows the short
 * sentence plus a link to the safety page, because a print that damages a machine is the operator's
 * risk and the checks only reduce it.
 */
export const RISK_NOTICE_URL = 'https://github.com/movieaddicted86/webslicer/blob/main/docs/safety.md';

/** The first sentence block of the three documents, verbatim, so the dialog and the docs read the same. */
export const RISK_NOTICE_SHORT =
  'Print at your own risk. WebSlicer slices and sends G-code to real machines. Check the temperatures and the plate ' +
  'yourself before a print starts; the safety checks reduce the risk but cannot remove it.';
