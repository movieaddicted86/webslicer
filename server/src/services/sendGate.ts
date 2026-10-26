/**
 * The send gate: may the finished G-code of a job go to this print host?
 *
 * The decision is the pure `checkSend` of `@webslicer/shared`, the same function the send dialog runs
 * in the browser. This module adds the server-only parts – printer presets with their aliases and
 * inheritance, and the audit entry of an accepted override – and merges the preflight findings into
 * the same issue list, so a forbidden command blocks and is audited exactly like a preset mismatch.
 * A **block** refuses with 409 and needs `override: true` plus a written reason; a **warn** only asks
 * for a confirmation.
 */
import {
  blockingIssues,
  checkSend,
  combinedSafety,
  maxTemperaturesOf,
  notScannedIssue,
  preflightSendIssues,
  printerLimitIssues,
  printerLimitsMissingIssue,
  profileOf,
  storedPreflightIssues,
  usablePreflight,
  configIssuesBeyond,
  configPreflightIssues,
  type PresetLink,
  type PreflightIssue,
} from '@webslicer/shared';
import type { JobRecord, PhysicalPrinter, SendIssue, SendResult } from '@webslicer/shared';
import { loadBundles } from '../slicer/bundles.js';
import { listUserPresets, resolvePreset } from '../slicer/presets.js';
import { activeSchema } from './schema.js';
import { isBinaryGcode, machineLimitsOf, scanGcodeFile } from '../slicer/gcodePreflight.js';
import { readJobRequest } from '../jobs/persistence.js';
import { appendAuditStrict } from './audit.js';
import { ConflictError, HttpError } from '../errors.js';
import { uploadToPrinter } from './printers.js';
import { printerSafetyRecord } from './printerSafety.js';

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
 * The preflight issues of a finished job for one target printer.
 *
 * The stored result is used when it was made with the current rule set *and* carries the temperature
 * maxima (N3); otherwise the output is scanned now. The scan always passes the target printer's
 * ceilings, so `gcode.max_temp` fires at the machine's limit. On top of that, the **maximum hotend
 * and bed temperature of the file** is compared with the printer's combined safety profile
 * (`send.printer_limit`) – the host's own limits and its preset's T-085 profile, whichever is
 * stricter. The stored scan only knows the global catchers, so `M104 S300` in a custom start G-code
 * is invisible to it but blocks a 260 °C machine here.
 *
 * The **config findings** (`info.preflight.config`, T-080/P-1) join both paths: they are the only
 * preflight a binary output has, since its body is never read. `storedPreflightIssues` drops a config
 * finding the file scan already reports, so one command is one issue.
 */
export async function preflightIssues(
  job: JobRecord,
  gcodePath: string,
  printer: PhysicalPrinter,
  machineLimits: Readonly<Record<string, string>> = {},
  safety: PhysicalPrinter['safety'] = printer.safety,
): Promise<SendIssue[]> {
  const limits = { hotendLimit: safety?.maxHotend, bedLimit: safety?.maxBed };
  const stored = usablePreflight(job.info?.preflight);
  if (stored) {
    return [...storedPreflightIssues(stored), ...printerLimitIssues(stored.maxTemperatures, safety)];
  }
  const configIssues = configPreflightIssues(job.info?.preflight);
  if (isBinaryGcode(job.outputName)) {
    return [notScannedIssue('the output is binary G-code (.bgcode), which the preflight does not read'), ...configIssues];
  }
  const result = await scanGcodeFile(gcodePath, machineLimits, limits);
  const file = preflightSendIssues(result) as PreflightIssue[];
  return [...file, ...configIssuesBeyond(job.info?.preflight, file), ...printerLimitIssues(result.maxTemperatures, safety)];
}

/**
 * The `send.printer_limit` issues of a job for one host (S1-d, T-085): the temperatures the job asks
 * for against the **combined** safety profile – the host's own limits and its preset's answer,
 * whichever is stricter.
 *
 * The record carries them since S1-d; a job from before has none, and its stored request – still in the
 * job directory – is read instead. An unreadable or missing request means there is nothing to compare,
 * not a reason to refuse the send.
 */
export async function printerLimitSendIssues(
  job: JobRecord,
  printer: PhysicalPrinter,
  safety: PhysicalPrinter['safety'] = printer.safety,
): Promise<SendIssue[]> {
  if (!safety) return [];
  // a job from before S1-d has no stored temperatures; its request is still on disk
  const temperatures =
    job.temperatures ??
    (await readJobRequest(job.id)
      .then(maxTemperaturesOf)
      .catch(() => undefined));
  if (!temperatures) return [];
  return printerLimitIssues(temperatures, safety);
}

/**
 * An accepted override as it goes into the audit log: job, host, the issues, the reason.
 *
 * Written with the **strict** writer (T-080, P-3): the override is only acceptable because it is
 * recorded, so a log that cannot take the entry ends the send – `sendJobOutput` answers 500 and
 * uploads nothing. MCP tool logging keeps the fail-soft writer.
 */
export function auditOverride(
  job: JobRecord,
  printer: PhysicalPrinter,
  issues: readonly SendIssue[],
  reason: string,
  started = Date.now(),
): void {
  appendAuditStrict({
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
  // S1-d/N3: the target machine's own limits, both on the sliced temperatures and on the file's
  // `M104`/`M140` lines (and their maxima, whether the result was stored or scanned)
  const schema = await activeSchema();
  const jobPreset = resolvePreset(schema, 'printer', job.presets.printer);
  // T-085: the preset's own answer joins the host's limits, the stricter one wins on both sides. Only a
  // host that names a preset has one – an unbound host keeps the T-080 behaviour it had.
  const profile = profileOf(await printerSafetyRecord(), printer.presetName);
  const safety = combinedSafety(printer.safety, profile);
  // S1-c: the file's own issues join the preset issues – a block from either side needs the override.
  // T-080/P-2: a host without a safety profile also only gets a warning – it may be all-metal, but the
  // owner should say so in the printer setup. T-085: the preset's answer silences that same question.
  const issues = [
    ...sendIssues(job, printer),
    ...(safety ? [] : printerLimitsMissingIssue(printer)),
    ...(await printerLimitSendIssues(job, printer, safety)),
    ...(await preflightIssues(job, gcodePath, printer, machineLimitsOf(jobPreset?.config ?? {}), safety)),
  ];
  const blocking = blockingIssues(issues);
  if (blocking.length && !override) {
    throw new ConflictError(blocking[0].message, { issues });
  }
  // the audit entry goes in before the upload, and an entry that cannot be written stops the send
  if (override && blocking.length && reason) {
    try {
      auditOverride(job, printer, blocking, reason, started);
    } catch (e) {
      const detail = (e as Error).message || String(e);
      console.error(`[webslicer] the audit log could not record a send override: ${detail}`);
      throw new HttpError(500, 'The override could not be written to the audit log, so the G-code was not sent.');
    }
  }
  const result = await uploadToPrinter(printer, gcodePath, filename, startPrint);
  return { ...result, issues };
}
