/**
 * The one list of reasons a slice may not start: the plate checks (off the bed, skirt/brim outside the
 * print area, toolpath conflicts) and the configuration limits.
 *
 * The Prepare footer, the Preview and the store action `slice` all read this list, so no path that
 * starts a slice can miss a gate. The store computes it synchronously (the truth), the panels show the
 * same guard – with the limit checks debounced like the field hints (`useSliceGuard`).
 */
import { plateIssues, type PlateIssue } from '../plater/plateCheck';
import { issueTargetOf, limitIssuesOf, type IssueTarget } from '../safety/configIssues';
import type { ConfigIssue } from '@webslicer/shared';
import type { State } from './types';

/** One reason the slice is refused, with the settings field a click should open where there is one. */
export interface SliceBlocker {
  message: string;
  /** the settings field of a limit blocker; the plate checks have none */
  target?: IssueTarget;
}

/** Everything the panels list and the action enforces. */
export interface SliceGuard {
  /** the plate's issues, blocking ones first */
  plate: PlateIssue[];
  /** the configuration limits of the presets */
  limits: ConfigIssue[];
  /** what stops the slice, plate first; empty means the plate may be sliced */
  blocking: SliceBlocker[];
  /** every blocking message in one line, for a tooltip */
  reason: string;
}

/** The guard of an already computed set of issues (pure; both the store and the hook end here). */
export function sliceGuardOf(plate: PlateIssue[], limits: ConfigIssue[]): SliceGuard {
  const blocking: SliceBlocker[] = [
    ...plate.filter((i) => i.severity === 'block').map((i) => ({ message: i.message })),
    ...limits.filter((i) => i.severity === 'block').map((i) => ({ message: i.message, target: issueTargetOf(i) })),
  ];
  return { plate, limits, blocking, reason: blocking.map((b) => b.message).join(' ') };
}

/** What the guard reads: the plater's objects, the presets and the extruder count of the request. */
export interface SliceGuardInput {
  objects: State['objects'];
  presets: State['presets'];
  extruderCount: () => number;
}

/** The guard of the current plater, computed now (the store runs this before it builds a request). */
export function currentSliceGuard(input: SliceGuardInput): SliceGuard {
  const plate = plateIssues(input.objects, input.presets.printer.current, input.presets.print.current);
  const limits = limitIssuesOf(
    {
      print: input.presets.print.current,
      printer: input.presets.printer.current,
      filaments: input.presets.filament.map((f) => f.current),
    },
    input.extruderCount(),
  );
  return sliceGuardOf(plate, limits);
}
