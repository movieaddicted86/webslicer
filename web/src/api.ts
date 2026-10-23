/**
 * The API client. Every type it speaks lives in `@webslicer/shared` (R-2) and is re-exported here,
 * so `import { type Schema } from './api'` keeps working and there is exactly one declaration of
 * each type – shared by the browser and the server.
 */
import type {
  Config,
  CustomGcode,
  InstalledPrinter,
  JobEvent,
  JobRecord,
  LibraryEntry,
  PhysicalPrinter,
  PresetSummary,
  PresetType,
  ProjectObject,
  ResolvedPreset,
  Schema,
  ServerInfo,
  SendIssue,
  SendResult,
  SliceRequest,
  Vendor,
} from '@webslicer/shared';

export type * from '@webslicer/shared';

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

/**
 * The send route answers a refused send with 409 and the issues of the gate. They are worth more to
 * the dialog than the message alone, so the error carries them.
 */
async function handleSend(res: Response): Promise<SendResult> {
  if (res.ok) return (await res.json()) as SendResult;
  let error = `${res.status} ${res.statusText}`;
  let issues: SendIssue[] = [];
  try {
    const j = (await res.json()) as { error?: string; issues?: SendIssue[] };
    if (j.error) error = j.error;
    issues = Array.isArray(j.issues) ? j.issues : [];
  } catch {
    /* no JSON body */
  }
  throw Object.assign(new Error(error), { issues });
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  info: () => fetch('/api/info').then((r) => handle<ServerInfo>(r)),
  schema: () => fetch('/api/schema').then((r) => handle<Schema>(r)),
  vendors: () => fetch('/api/vendors').then((r) => handle<Vendor[]>(r)),
  installedPrinters: () => fetch('/api/installed-printers').then((r) => handle<InstalledPrinter[]>(r)),
  setInstalledPrinters: (list: InstalledPrinter[]) =>
    fetch('/api/installed-printers', jsonInit('PUT', list)).then((r) => handle<InstalledPrinter[]>(r)),
  listPresets: (
    type: PresetType,
    opts: { printerName?: string; printerConfig?: Config; printName?: string; printConfig?: Config; all?: boolean },
  ) => fetch(`/api/presets/${type}/list`, jsonInit('POST', opts)).then((r) => handle<PresetSummary[]>(r)),
  getPreset: (type: PresetType, name: string) =>
    fetch(`/api/presets/${type}/${encodeURIComponent(name)}`).then((r) => handle<ResolvedPreset>(r)),
  savePreset: (type: PresetType, name: string, config: Config, inherits?: string) =>
    fetch(`/api/presets/${type}/${encodeURIComponent(name)}`, jsonInit('PUT', { config, inherits })).then((r) => handle<ResolvedPreset>(r)),
  deletePreset: (type: PresetType, name: string) =>
    fetch(`/api/presets/${type}/${encodeURIComponent(name)}`, { method: 'DELETE' }).then((r) => handle<{ ok: boolean }>(r)),
  uploadModel: (stl: ArrayBuffer, filename: string) =>
    fetch('/api/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(filename) },
      body: stl,
    }).then((r) => handle<{ id: string; name: string; triangles: number }>(r)),
  /** T-009: the server converts a STEP file with the slicer CLI and answers its binary STL. */
  convertStep: async (step: ArrayBuffer, filename: string): Promise<ArrayBuffer> => {
    const r = await fetch('/api/convert/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(filename) },
      body: step,
    });
    if (!r.ok) {
      let msg = `cannot convert ${filename} (${r.status})`;
      try {
        const j = (await r.json()) as { error?: string };
        if (j?.error) msg = j.error;
      } catch {
        /* not JSON */
      }
      throw new Error(msg);
    }
    return r.arrayBuffer();
  },
  parseProject: (data: ArrayBuffer) =>
    fetch('/api/projects/parse', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: data }).then((r) =>
      handle<{ config: Config; objects: ProjectObject[]; customGcodes?: CustomGcode[]; buildOrder: number[] }>(r),
    ),
  slice: (req: SliceRequest) => fetch('/api/slice', jsonInit('POST', req)).then((r) => handle<JobRecord>(r)),
  jobs: () => fetch('/api/jobs').then((r) => handle<JobRecord[]>(r)),
  job: (id: string) => fetch(`/api/jobs/${id}`).then((r) => handle<JobRecord>(r)),
  cancelJob: (id: string) => fetch(`/api/jobs/${id}/cancel`, { method: 'POST' }).then((r) => handle<{ ok: boolean }>(r)),
  deleteJob: (id: string) => fetch(`/api/jobs/${id}`, { method: 'DELETE' }).then((r) => handle<{ ok: boolean }>(r)),
  gcodeUrl: (id: string, download = false) => `/api/jobs/${id}/gcode${download ? '?download' : ''}`,
  gcodeText: (id: string) =>
    fetch(`/api/jobs/${id}/gcode`).then(async (r) => {
      if (!r.ok) throw new Error(`cannot load G-code (${r.status})`);
      return r.text();
    }),
  sendToPrinter: (jobId: string, printerId: string, filename: string, startPrint: boolean, override?: { reason: string }) =>
    fetch(
      `/api/jobs/${jobId}/send`,
      jsonInit('POST', { printerId, filename, startPrint, ...(override ? { override: true, reason: override.reason.trim() } : {}) }),
    ).then((r) => handleSend(r)),
  printers: () => fetch('/api/printers').then((r) => handle<PhysicalPrinter[]>(r)),
  addPrinter: (p: Partial<PhysicalPrinter>) => fetch('/api/printers', jsonInit('POST', p)).then((r) => handle<PhysicalPrinter>(r)),
  updatePrinter: (id: string, p: Partial<PhysicalPrinter>) =>
    fetch(`/api/printers/${id}`, jsonInit('PUT', p)).then((r) => handle<PhysicalPrinter>(r)),
  deletePrinter: (id: string) => fetch(`/api/printers/${id}`, { method: 'DELETE' }).then((r) => handle<{ ok: boolean }>(r)),
  testPrinter: (p: Partial<PhysicalPrinter>) =>
    fetch('/api/printers/test', jsonInit('POST', p)).then((r) => handle<{ ok: boolean; message: string }>(r)),
  testPrinterById: (id: string) =>
    fetch(`/api/printers/${id}/test`, { method: 'POST' }).then((r) => handle<{ ok: boolean; message: string }>(r)),
  export3mf: async (req: SliceRequest) => {
    const r = await fetch('/api/export/3mf', jsonInit('POST', req));
    if (!r.ok) throw new Error(`export failed (${r.status})`);
    return r.blob();
  },
  exportConfig: async (req: SliceRequest) => {
    const r = await fetch('/api/export/config', jsonInit('POST', req));
    if (!r.ok) throw new Error(`export failed (${r.status})`);
    return r.blob();
  },
  jobEvents: (id: string, onEvent: (ev: JobEvent) => void): (() => void) => {
    const es = new EventSource(`/api/jobs/${id}/events`);
    es.onmessage = (m) => {
      try {
        const ev = JSON.parse(m.data) as JobEvent;
        onEvent(ev);
        if (ev.type === 'done' || ev.type === 'error' || (ev.type === 'status' && ev.job?.status === 'cancelled')) es.close();
      } catch {
        /* ignore */
      }
    };
    es.onerror = () => {
      /* browser reconnects automatically; terminal states close the stream */
    };
    return () => es.close();
  },
};

