/**
 * The live configuration limits of the plater (S1-e): the issues of the current presets, debounced so
 * typing does not run the checks on every keystroke (≤ 200 ms), memoised per config combination (the
 * cache in `configIssues.ts`) and otherwise the same shared computation the server runs.
 *
 * The first render computes at once – the panel must not show a stale "no issues" for a config it has
 * never seen – and later config changes settle after `LIMIT_DEBOUNCE_MS`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConfigIssue } from '@webslicer/shared';
import { useStore } from '../state/store';
import { configKeyOf, limitIssuesOf, type LimitPresets } from '../safety/configIssues';
import { presetSafetyState, profileLabel } from '../safety/printerSafety';

/** Long enough to batch a keystroke burst, short enough to feel immediate (task: ≤ 200 ms). */
export const LIMIT_DEBOUNCE_MS = 150;

/** The issues of the presets as the slice request would send them, for every component that asks. */
export function useLimitIssues(): ConfigIssue[] {
  const presets = useStore((s) => s.presets);
  const extruders = useStore((s) => s.extruderCount());
  const record = useStore((s) => s.printerSafety);
  const hosts = useStore((s) => s.physicalPrinters);
  const current = useMemo<LimitPresets>(
    () => ({ print: presets.print.current, printer: presets.printer.current, filaments: presets.filament.map((f) => f.current) }),
    [presets],
  );
  // T-085: the active printer preset's own ceilings – part of the key, so an answer re-runs the check
  const safety = useMemo(() => {
    const state = presetSafetyState(record, hosts, presets.printer.name);
    return { presetName: state.presetName, limits: state.limits, label: profileLabel(state.profile) };
  }, [record, hosts, presets.printer.name]);
  const key = useMemo(() => configKeyOf(current, extruders, safety), [current, extruders, safety]);
  // the key the shown issues belong to; `null` until the first compute, so the first render is synchronous
  const [shownKey, setShownKey] = useState<string | null>(null);
  const [issues, setIssues] = useState<ConfigIssue[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (issues !== null && shownKey === key) return;
    if (issues === null) {
      setIssues(limitIssuesOf(current, extruders, safety));
      setShownKey(key);
      return;
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setIssues(limitIssuesOf(current, extruders, safety));
      setShownKey(key);
    }, LIMIT_DEBOUNCE_MS);
    return () => clearTimeout(timer.current);
  }, [key, current, extruders, issues, shownKey, safety]);

  return issues ?? [];
}
