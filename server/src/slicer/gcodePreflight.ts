/**
 * The file side of the G-code preflight (S1-c, T-031): read a finished job output in chunks through
 * the pure scanner of `@webslicer/shared`.
 *
 * A real print file is tens of MB, so it is never read into one string: the scanner assembles the
 * lines across chunk boundaries itself, and the read buffer only has to be big enough for throughput.
 * Binary G-code is not read at all in v1 – it is reported as `gcode.not_scanned` instead.
 */
import fs from 'node:fs';
import { GcodePreflight, notScannedIssue, PREFLIGHT_VERSION, type PreflightIssue, type PreflightResult } from '@webslicer/shared';

/** Read buffer of the scan; the scanner keeps the partial line itself. */
const SCAN_CHUNK = 1 << 20;

/** The output is binary G-code (PrusaSlicer's `.bgcode` container), which v1 does not parse. */
export function isBinaryGcode(file: string): boolean {
  return file.toLowerCase().endsWith('.bgcode');
}

/** The `machine_max_*` keys of the job's printer preset – the firmware-limit rule compares against them. */
export function machineLimitsOf(config: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(config)) if (key.startsWith('machine_max_') && value) out[key] = value;
  return out;
}

/**
 * The preflight result of a file that was not scanned: the one warn issue and its count. It carries the
 * current version on purpose – "scanned and found one warning" is the result, so neither the preview
 * nor the send gate scans the file again. `line` 0 means there is no line behind it.
 */
function notScanned(reason: string): PreflightResult {
  const issue = notScannedIssue(reason) as PreflightIssue;
  return { version: PREFLIGHT_VERSION, issues: [{ ...issue, line: 0, text: '' }], counts: { 'gcode.not_scanned': 1 } };
}

/**
 * Scan a finished job output. A missing file is reported, not thrown: the send gate must still be
 * able to answer, and a job record can outlive its files.
 */
export function scanGcodeFile(file: string, machineLimits: Readonly<Record<string, string>> = {}): PreflightResult {
  if (isBinaryGcode(file)) return notScanned('the output is binary G-code (.bgcode), which the preflight does not read');
  let fd: number;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return notScanned('the output file could not be read');
  }
  try {
    const scan = new GcodePreflight({ machineLimits });
    const buf = Buffer.alloc(SCAN_CHUNK);
    let read = 0;
    while ((read = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      scan.push(buf.toString('utf8', 0, read));
    }
    const result = scan.finish();
    return result;
  } catch {
    return notScanned('the output file could not be read');
  } finally {
    fs.closeSync(fd);
  }
}