export const libraryApi = {
  list: (p: string) =>
    fetch(`/api/library?path=${encodeURIComponent(p)}`).then((r) => handle<{ root: string; path: string; entries: LibraryEntry[] }>(r)),
  fileUrl: (p: string, download = false) => `/api/library/file?path=${encodeURIComponent(p)}${download ? '&download' : ''}`,
  fetchFile: async (p: string) => {
    const r = await fetch(`/api/library/file?path=${encodeURIComponent(p)}`);
    if (!r.ok) throw new Error(`cannot read ${p} (${r.status})`);
    return r.blob();
  },
  upload: (p: string, data: ArrayBuffer | Blob) =>
    fetch(`/api/library/file?path=${encodeURIComponent(p)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: data,
    }).then((r) => handle<{ ok: boolean; path: string }>(r)),
  mkdir: (p: string, name: string) =>
    fetch('/api/library/mkdir', jsonInit('POST', { path: p, name })).then((r) => handle<{ ok: boolean; path: string }>(r)),
  remove: (p: string) =>
    fetch(`/api/library/file?path=${encodeURIComponent(p)}`, { method: 'DELETE' }).then((r) => handle<{ ok: boolean }>(r)),
  saveProject: (p: string, name: string, req: SliceRequest) =>
    fetch(`/api/library/project?path=${encodeURIComponent(p)}&name=${encodeURIComponent(name)}`, jsonInit('POST', req)).then((r) =>
      handle<{ ok: boolean; path: string; size: number }>(r),
    ),
  saveGcode: (jobId: string, p: string, name: string) =>
    fetch('/api/library/gcode', jsonInit('POST', { jobId, path: p, name })).then((r) =>
      handle<{ ok: boolean; path: string; size: number }>(r),
    ),
};

export const autosaveApi = {
  /** `keepalive` lets the request outlive the page (the flush when the tab is hidden or closed). */
  save: (client: string, req: SliceRequest, keepalive = false) =>
    fetch(`/api/autosave/${client}`, { ...jsonInit('PUT', req), keepalive }).then((r) => handle<{ ok: boolean; savedAt: string }>(r)),
  info: async (client: string) => {
    const r = await fetch(`/api/autosave/${client}?info`);
    if (r.status === 404) return undefined;
    return handle<{ savedAt: string; size: number }>(r);
  },
  fetch: async (client: string) => {
    const r = await fetch(`/api/autosave/${client}`);
    if (!r.ok) throw new Error('no autosave');
    return r.blob();
  },
  remove: (client: string) => fetch(`/api/autosave/${client}`, { method: 'DELETE' }).then((r) => handle<{ ok: boolean }>(r)),
};

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
