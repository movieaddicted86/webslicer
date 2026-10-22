/**
 * The send gate (S1-c adds the G-code preflight to S1-b, T-026/T-031): may the finished G-code of a
 * job go to this print host?
 *
 * The decision itself is the pure `checkSend` of `@webslicer/shared` – the same function the send
 * dialog runs in the browser, so what the dialog shows is what the server enforces. This module adds
 * the two server-only parts: the printer presets with their aliases and inheritance (needed to tell a
 * derived preset from an unrelated one) and the audit entry of an accepted override.
 *
 * S1-c merges the **preflight** into the same list: the issues the scanner found in the finished file
 * (`gcode.forbidden_command`, `gcode.max_temp`, `gcode.no_homing`, …) are `SendIssue`s as well, so a
 * forbidden command blocks, can be overridden with a reason and is audited exactly like a preset
 * mismatch. The stored result is used when it was made with the current rule set; an older record (or
 * one from a job finished before S1-c) is scanned once here and not written back – the file may not
 * even exist any more.
 *
 * A **block** issue refuses the send with a 409 that carries the issues; the client repeats the call
 * with `override: true` and a written reason, which lands in `data/audit.log` – the MCP audit writer,
 * so there is no second log format. A **warn** issue does not stop the send: the dialog asks for a
 * confirmation, the server records the accepted issue in its answer.
 */
import {
  blockingIssues,
  checkSend,
  currentPreflight,
  maxTemperaturesOf,
  notScannedIssue,
  preflightSendIssues,
  printerLimitIssues,
  type PresetLink,
} from '@webslicer/shared';
import type { JobRecord, PhysicalPrinter, SendIssue, SendResult } from '@webslicer/shared';
import { loadBundles } from '../slicer/bundles.js';
import { listUserPresets, resolvePreset } from '../slicer/presets.js';
import { activeSchema } from './schema.js';
import { isBinaryGcode, machineLimitsOf, scanGcodeFile } from '../slicer/gcodePreflight.js';
import { readJobRequest } from '../jobs/persistence.js';
import { appendAudit } from '../mcp/audit.js';
import { ConflictError } from '../errors.js';
import { uploadToPrinter } from './printers.js';

/**
 * The printer presets as the check reads them: bundled system presets carry their alias, user presets
 * the preset they inherit from – the same data the preset list is built from.
 */
export function printerPresetLinks(): PresetLink[] {
  const system = loadBundles().presets.printer.map((p): PresetLink => ({ name: p.name, alias: p.alias }));
  const user = listUserPresets('printer').map((p): PresetLink => ({ name: p.name, inherits: p.config.inherits }));
  return [...system, ...user];
}

/** The send issues of a job and a print host, preset equivalence included. */
export function sendIssues(job: JobRecord, printer: PhysicalPrinter, presets: readonly PresetLink[] = printerPresetLinks()): SendIssue[] {
  return checkSend(job, printer, { presets });
}

/**
 * The preflight issues of a finished job. The stored result is used when the current rule set made it;
 * otherwise the output is scanned now (an old record, or a job from before S1-c). A record without an
 * output name or a binary output is a warn – v1 does not read `.bgcode`.
 *
 * The re-scan uses the target printer's ceilings when the send knows them (S1-d): the stored result
 * keeps the global catchers, the send gate judges the same file against the machine it goes to.
 */
export async function preflightIssues(
  job: JobRecord,
  gcodePath: string,
  limits: { hotendLimit?: number; bedLimit?: number } = {},
): Promise<SendIssue[]> {
  const stored = currentPreflight(job.info?.preflight);
  if (stored) return preflightSendIssues(stored);
  if (isBinaryGcode(job.outputName)) return [notScannedIssue('the output is binary G-code (.bgcode), which the preflight does not read')];
  const schema = await activeSchema();
  const printer = resolvePreset(schema, 'printer', job.presets.printer);
  return preflightSendIssues(await scanGcodeFile(gcodePath, machineLimitsOf(printer?.config ?? {}), limits));
}

/**
 * The `send.printer_limit` issues of a job for one host (S1-d): the temperatures the job's stored
 * request asks for against the safety profile of the physical printer.
 *
 * The request is read from the job directory instead of being copied into the record: the job is done,
 * and a missing request (an old record, a deleted file) means there is nothing to compare – not a
 * reason to refuse the send.
 */
export async function printerLimitSendIssues(job: JobRecord, printer: PhysicalPrinter): Promise<SendIssue[]> {
  if (!printer.safety) return [];
  // a job from before S1-d has no stored temperatures; its request is still on disk
  const temperatures =
    job.temperatures ??
    (await readJobRequest(job.id)
      .then(maxTemperaturesOf)
      .catch(() => undefined));
  if (!temperatures) return [];
  return printerLimitIssues(temperatures, printer.safety);
}

/** An accepted override as it goes into the audit log: job, host, the issues, the reason. */
export function auditOverride(
  job: JobRecord,
  printer: PhysicalPrinter,
  issues: readonly SendIssue[],
  reason: string,
  started = Date.now(),
): void {
  appendAudit({
    time: new Date().toISOString(),
    // no MCP token is involved in a send from the web app; the empty strings mark such an entry
    token: '',
    owner: '',
    tool: 'send_to_printer',
    params: {
      jobId: job.id,
      printerId: printer.id,
      printerName: printer.name,
      issues: issues.map((i) => ({ rule: i.rule, severity: i.severity, message: i.message })),
      reason,
    },
    ok: true,
    durationMs: Date.now() - started,
  });
}

/** What the send route knows about one upload. */
export interface SendRequest {
  job: JobRecord;
  printer: PhysicalPrinter;
  /** path of the finished G-code on the server */
  gcodePath: string;
  filename: string;
  startPrint: boolean;
  /** send despite a blocking issue */
  override?: boolean;
  /** why the override was given; the schema requires it with `override` */
  reason?: string;
}

/** The outcome of an accepted send. */
export type { SendResult };

/**
 * Gate and upload: refuses a blocked send, audits an override, uploads otherwise.
 *
 * The 409 body is `{ error, issues }` – `ConflictError.details` is what the app's error handler adds
 * to the message, so the client shows the same list the dialog computed.
 */
export async function sendJobOutput({ job, printer, gcodePath, filename, startPrint, override, reason }: SendRequest): Promise<SendResult> {
  const started = Date.now();
  // S1-d: the target machine's own limits, both on the sliced temperatures and (for an older record
  // without a stored preflight) on the file's `M104`/`M140` lines
  const safety = printer.safety;
  const limits = { hotendLimit: safety?.maxHotend, bedLimit: safety?.maxBed };
  // S1-c: the file's own issues join the preset issues – a block from either side needs the override
  const issues = [
    ...sendIssues(job, printer),
    ...(await printerLimitSendIssues(job, printer)),
    ...(await preflightIssues(job, gcodePath, limits)),
  ];
  const blocking = blockingIssues(issues);
  if (blocking.length && !override) {
    throw new ConflictError(blocking[0].message, { issues });
  }
  if (override && blocking.length && reason) auditOverride(job, printer, blocking, reason, started);
  const result = await uploadToPrinter(printer, gcodePath, filename, startPrint);
  return { ...result, issues };
}
