/**
 * Physical printers (print hosts) and G-code upload: OctoPrint, Moonraker (Klipper),
 * PrusaLink.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Agent, fetch as undiciFetch, FormData as UndiciFormData } from 'undici';
import { config } from '../config.js';
import { readJson, writeJson } from '../storage/jsonStore.js';
import { API_KEY_MASK, printerHost, type PrinterInput } from '../validation/printers.js';
import type { HostType, PhysicalPrinter } from '@webslicer/shared';

function file(): string {
  return path.join(config.dataDir, 'physical_printers.json');
}

export async function listPrinters(): Promise<PhysicalPrinter[]> {
  // B7: a corrupt file is moved aside by the store instead of answering "no printers" and letting the
  // next save overwrite the only copy
  const { value } = await readJson<PhysicalPrinter[]>(file());
  return Array.isArray(value) ? value : [];
}

async function save(list: PhysicalPrinter[]): Promise<void> {
  await writeJson(file(), list); // B7: temp + rename, never a truncated file
}

/**
 * Serializes the read-modify-write of the printer list.
 *
 * The synchronous store was atomic for free: `readFileSync`…`writeFileSync` never yields, so two
 * requests could not interleave and lose one of the printers. With `await` in between they can, so
 * every change goes through this chain – same behaviour, still no blocking of the event loop.
 */
let writes: Promise<unknown> = Promise.resolve();

function update<T>(fn: () => Promise<T>): Promise<T> {
  const next = writes.then(fn, fn);
  writes = next.catch(() => undefined);
  return next;
}

/**
 * Normalize the safety limits of a printer: a missing, negative, non-finite or zero limit is "not
 * set", and an empty object is no safety block at all.
 */
function cleanSafety(safety: Partial<PhysicalPrinter>['safety']): PhysicalPrinter['safety'] {
  const limit = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
  const maxHotend = limit(safety?.maxHotend);
  const maxBed = limit(safety?.maxBed);
  return maxHotend === undefined && maxBed === undefined
    ? undefined
    : { ...(maxHotend !== undefined && { maxHotend }), ...(maxBed !== undefined && { maxBed }) };
}

export async function upsertPrinter(p: Partial<PhysicalPrinter>): Promise<PhysicalPrinter> {
  return update(async () => {
    const list = await listPrinters();
    const host = (p.host || '').trim().replace(/\/+$/, '');
    const full: PhysicalPrinter = {
      id: p.id || randomUUID(),
      name: (p.name || host || 'Printer').trim(),
      type: (p.type || 'octoprint') as HostType,
      host: /^https?:\/\//i.test(host) ? host : `http://${host}`,
      apiKey: p.apiKey || undefined,
      presetName: p.presetName || undefined,
      ignoreTls: !!p.ignoreTls,
      // S1-d: only a positive limit is stored; 0/undefined means "this machine has none"
      safety: cleanSafety(p.safety),
    };
    const i = list.findIndex((x) => x.id === full.id);
    if (i >= 0) list[i] = full;
    else list.push(full);
    await save(list);
    return full;
  });
}

export async function deletePrinter(id: string): Promise<boolean> {
  return update(async () => {
    const list = await listPrinters();
    const next = list.filter((p) => p.id !== id);
    if (next.length === list.length) return false;
    await save(next);
    return true;
  });
}

export async function getPrinter(id: string): Promise<PhysicalPrinter | undefined> {
  return (await listPrinters()).find((p) => p.id === id);
}

function headers(p: PhysicalPrinter, extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...extra };
  if (p.apiKey) h['X-Api-Key'] = p.apiKey;
  return h;
}

const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

/** fetch that optionally accepts self-signed certificates */
function hostFetch(p: PhysicalPrinter, url: string, init: Parameters<typeof undiciFetch>[1] = {}) {
  return undiciFetch(url, p.ignoreTls ? { ...init, dispatcher: insecureAgent } : init);
}

