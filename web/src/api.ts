export type PresetType = 'print' | 'filament' | 'printer' | 'sla_print' | 'sla_material';
export type OptionType =
  | 'float'
  | 'int'
  | 'percent'
  | 'float_or_percent'
  | 'string'
  | 'bool'
  | 'enum'
  | 'point'
  | 'point3'
  | 'points'
  | 'floats'
  | 'ints'
  | 'bools'
  | 'strings'
  | 'percents'
  | 'floats_or_percents';

export type Mode = 'simple' | 'advanced' | 'expert';
export type Config = Record<string, string>;

export interface OptionDef {
  key: string;
  label: string;
  tooltip: string;
  category: string;
  type: OptionType;
  default: string;
  enumValues?: string[];
  enumLabels?: string[];
  sidetext?: string;
  mode?: Mode;
  presetTypes: PresetType[];
  perExtruder?: boolean;
  nullable?: boolean;
  multiline?: boolean;
  gcode?: boolean;
  technology?: 'FFF' | 'SLA' | 'any';
}

export interface LayoutGroup {
  title: string;
  keys: string[];
}
export interface LayoutPage {
  title: string;
  groups: LayoutGroup[];
}
export interface TabLayout {
  presetType: PresetType;
  title: string;
  pages: LayoutPage[];
}

export interface Schema {
  slicerVersion: string;
  options: Record<string, OptionDef>;
  layout: TabLayout[];
  presetKeys: Record<PresetType, string[]>;
}

export interface PresetSummary {
  type: PresetType;
  name: string;
  system: boolean;
  vendorId?: string;
  vendorName?: string;
  inherits?: string;
  alias?: string;
  printerModel?: string;
  printerVariant?: string;
  technology?: 'FFF' | 'SLA';
  compatible?: boolean;
}

export interface ResolvedPreset extends PresetSummary {
  config: Config;
  overrides: Config;
}

export interface PrinterModel {
  vendorId: string;
  vendorName: string;
  id: string;
  name: string;
  variants: string[];
  technology: 'FFF' | 'SLA';
  family: string;
  bedModel?: string;
  bedTexture?: string;
  thumbnail?: string;
  defaultMaterials: string[];
}

export interface Vendor {
  id: string;
  name: string;
  configVersion?: string;
  models: PrinterModel[];
}

export interface InstalledPrinter {
  vendorId: string;
  modelId: string;
  variant: string;
}

export interface GcodeInfo {
  generator?: string;
  estimatedTime?: string;
  estimatedTimeSeconds?: number;
  estimatedFirstLayerTime?: string;
  filamentUsedMm?: number[];
  filamentUsedCm3?: number[];
  filamentUsedG?: number[];
  filamentCost?: number[];
  totalFilamentG?: number;
  totalFilamentCost?: number;
  sizeBytes: number;
}

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export interface JobRecord {
  id: string;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  percent: number;
  message: string;
  error?: string;
  outputName: string;
  technology: 'FFF' | 'SLA';
  info?: GcodeInfo;
  presets: { print: string; filaments: string[]; printer: string };
  objectNames: string[];
}

export interface JobEvent {
  type: 'progress' | 'log' | 'done' | 'error' | 'status';
  percent?: number;
  message?: string;
  line?: string;
  job?: JobRecord;
}

export type VolumeType = 'ModelPart' | 'ParameterModifier' | 'SupportEnforcer' | 'SupportBlocker' | 'NegativeVolume';

export interface SliceVolumeInput {
  modelId: string;
  name: string;
  type: VolumeType;
  transform: number[];
  config?: Config;
  extruder?: number;
}

export interface SliceObjectInput {
  modelId: string;
  name: string;
  transform: number[];
  config?: Config;
  extruder?: number;
  volumes?: SliceVolumeInput[];
}

export interface ProjectVolume {
  name: string;
  type: VolumeType;
  first: number;
  last: number;
  config: Config;
  extruder?: number;
}

export interface ProjectObject {
  name: string;
  config: Config;
  extruder?: number;
  volumes: ProjectVolume[];
}

export interface ThumbnailInput {
  width: number;
  height: number;
  format: 'PNG' | 'JPG' | 'QOI';
  /** base64 image data */
  data: string;
}

export interface SliceRequest {
  objects: SliceObjectInput[];
  /** previews rendered by the browser, embedded into the G-code by the server */
  thumbnails?: ThumbnailInput[];
  print: { name: string; config: Config };
  filaments: Array<{ name: string; config: Config }>;
  printer: { name: string; config: Config };
  outputName?: string;
  binaryGcode?: boolean;
}

