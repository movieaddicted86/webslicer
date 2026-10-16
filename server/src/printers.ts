/**
 * Physical printers (print hosts) and G-code upload: OctoPrint, Moonraker (Klipper),
 * PrusaLink.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';

export type HostType = 'octoprint' | 'moonraker' | 'prusalink';

export interface PhysicalPrinter {
  id: string;
  name: string;
  type: HostType;
  /** base URL, e.g. http://192.168.1.50 */
  host: string;
  apiKey?: string;
  /** PrusaLink: username (default maker) for digest auth is not supported; API key only */
  presetName?: string;
  ignoreTls?: boolean;
}

function file(): string {
  return path.join(config.dataDir, 'physical_printers.json');
}

export function listPrinters(): PhysicalPrinter[] {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8')) as PhysicalPrinter[];
  } catch {
    return [];
  }
}

function save(list: PhysicalPrinter[]) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(list, null, 2));
}

export function upsertPrinter(p: Partial<PhysicalPrinter>): PhysicalPrinter {
  const list = listPrinters();
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
  save(list);
  return full;
}

export function deletePrinter(id: string): boolean {
  const list = listPrinters();
  const next = list.filter((p) => p.id !== id);
  if (next.length === list.length) return false;
  save(next);
  return true;
}

export function getPrinter(id: string): PhysicalPrinter | undefined {
  return listPrinters().find((p) => p.id === id);
}

function headers(p: PhysicalPrinter, extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...extra };
  if (p.apiKey) h['X-Api-Key'] = p.apiKey;
  return h;
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
    const res = await fetch(url, { headers: headers(p), signal: ctrl.signal });
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
  const data = fs.readFileSync(gcodePath);
  const blob = new Blob([data], { type: 'application/octet-stream' });
  try {
    switch (p.type) {
      case 'octoprint': {
        const fd = new FormData();
        fd.append('file', blob, filename);
        fd.append('select', startPrint ? 'true' : 'false');
        fd.append('print', startPrint ? 'true' : 'false');
        const res = await fetch(`${p.host}/api/files/local`, { method: 'POST', headers: headers(p), body: fd });
        if (!res.ok) return { ok: false, message: `OctoPrint upload failed: HTTP ${res.status} ${await res.text().catch(() => '')}` };
        return { ok: true, message: `Uploaded ${filename} to OctoPrint${startPrint ? ' and started print' : ''}` };
      }
      case 'moonraker': {
        const fd = new FormData();
        fd.append('file', blob, filename);
        fd.append('root', 'gcodes');
        fd.append('print', startPrint ? 'true' : 'false');
        const res = await fetch(`${p.host}/server/files/upload`, { method: 'POST', headers: headers(p), body: fd });
        if (!res.ok) return { ok: false, message: `Moonraker upload failed: HTTP ${res.status} ${await res.text().catch(() => '')}` };
        return { ok: true, message: `Uploaded ${filename} to Moonraker${startPrint ? ' and started print' : ''}` };
      }
      case 'prusalink': {
        // PrusaLink API v1 (Prusa firmware 4.7+/5.x): PUT /api/v1/files/{storage}/{path}
        const res = await fetch(`${p.host}/api/v1/files/usb/${encodeURIComponent(filename)}`, {
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
        if (res.status !== 404) return { ok: false, message: `PrusaLink upload failed: HTTP ${res.status} ${await res.text().catch(() => '')}` };
        // Fallback: legacy OctoPrint-compatible API
        const fd = new FormData();
        fd.append('file', blob, filename);
        fd.append('print', startPrint ? 'true' : 'false');
        const res2 = await fetch(`${p.host}/api/files/local`, { method: 'POST', headers: headers(p), body: fd });
        if (!res2.ok) return { ok: false, message: `PrusaLink upload failed: HTTP ${res2.status} ${await res2.text().catch(() => '')}` };
        return { ok: true, message: `Uploaded ${filename} to PrusaLink (legacy API)` };
      }
    }
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  return { ok: false, message: 'Unsupported host type' };
}
