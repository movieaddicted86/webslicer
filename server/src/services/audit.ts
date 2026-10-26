/**
 * Audit log of the server (`docs/MCP-Concept.md` §5): one JSON line per security-relevant action in
 * `data/audit.log` – the MCP tool calls and the accepted send overrides (S1-b/S1-c). Parameters go in
 * as they came in, minus anything that looks like a secret and with long values cut off, so the log
 * can be handed to a human without leaking credentials.
 *
 * Moved out of `mcp/` (W3): `services/sendGate.ts` writes here too, so the writer belongs to the
 * service layer instead of the MCP transport.
 *
 * The file grows forever on a busy server, so it **rotates by size** (P-8): an append that would pass
 * `AUDIT_LOG_MAX_BYTES` first moves the current file to `audit.log.1`, shifts the older generations
 * down and drops the one past `AUDIT_LOG_KEEP_FILES`. Reading does not load the whole history:
 * `readAudit` reads a bounded tail of the current file with async fs, so a caller never blocks the
 * event loop on a 10 MB file.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

export interface AuditEntry {
  time: string;
  token: string;
  owner: string;
  tool: string;
  params?: unknown;
  ok: boolean;
  error?: string;
  durationMs: number;
}

/** Parameter names that never reach the log. */
const SECRET_KEY = /token|secret|password|passwd|authorization|api[-_]?key|credential/i;
const MAX_VALUE = 400;
const MAX_PARAMS = 4000;
/** How many bytes `readAudit` reads from the end of the file at most. */
const READ_TAIL_BYTES = 2 * 1024 * 1024;
/** How many entries `readAudit` returns when the caller names no count. */
const DEFAULT_MAX_ENTRIES = 1000;

/** Strip secrets and cut long strings, recursively. */
export function sanitizeParams(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') return typeof value === 'string' ? clip(value) : value;
  if (depth > 4) return '[…]';
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => sanitizeParams(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? '[redacted]' : sanitizeParams(v, depth + 1);
  }
  return out;
}

function clip(text: string): string {
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE)}…` : text;
}

function serialize(entry: AuditEntry): string {
  let line = JSON.stringify(entry);
  if (line.length > MAX_PARAMS) line = JSON.stringify({ ...entry, params: '[too large]' });
  return line;
}

/** The rotated file of a generation: `audit.log.1` is the newest of the old ones. */
function rotatedPath(file: string, n: number): string {
  return `${file}.${n}`;
}

/**
 * Move the current log aside once appending would take it past the limit, keeping the generations
 * `1` … `keepFiles`.
 *
 * Runs from the synchronous writer right before the append, so it costs one `stat` per entry. The
 * rename is atomic, so a reader never sees a half-written log.
 */
function rotateIfNeeded(file: string, incoming: number): void {
  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch {
    return; // no log yet – the first append creates it
  }
  // the file that receives this entry has to stay under the limit, so a rotation happens before the
  // line that would cross it
  if (size === 0 || size + incoming <= config.auditMaxBytes) return;
  // shift the generations down; the oldest one would land on `keepFiles + 1` and is dropped after
  for (let i = config.auditKeepFiles; i >= 1; i--) {
    try {
      fs.renameSync(rotatedPath(file, i), rotatedPath(file, i + 1));
    } catch {
      /* that generation does not exist yet */
    }
  }
  try {
    fs.renameSync(file, rotatedPath(file, 1));
  } catch {
    /* nothing to rotate */
  }
  try {
    fs.rmSync(rotatedPath(file, config.auditKeepFiles + 1), { force: true });
  } catch {
    /* already gone */
  }
}

/** The one write both variants use; a failure is the caller's to decide about. */
function writeEntry(entry: AuditEntry): void {
  const file = config.auditLog;
  const line = serialize(entry) + '\n';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  rotateIfNeeded(file, Buffer.byteLength(line));
  fs.appendFileSync(file, line, { mode: 0o600 });
}

/**
 * Log an entry, best effort (the MCP tool calls). A log that cannot be written must never break the
 * call it describes – the tool still ran, and refusing it afterwards would not undo that.
 */
export function appendAudit(entry: AuditEntry): void {
  try {
    writeEntry(entry);
  } catch {
    /* logging must never break a tool call */
  }
}

/**
 * Log an entry and **fail when that is impossible** (T-080, P-3): the send gate's override is only
 * acceptable because it is audited, so an override nobody could record must not happen at all. The
 * caller answers 500 and does not send. Throws the file system's error.
 */
export function appendAuditStrict(entry: AuditEntry): void {
  writeEntry(entry);
}

/** Parse the JSON lines of a text; a torn line is skipped. */
function parseLines(text: string, out: AuditEntry[]): void {
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as AuditEntry);
    } catch {
      /* skip a torn line */
    }
  }
}

/**
 * The newest entries of the current log, oldest first – so the last item is the latest entry.
 *
 * Bounded on purpose: the file may be `AUDIT_LOG_MAX_BYTES` large, and the callers want the recent
 * history, not all of it. A tail read that starts inside a line begins with half an entry; that piece
 * is dropped like any torn line.
 */
export async function readAudit(maxEntries = DEFAULT_MAX_ENTRIES): Promise<AuditEntry[]> {
  const file = config.auditLog;
  let text = '';
  try {
    const { size } = await fsp.stat(file);
    const length = Math.min(size, READ_TAIL_BYTES);
    const start = size - length;
    const handle = await fsp.open(file, 'r');
    try {
      const buf = Buffer.alloc(length);
      await handle.read(buf, 0, length, start);
      text = buf.toString('utf8');
    } finally {
      await handle.close();
    }
    // a tail that does not start at a line boundary begins with half an entry – drop that piece
    if (start > 0) {
      const nl = text.indexOf('\n');
      text = nl >= 0 ? text.slice(nl + 1) : '';
    }
  } catch {
    return [];
  }
  const out: AuditEntry[] = [];
  parseLines(text, out);
  return out.length > maxEntries ? out.slice(-maxEntries) : out;
}
