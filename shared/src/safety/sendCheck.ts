/**
 * Send-gate rules (S1-b, T-026): may this G-code go to this print host?
 *
 * Why this exists: a physical printer is bound to a printer preset (`PhysicalPrinter.presetName`),
 * and the G-code of a job is sliced for the job's printer preset (`JobRecord.presets.printer`) – but
 * nothing compared the two. A file sliced for printer A was uploaded to, and could be started on,
 * printer B, whose start/end G-code, axis limits and nozzle it does not fit.
 *
 * The check is a pure function (job in, printer in, issues out) so the server gate, the send dialog
 * and the tests share one copy. Two severities:
 *
 * - **block** – the send is refused unless the user overrides it with a written reason (the server
 *   answers 409 and logs the override in the audit log).
 * - **warn** – the send may proceed, but the user has to confirm it.
 *
 * S1-c adds the G-code preflight (forbidden commands, temperatures, homing) to the same list: its
 * issues are `SendIssue`s with a `preflight.*` rule id and join the result of `checkSend`.
 */
import type { SendIssue } from '../types/jobs.js';

/** A printer's preset name and the names that mean the same preset. */
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

/** Names that may additionally stand for the job's and the target's preset. */
export interface SendCheckOptions {
  /** `presetEquivalents(job.presets.printer, presets)` */
  jobPresetNames?: readonly string[];
  /** `presetEquivalents(printer.presetName, presets)` */
  printerPresetNames?: readonly string[];
}

/**
 * Every name that means the printer preset `name`: the name itself, its alias and – for a user
 * preset – the names of the presets it inherits from, transitively (each with its alias).
 *
 * This is how the preset list treats names, too: a user printer preset that inherits
 * "Original Prusa MK4S HF0.4 nozzle" is that machine; a system preset is also reachable by its
 * alias. Names that are not in `presets` stand for themselves only.
 */
export function presetEquivalents(name: string, presets: readonly PresetLink[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (value: string): void => {
    const key = normalizePresetName(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(value.trim());
  };
  let current = name.trim();
  while (current && !seen.has(normalizePresetName(current))) {
    visit(current);
    const entry = presets.find((p) => normalizePresetName(p.name) === normalizePresetName(current));
    if (!entry) break;
    if (entry.alias) visit(entry.alias);
    current = entry.inherits?.trim() || '';
  }
  return out;
}

/** Preset names are compared trimmed and case-insensitively; internal spacing stays significant. */
export function normalizePresetName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The issues of sending `job`'s output to `printer`.
 *
 * - `send.preset_mismatch` (**block**): the host is bound to a printer preset and no name of that
 *   preset means the job's preset either – the G-code was sliced for another machine.
 * - `send.no_binding` (**warn**): the host has no printer preset, so nothing can be compared.
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
  if (samePreset(jobName, boundName, options)) return [];
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

/** Whether the job's preset and the host's preset are the same machine profile. */
export function samePreset(jobName: string, boundName: string, options: SendCheckOptions = {}): boolean {
  const job = new Set([jobName, ...(options.jobPresetNames ?? [])].map(normalizePresetName));
  for (const name of [boundName, ...(options.printerPresetNames ?? [])]) if (job.has(normalizePresetName(name))) return true;
  return false;
}

/**
 * Whether a bound host is set up for the job's printer preset – what the send dialog uses to pick
 * the printer to preselect. An unbound host never matches.
 */
export function sendMatches(job: SendJob, printer: SendTarget, options: SendCheckOptions = {}): boolean {
  const boundName = (printer.presetName || '').trim();
  return !!boundName && samePreset(job.presets.printer || '', boundName, options);
}

/** The issues that stop a send (the gate refuses without an override). */
export function blockingIssues(issues: readonly SendIssue[]): SendIssue[] {
  return issues.filter((issue) => issue.severity === 'block');
}
