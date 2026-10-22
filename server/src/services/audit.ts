/**
 * Audit log of the server (`docs/MCP-Concept.md` §5): one JSON line per security-relevant action in
 * `data/audit.log` – the MCP tool calls and the accepted send overrides (S1-b/S1-c). Parameters go in
 * as they came in, minus anything that looks like a secret and with long values cut off, so the log
 * can be handed to a human without leaking credentials.
 *
 * Moved out of `mcp/` (W3): `services/sendGate.ts` writes here too, so the writer belongs to the
 * service layer instead of the MCP transport.
 */
import fs from 'node:fs';
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

export function appendAudit(entry: AuditEntry): void {
  try {
    fs.mkdirSync(path.dirname(config.auditLog), { recursive: true });
    fs.appendFileSync(config.auditLog, serialize(entry) + '\n', { mode: 0o600 });
  } catch {
    /* logging must never break a tool call */
  }
}

/** The audit log as entries (newest last); an unreadable line is skipped. */
export function readAudit(): AuditEntry[] {
  let text = '';
  try {
    text = fs.readFileSync(config.auditLog, 'utf8');
  } catch {
    return [];
  }
  const out: AuditEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as AuditEntry);
    } catch {
      /* skip a torn line */
    }
  }
  return out;
}
