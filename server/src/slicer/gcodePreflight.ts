/**
 * The file side of the G-code preflight (S1-c, T-031): read a finished job output in chunks through
 * the pure scanner of `@webslicer/shared`.
 *
 * A real print file is tens of MB, so it is never read into one string: the scanner assembles the
 * lines across chunk boundaries itself, and the read buffer only has to be big enough for throughput.
 * The read is **asynchronous** (`fs.promises.open` + `filehandle.read`) on purpose: a 60 MB file takes
 * ~3.6 s of parsing, and the send gate scans inside a request – synchronous reads there would stall
 * every other request (SSE, other users, MCP) for that time. With `await` between the chunks the event
 * loop keeps running. Binary G-code is not read at all in v1 – it is reported as `gcode.not_scanned`.
 */
import fs from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { GcodePreflight, notScannedIssue, PREFLIGHT_VERSION, type PreflightIssue, type PreflightResult } from '@webslicer/shared';

/**
 * Read buffer of the scan; the scanner keeps the partial line itself. 256 KiB keeps one synchronous
 * `push` (the parsing of a chunk) at ~10 ms – the await after it is what lets other requests run in
 * between; a 1 MiB chunk parsed for ~45 ms and was visible as an event-loop delay.
 */
const SCAN_CHUNK = 256 * 1024;

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
 * able to answer, and a job record can outlive its files. Asynchronous – the caller awaits it and the
 * event loop stays free between the chunks (see the module doc).
 */
export async function scanGcodeFile(file: string, machineLimits: Readonly<Record<string, string>> = {}): Promise<PreflightResult> {
  if (isBinaryGcode(file)) return notScanned('the output is binary G-code (.bgcode), which the preflight does not read');
  let handle: fs.promises.FileHandle;
  try {
    handle = await fs.promises.open(file, 'r');
  } catch {
    return notScanned('the output file could not be read');
  }
  try {
    const scan = new GcodePreflight({ machineLimits });
    // a decoder keeps a multi-byte character together when the 1 MiB boundary cuts through it
    const decoder = new StringDecoder('utf8');
    const buf = Buffer.alloc(SCAN_CHUNK);
    for (;;) {
      const { bytesRead } = await handle.read(buf, 0, buf.length, null);
      if (bytesRead === 0) break;
      scan.push(decoder.write(buf.subarray(0, bytesRead)));
    }
    scan.push(decoder.end());
    return scan.finish();
  } catch {
    return notScanned('the output file could not be read');
  } finally {
    await handle.close().catch(() => undefined);
  }
}