export interface PhysicalPrinter {
  id: string;
  name: string;
  type: 'octoprint' | 'moonraker' | 'prusalink';
  host: string;
  apiKey?: string;
  hasApiKey?: boolean;
  presetName?: string;
  /** accept self-signed HTTPS certificates */
  ignoreTls?: boolean;
}

export interface ServerInfo {
  version: string;
  slicerVersion: string;
  slicerBin: string;
  resourcesDir?: string;
  vendors: number;
  maxJobs: number;
  maxUploadBytes: number;
}

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
  parseProject: (data: ArrayBuffer) =>
    fetch('/api/projects/parse', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: data }).then((r) =>
      handle<{ config: Config; objects: ProjectObject[] }>(r),
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
  sendToPrinter: (jobId: string, printerId: string, filename: string, startPrint: boolean) =>
    fetch(`/api/jobs/${jobId}/send`, jsonInit('POST', { printerId, filename, startPrint })).then((r) =>
      handle<{ ok: boolean; message: string }>(r),
    ),
  printers: () => fetch('/api/printers').then((r) => handle<PhysicalPrinter[]>(r)),
  addPrinter: (p: Partial<PhysicalPrinter>) => fetch('/api/printers', jsonInit('POST', p)).then((r) => handle<PhysicalPrinter>(r)),
  updatePrinter: (id: string, p: Partial<PhysicalPrinter>) =>
    fetch(`/api/printers/${id}`, jsonInit('PUT', p)).then((r) => handle<PhysicalPrinter>(r)),
  deletePrinter: (id: string) => fetch(`/api/printers/${id}`, { method: 'DELETE' }).then((r) => handle<{ ok: boolean }>(r)),
  testPrinter: (p: Partial<PhysicalPrinter>) =>
    fetch('/api/printers/test', jsonInit('POST', p)).then((r) => handle<{ ok: boolean; message: string }>(r)),
  testPrinterById: (id: string) => fetch(`/api/printers/${id}/test`, { method: 'POST' }).then((r) => handle<{ ok: boolean; message: string }>(r)),
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
        if (ev.type === 'done' || ev.type === 'error') es.close();
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

export interface LibraryEntry {
  name: string;
  path: string;
  dir: boolean;
  size?: number;
  mtime?: string;
  kind?: 'model' | 'project' | 'gcode' | 'other';
}

export const libraryApi = {
  list: (p: string) => fetch(`/api/library?path=${encodeURIComponent(p)}`).then((r) => handle<{ root: string; path: string; entries: LibraryEntry[] }>(r)),
  fileUrl: (p: string, download = false) => `/api/library/file?path=${encodeURIComponent(p)}${download ? '&download' : ''}`,
  fetchFile: async (p: string) => {
    const r = await fetch(`/api/library/file?path=${encodeURIComponent(p)}`);
    if (!r.ok) throw new Error(`cannot read ${p} (${r.status})`);
    return r.blob();
  },
  upload: (p: string, data: ArrayBuffer | Blob) =>
    fetch(`/api/library/file?path=${encodeURIComponent(p)}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: data }).then((r) =>
      handle<{ ok: boolean; path: string }>(r),
    ),
  mkdir: (p: string, name: string) => fetch('/api/library/mkdir', jsonInit('POST', { path: p, name })).then((r) => handle<{ ok: boolean; path: string }>(r)),
  remove: (p: string) => fetch(`/api/library/file?path=${encodeURIComponent(p)}`, { method: 'DELETE' }).then((r) => handle<{ ok: boolean }>(r)),
  saveProject: (p: string, name: string, req: SliceRequest) =>
    fetch(`/api/library/project?path=${encodeURIComponent(p)}&name=${encodeURIComponent(name)}`, jsonInit('POST', req)).then((r) =>
      handle<{ ok: boolean; path: string; size: number }>(r),
    ),
  saveGcode: (jobId: string, p: string, name: string) =>
    fetch('/api/library/gcode', jsonInit('POST', { jobId, path: p, name })).then((r) => handle<{ ok: boolean; path: string; size: number }>(r)),
};

export const autosaveApi = {
  save: (client: string, req: SliceRequest) => fetch(`/api/autosave/${client}`, jsonInit('PUT', req)).then((r) => handle<{ ok: boolean; savedAt: string }>(r)),
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
