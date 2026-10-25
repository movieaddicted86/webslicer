/**
 * The slice guard of the current plater, for the panels: the same plate issues the store checks
 * synchronously plus the configuration limits, which are debounced (`useLimitIssues`) so typing in a
 * settings field does not re-run the check on every keystroke.
 *
 * The panels therefore show the guard the store enforces; the store itself computes it without the
 * debounce, so a click can never slip past a limit the panel has not caught up with yet.
 */
import { useMemo } from 'react';
import { plateIssues } from '../plater/plateCheck';
import { useStore } from './store';
import { useLimitIssues } from './useLimitIssues';
import { sliceGuardOf, type SliceGuard } from './sliceGuard';

export function useSliceGuard(): SliceGuard {
  const objects = useStore((s) => s.objects);
  const printer = useStore((s) => s.presets.printer.current);
  const print = useStore((s) => s.presets.print.current);
  const limits = useLimitIssues();
  const plate = useMemo(() => plateIssues(objects, printer, print), [objects, printer, print]);
  return useMemo(() => sliceGuardOf(plate, limits), [plate, limits]);
}
