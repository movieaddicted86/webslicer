/**
 * The one list of reasons a slice may not start: the plate checks (off the bed, skirt/brim outside the
 * print area, toolpath conflicts) and the configuration limits.
 *
 * The Prepare footer, the Preview and the store action `slice` all read this list, so no path that
 * starts a slice can miss a gate. The store computes it synchronously (the truth), the panels show the
 * same guard – with the limit checks debounced like the field hints (`useSliceGuard`).
 *
 * T-085 adds the printer preset's answer: its limits are blocking (in `limits`), and a preset nobody
 * answered for carries the `config.no_printer_safety` **warning** in the same list, so the footer shows
 * it without blocking. The slice action leaves that warning out of the job – the server only carries
 * blocking issues there.
 */
import { plateIssues, type PlateIssue } from '../plater/plateCheck';
import { issueTargetOf, limitIssuesOf, type IssueTarget, type PresetSafetyKey } from '../safety/configIssues';
import { presetSafetyState, presetSafetyWarnings, profileLabel } from '../safety/printerSafety';
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
  /** T-085: every preset's answer and the hosts that may have answered for one of them */
  printerSafety?: State['printerSafety'];
  physicalPrinters?: State['physicalPrinters'];
}

/** The guard of the current plater, computed now (the store runs this before it builds a request). */
export function currentSliceGuard(input: SliceGuardInput): SliceGuard {
  const plate = plateIssues(input.objects, input.presets.printer.current, input.presets.print.current);
  const answer = presetSafetyState(input.printerSafety, input.physicalPrinters ?? [], input.presets.printer.name);
  const safety: PresetSafetyKey = { presetName: answer.presetName, limits: answer.limits, label: profileLabel(answer.profile) };
  const limits = [
    ...limitIssuesOf(
      {
        print: input.presets.print.current,
        printer: input.presets.printer.current,
        filaments: input.presets.filament.map((f) => f.current),
      },
      input.extruderCount(),
      safety,
    ),
    ...presetSafetyWarnings(answer),
  ];
  return sliceGuardOf(plate, limits);
}
