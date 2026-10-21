/**
 * Send-gate rules (S1-b, T-026): may this G-code go to this print host?
 *
 * Why this exists: a physical printer is bound to a printer preset (`PhysicalPrinter.presetName`),
 * and the G-code of a job is sliced for the job's printer preset (`JobRecord.presets.printer`) – but
 * nothing compared the two. A file sliced for printer A was uploaded to, and could be started on,
 * printer B, whose start/end G-code, axis limits and nozzle it does not fit.
 *
 * The check is a pure function (job in, printer in, issues out) so the server gate, the send dialog
 * and the tests share one copy. Three outcomes:
 *
 * - **the same preset** (the name, or a system preset's alias) – no issue.
 * - **one preset is derived from the other** (one inherits the other, directly or through a chain) –
 *   `send.preset_derived` (**warn**): a user preset may change the nozzle, the axis limits or the
 *   start/end G-code of its parent, so the user has to confirm it.
 * - **anything else** – `send.preset_mismatch` (**block**). That includes two user presets that only
 *   share an ancestor ("My MK4S A" and "My MK4S B"): being siblings says nothing about nozzle or
 *   limits, and the gate exists for exactly that case. The send is refused unless the user overrides
 *   it with a written reason (the server answers 409 and logs the override in the audit log).
 *
 * `send.no_binding` (**warn**) covers a host without a preset: nothing can be compared.
 *
 * S1-c adds the G-code preflight (forbidden commands, temperatures, homing) to the same list: its
 * issues are `SendIssue`s with a `preflight.*` rule id and join the result of `checkSend`.
 */
import type { SendIssue } from '../types/jobs.js';

/** A printer preset and the names it is otherwise known by. */
export interface PresetLink {
  name: string;
  /** PrusaSlicer's alias of a system preset (its name without the " @variant" suffix) */
  alias?: string;
  /** user presets: the preset this one inherits from */
  inherits?: string;
}

/** The part of a job the check reads: the printer preset it was sliced for. */
export interface SendJob {
  presets: { printer: string };
}

/** The part of a print host the check reads. */
export interface SendTarget {
  id: string;
  name: string;
  /** printer preset the host is set up for; missing means "no binding" */
  presetName?: string;
}

/** The known printer presets – the same list the preset list is built from. */
export interface SendCheckOptions {
  presets?: readonly PresetLink[];
}

/** How a host's preset relates to the job's preset. */
export type SendMatch = 'exact' | 'derived' | 'none';

/** A preset's own names and the names of everything it inherits from, directly or transitively. */
export interface PresetLineage {
  /** the name itself and its alias – the same profile, not a relative */
  self: string[];
  /** the `inherits` chain, each entry with its alias, closest first */
  ancestors: string[];
}

/** Preset names are compared trimmed and case-insensitively; internal spacing stays significant. */
export function normalizePresetName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The names of the printer preset `name` and of its ancestors, each normalized-deduplicated.
 *
 * This is how the preset list treats names, too: a system preset is also reachable by its alias,
 * and a user preset stands on top of the presets it inherits from. Names that are not in `presets`
 * stand for themselves only.
 */
export function presetLineage(name: string, presets: readonly PresetLink[] = []): PresetLineage {
  const self: string[] = [];
  const ancestors: string[] = [];
  const seen = new Set<string>();
  const take = (into: string[], value: string): boolean => {
    const key = normalizePresetName(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    into.push(value.trim());
    return true;
  };

  let current = name.trim();
  if (current) take(self, current);
  // the alias belongs to the preset itself – it is the same profile under another name
  let entry = presets.find((p) => normalizePresetName(p.name) === normalizePresetName(current));
  if (self.length && entry?.alias) take(self, entry.alias);

  while (entry?.inherits?.trim()) {
    current = entry.inherits.trim();
    const added = take(ancestors, current);
    entry = presets.find((p) => normalizePresetName(p.name) === normalizePresetName(current));
    if (added && entry?.alias) take(ancestors, entry.alias);
    // a cycle or a dangling name ends the walk
    if (!added) break;
  }
  return { self, ancestors };
}

const lower = (names: readonly string[]): Set<string> => new Set(names.map(normalizePresetName));

/** Whether any name of `a` is one of `b`'s names. */
function overlaps(a: readonly string[], b: readonly string[]): boolean {
  const set = lower(b);
  return a.some((name) => set.has(normalizePresetName(name)));
}

/**
 * How the host's preset relates to the job's preset: the same profile, one derived from the other
 * in either direction, or unrelated (siblings included).
 */
export function sendMatch(jobName: string, boundName: string, options: SendCheckOptions = {}): SendMatch {
  const presets = options.presets ?? [];
  if (!jobName.trim() || !boundName.trim()) return 'none';
  const job = presetLineage(jobName, presets);
  const bound = presetLineage(boundName, presets);
  if (overlaps(job.self, bound.self)) return 'exact';
  // the job was sliced for a preset derived from the host's, or the host runs one derived from the job's
  if (overlaps(job.self, bound.ancestors) || overlaps(bound.self, job.ancestors)) return 'derived';
  return 'none';
}

/**
 * The issues of sending `job`'s output to `printer`.
 *
 * - `send.no_binding` (**warn**, nothing else): the host has no printer preset, so nothing can be compared.
 * - `send.preset_derived` (**warn**): one preset inherits the other.
 * - `send.preset_mismatch` (**block**): the host is bound to a preset with no such relation – the
 *   G-code was sliced for another machine.
 */
export function checkSend(job: SendJob, printer: SendTarget, options: SendCheckOptions = {}): SendIssue[] {
  const jobName = (job.presets.printer || '').trim();
  const boundName = (printer.presetName || '').trim();
  if (!boundName) {
    return [
      {
        rule: 'send.no_binding',
        severity: 'warn',
        message: `"${printer.name}" is not linked to a printer preset, so WebSlicer cannot check that this G-code fits this printer.`,
      },
    ];
  }
  const match = sendMatch(jobName, boundName, options);
  if (match === 'exact') return [];
  if (match === 'derived') {
    // which of the two sits on top of the other decides what the message says
    const job = presetLineage(jobName, options.presets);
    const bound = presetLineage(boundName, options.presets);
    const jobIsTheChild = overlaps(bound.self, job.ancestors);
    return [
      {
        rule: 'send.preset_derived',
        severity: 'warn',
        message: jobIsTheChild
          ? `This G-code was sliced for the printer preset "${jobName}", which is derived from "${boundName}" – the preset "${printer.name}" is set up for.` +
            ' A derived preset can change the nozzle, the axis limits or the start/end G-code.'
          : `"${printer.name}" is set up for the printer preset "${boundName}", which is derived from "${jobName}" – the preset this G-code was sliced for.` +
            ' A derived preset can change the nozzle, the axis limits or the start/end G-code.',
      },
    ];
  }
  return [
    {
      rule: 'send.preset_mismatch',
      severity: 'block',
      message:
        `This G-code was sliced for the printer preset "${jobName}", but "${printer.name}" is set up for ` +
        `"${boundName}". Start/end G-code, axis limits and nozzle of the other printer do not apply to this machine.`,
    },
  ];
}

/** The issues that stop a send (the gate refuses without an override). */
export function blockingIssues(issues: readonly SendIssue[]): SendIssue[] {
  return issues.filter((issue) => issue.severity === 'block');
}