/** How long a printer test may take (S3): a host that does not answer quickly is down for us. */
export const PRINTER_TEST_TIMEOUT_MS = 5_000;

/**
 * Upload budget by file size (S3): one minute plus a second per 50 kB, capped at ten minutes.
 * A G-code of 10 MB gets ≈ 4.5 min, anything beyond ≈ 29 MB the hard maximum.
 */
export function uploadTimeoutMs(bytes: number): number {
  const size = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  return Math.min(10 * 60_000, 60_000 + Math.ceil(size / 50_000) * 1_000);
}

/**
 * The client-facing result of a failed host call. Only the fact that it timed out is named – the
 * remote detail (DNS text, TLS error, connection refused) goes to the server log (S3).
 */
function hostFailure(action: string, printer: PhysicalPrinter, e: unknown, timeoutMs: number): { ok: false; message: string } {
  const timedOut = (e as Error)?.name === 'AbortError';
  const detail = timedOut ? 'timed out' : ((e as Error)?.message ?? String(e));
  console.error(`[webslicer] ${action} ${printer.type} at ${printer.host} failed: ${detail}`);
  return {
    ok: false,
    message: timedOut ? `${action} failed: ${printer.type} did not answer within ${Math.round(timeoutMs / 1000)} s` : `${action} failed`,
  };
}

/**
 * Read and discard an error body. Its content may name internal hosts or paths (S3); it goes to the
 * server log only, never into the response.
 */
async function drain(res: { text: () => Promise<string> }): Promise<void> {
  const body = await res.text().catch(() => '');
  if (body) console.error(`[webslicer] printer host answered with a body: ${body.slice(0, 2_000)}`);
}

export async function testPrinter(p: PhysicalPrinter, timeoutMs = PRINTER_TEST_TIMEOUT_MS): Promise<{ ok: boolean; message: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let url: string;
    switch (p.type) {
      case 'octoprint':
        url = `${p.host}/api/version`;
        break;
      case 'moonraker':
        url = `${p.host}/server/info`;
        break;
      case 'prusalink':
        url = `${p.host}/api/version`;
        break;
    }
    const res = await hostFetch(p, url, { headers: headers(p), signal: ctrl.signal });
    if (!res.ok) {
      await drain(res);
      return { ok: false, message: `Connection failed: HTTP ${res.status}` };
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const text =
      (json.text as string) ||
      (json.server as string) ||
      ((json.result as Record<string, unknown>)?.klipper_path ? 'Moonraker reachable' : '') ||
      (json.api ? `API ${json.api}` : 'reachable');
    return { ok: true, message: `Connected: ${text}` };
  } catch (e) {
    return hostFailure('Connection test', p, e, timeoutMs);
  } finally {
    clearTimeout(timer);
  }
}

