/**
 * Physical printers (print hosts) and G-code upload: OctoPrint, Moonraker (Klipper),
 * PrusaLink.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Agent, fetch as undiciFetch, FormData as UndiciFormData } from 'undici';
import { config } from '../config.js';
import type { HostType, PhysicalPrinter } from '@webslicer/shared';

function file(): string {
  return path.join(config.dataDir, 'physical_printers.json');
}

export async function listPrinters(): Promise<PhysicalPrinter[]> {
  try {
    return JSON.parse(await fs.readFile(file(), 'utf8')) as PhysicalPrinter[];
  } catch {
    return [];
  }
}

async function save(list: PhysicalPrinter[]): Promise<void> {
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(file(), JSON.stringify(list, null, 2));
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

export async function testPrinter(p: PhysicalPrinter): Promise<{ ok: boolean; message: string }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
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
    clearTimeout(t);
    if (!res.ok) return { ok: false, message: `HTTP ${res.status} ${res.statusText}` };
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const text =
      (json.text as string) ||
      (json.server as string) ||
      ((json.result as Record<string, unknown>)?.klipper_path ? 'Moonraker reachable' : '') ||
      (json.api ? `API ${json.api}` : 'reachable');
    return { ok: true, message: `Connected: ${text}` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function uploadToPrinter(
  p: PhysicalPrinter,
  gcodePath: string,
  filename: string,
  startPrint: boolean,
): Promise<{ ok: boolean; message: string }> {
  const data = await fs.readFile(gcodePath);
  const blob = new Blob([data], { type: 'application/octet-stream' });
  try {
    switch (p.type) {
      case 'octoprint': {
        const fd = new UndiciFormData();
        fd.append('file', blob, filename);
        fd.append('select', startPrint ? 'true' : 'false');
        fd.append('print', startPrint ? 'true' : 'false');
        const res = await hostFetch(p, `${p.host}/api/files/local`, { method: 'POST', headers: headers(p), body: fd });
        if (!res.ok) return { ok: false, message: `OctoPrint upload failed: HTTP ${res.status} ${await res.text().catch(() => '')}` };
        return { ok: true, message: `Uploaded ${filename} to OctoPrint${startPrint ? ' and started print' : ''}` };
      }
      case 'moonraker': {
        const fd = new UndiciFormData();
        fd.append('file', blob, filename);
        fd.append('root', 'gcodes');
        fd.append('print', startPrint ? 'true' : 'false');
        const res = await hostFetch(p, `${p.host}/server/files/upload`, { method: 'POST', headers: headers(p), body: fd });
        if (!res.ok) return { ok: false, message: `Moonraker upload failed: HTTP ${res.status} ${await res.text().catch(() => '')}` };
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
        });
        if (res.ok) return { ok: true, message: `Uploaded ${filename} to PrusaLink${startPrint ? ' and started print' : ''}` };
        if (res.status !== 404)
          return { ok: false, message: `PrusaLink upload failed: HTTP ${res.status} ${await res.text().catch(() => '')}` };
        // Fallback: legacy OctoPrint-compatible API
        const fd = new UndiciFormData();
        fd.append('file', blob, filename);
        fd.append('print', startPrint ? 'true' : 'false');
        const res2 = await hostFetch(p, `${p.host}/api/files/local`, { method: 'POST', headers: headers(p), body: fd });
        if (!res2.ok) return { ok: false, message: `PrusaLink upload failed: HTTP ${res2.status} ${await res2.text().catch(() => '')}` };
        return { ok: true, message: `Uploaded ${filename} to PrusaLink (legacy API)` };
      }
    }
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  return { ok: false, message: 'Unsupported host type' };
}
