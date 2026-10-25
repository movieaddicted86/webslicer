/**
 * Z-06: is the slice result on screen outdated because the plate no longer passes the checks?
 *
 * The Preview keeps a finished result (T-073), and when the plate or the configuration limits block a
 * slice that result no longer describes what would be printed. Both the panel (the banner) and the
 * 3D view (the greyed toolpaths) read this one answer, so they cannot disagree.
 *
 * A plain `sliceDirty` is *not* an outdated result: the plate is fine and a re-slice would succeed, so
 * the Preview keeps its colours and the "Slice again to update" note (see `PreviewPanel`).
 */
import { useStore } from './store';
import { useSliceGuard } from './useSliceGuard';

export function useOutdatedResult(): boolean {
  const guard = useSliceGuard();
  // a result exists only once a slice finished; while one runs the Preview shows its progress instead
  const hasResult = useStore((s) => s.job?.status === 'done');
  return hasResult && guard.blocking.length > 0;
}