export async function uploadToPrinter(
  p: PhysicalPrinter,
  gcodePath: string,
  filename: string,
  startPrint: boolean,
  /** overrides the size-derived budget (a test passes a short one) */
  overrideTimeoutMs?: number,
): Promise<{ ok: boolean; message: string }> {
  const data = await fs.readFile(gcodePath);
  const blob = new Blob([data], { type: 'application/octet-stream' });
  // S3: every host call gets a hard deadline; a host that hangs must not keep the job open
  const timeoutMs = overrideTimeoutMs ?? uploadTimeoutMs(data.length);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const signal = ctrl.signal;
  try {
    switch (p.type) {
      case 'octoprint': {
        const fd = new UndiciFormData();
        fd.append('file', blob, filename);
        fd.append('select', startPrint ? 'true' : 'false');
        fd.append('print', startPrint ? 'true' : 'false');
        const res = await hostFetch(p, `${p.host}/api/files/local`, { method: 'POST', headers: headers(p), body: fd, signal });
        if (!res.ok) {
          await drain(res);
          return { ok: false, message: `OctoPrint upload failed: HTTP ${res.status}` };
        }
        return { ok: true, message: `Uploaded ${filename} to OctoPrint${startPrint ? ' and started print' : ''}` };
      }
      case 'moonraker': {
        const fd = new UndiciFormData();
        fd.append('file', blob, filename);
        fd.append('root', 'gcodes');
        fd.append('print', startPrint ? 'true' : 'false');
        const res = await hostFetch(p, `${p.host}/server/files/upload`, { method: 'POST', headers: headers(p), body: fd, signal });
        if (!res.ok) {
          await drain(res);
          return { ok: false, message: `Moonraker upload failed: HTTP ${res.status}` };
        }
        return { ok: true, message: `Uploaded ${filename} to Moonraker${startPrint ? ' and started print' : ''}` };
      }
      case 'prusalink': {
        // PrusaLink API v1 (Prusa firmware 4.7+/5.x): PUT /api/v1/files/{storage}/{path}
        const res = await hostFetch(p, `${p.host}/api/v1/files/usb/${encodeURIComponent(filename)}`, {
          method: 'PUT',
          headers: headers(p, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(data.length),
            Overwrite: '?1',
            'Print-After-Upload': startPrint ? '?1' : '?0',
          }),
          body: data,
          signal,
        });
        if (res.ok) return { ok: true, message: `Uploaded ${filename} to PrusaLink${startPrint ? ' and started print' : ''}` };
        if (res.status !== 404) {
          await drain(res);
          return { ok: false, message: `PrusaLink upload failed: HTTP ${res.status}` };
        }
        // Fallback: legacy OctoPrint-compatible API
        const fd = new UndiciFormData();
        fd.append('file', blob, filename);
        fd.append('print', startPrint ? 'true' : 'false');
        const res2 = await hostFetch(p, `${p.host}/api/files/local`, { method: 'POST', headers: headers(p), body: fd, signal });
        if (!res2.ok) {
          await drain(res2);
          return { ok: false, message: `PrusaLink upload failed: HTTP ${res2.status}` };
        }
        return { ok: true, message: `Uploaded ${filename} to PrusaLink (legacy API)` };
      }
    }
  } catch (e) {
    return hostFailure('Upload', p, e, timeoutMs);
  } finally {
    clearTimeout(timer);
  }
  return { ok: false, message: 'Unsupported host type' };
}

/**
 * The printer as the API sends it: the stored API key never travels back – it becomes the mask, plus
 * the `hasApiKey` flag the UI shows. One mask for every route (AC-6, q3-server-routes).
 */
export function maskPrinter(p: PhysicalPrinter): PhysicalPrinter {
  return { ...p, apiKey: p.apiKey ? API_KEY_MASK : undefined, hasApiKey: !!p.apiKey };
}

/** Every printer, masked. */
export async function listPrinterViews(): Promise<PhysicalPrinter[]> {
  return (await listPrinters()).map(maskPrinter);
}

/** Create a printer from a validated body and answer it masked. */
export async function createPrinter(input: PrinterInput): Promise<PhysicalPrinter> {
  return maskPrinter(await upsertPrinter(input));
}

/**
 * Update a printer from a validated body. The mask means "keep the stored key"; an empty key clears
 * it (the store turns `''` into "no key"). Undefined when there is no such printer.
 */
export async function updatePrinter(id: string, input: PrinterInput): Promise<PhysicalPrinter | undefined> {
  const existing = await getPrinter(id);
  if (!existing) return undefined;
  const apiKey = input.apiKey === undefined || input.apiKey === API_KEY_MASK ? existing.apiKey : input.apiKey;
  return maskPrinter(await upsertPrinter({ ...existing, ...input, apiKey, id: existing.id }));
}

/** Test an unsaved printer body (`POST /api/printers/test`). */
export async function testPrinterInput(input: PrinterInput): Promise<{ ok: boolean; message: string }> {
  return testPrinter({
    id: 'tmp',
    name: 'tmp',
    type: input.type || 'octoprint',
    host: printerHost(input.host),
    apiKey: input.apiKey || undefined,
    ignoreTls: !!input.ignoreTls,
  });
}
