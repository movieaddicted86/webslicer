/**
 * API smoke / behaviour-diff harness.
 *
 * Exercises every REST endpoint of `server/src/routes/api.ts`, `library.ts` and `projects.ts` against
 * a *running* server and writes one canonical JSON snapshot of all responses. Running the same script
 * against two servers (e.g. one built from `main`, one from a refactoring branch) and diffing the two
 * snapshots shows whether the refactoring changed observable behaviour.
 *
 * Why the normalisation step: UUIDs, timestamps and model-dependent numbers differ between two runs by
 * nature, so they are replaced by placeholders before the comparison. Everything that is a stable part
 * of the contract (status codes, error messages, `ok` flags, preset names, counts, enum values, the
 * content of the generated config and 3MF) is kept verbatim.
 *
 * Usage (repository root, no build step – tsx runs the TypeScript directly):
 *
 *   npx tsx server/scripts/api-smoke.ts
 *
 * Environment:
 *   SMOKE_URL          base URL of the server under test, default http://localhost:8080
 *   SMOKE_DATA_DIR     host path that is bind-mounted as /data. `installed_printers.json` and
 *                      `physical_printers.json` are written there directly so both runs start from the
 *                      same preset and printer state. Unset: the snapshot reports `setup.… = skipped`
 *                      and the responses may contain state left over in that container.
 *   SMOKE_LIBRARY_DIR  host path mounted as /library: used to seed a file directly and to verify that
 *                      an upload really lands in the mounted directory.
 *   SMOKE_OUT          file to write the snapshot to; default: stdout.
 *
 * The script exits 0 even when single requests fail: a failure belongs in the snapshot. It exits 2 only
 * when the server does not answer `GET /api/health` at all.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';

const BASE = (process.env.SMOKE_URL || 'http://localhost:8080').replace(/\/+$/, '');
const DATA_DIR = process.env.SMOKE_DATA_DIR || '';
const LIBRARY_DIR = process.env.SMOKE_LIBRARY_DIR || '';
const OUT = process.env.SMOKE_OUT || '';
const REQUEST_TIMEOUT_MS = 30_000;
/** The events stream stays open until the job ends; the test model needs a few seconds for that. */
const SSE_TIMEOUT_MS = 180_000;

/** The library is seeded with these samples on first start (`server/src/samples.ts`). */
const SAMPLE_CUBE = 'samples/calibration_cube_20mm.stl';
const SAMPLE_3MF = 'samples/prusaslicer_export.3mf';

/** Fixed presets, so both runs slice exactly the same thing. */
const PRINTER_PRESET = 'Original Prusa MK4S HF0.4 nozzle';
const PRINT_PRESET = '0.20mm SPEED @MK4S HF0.4';
const FILAMENT_PRESET = 'Prusament PLA @MK4S HF0.4';
const DEFAULT_PRESET = '- default FFF -';
const PRINTER_VENDOR = 'PrusaResearch';
const PRINTER_MODEL = 'MK4S';
const PRINTER_VARIANT = 'HF0.4';

/** 4x4 identity transform, column-major like the API expects it. */
const IDENTITY: number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Two ids that must never resolve: a non-uuid and a syntactically valid but unknown one. */
const UNKNOWN_IDS = ['not-an-id', '00000000-0000-0000-0000-000000000000'];
/** Shorter than the 8 characters `/api/autosave/:client` requires. */
const INVALID_CLIENT = 'ab';
const AUTOSAVE_CLIENT = 'smokeClient0001';
const TMP_DIR = 'smoke-tmp';
const TMP_FILE = `${TMP_DIR}/upload.bin`;
const SEED_FILE = 'smoke-seed.bin';
const LIBRARY_PROJECT = 'smoke-library-project';
const LIBRARY_PRESET = 'smoke-preset';
const GCODE_COPY = 'smoke_cube.gcode';

// ---------------------------------------------------------------------------
// snapshot types
// ---------------------------------------------------------------------------

interface EndpointResult {
  key: string;
  method: string;
  path: string;
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
  /** SSE only: the event `type` values in order, with consecutive duplicates collapsed */
  events?: string[];
  /** SSE only: the first characters of the wire format, so framing changes are visible */
  framing?: string;
}

interface Snapshot {
  url: string;
  note: string;
  setup: Record<string, string | boolean>;
  endpoints: EndpointResult[];
}

type PresetConfig = Record<string, string>;

interface PresetSummary {
  type: string;
  name: string;
  system?: boolean;
  alias?: string;
  compatible?: boolean;
  vendorId?: string;
}

interface ResolvedPreset {
  type: string;
  name: string;
  system?: boolean;
  inherits?: string;
  config: PresetConfig;
  overrides?: PresetConfig;
}

interface UploadedModel {
  id: string;
  name: string;
  triangles: number;
  vertices: number;
}

interface JobRecord {
  id: string;
  status: string;
  outputName: string;
  percent?: number;
  technology?: string;
  objectNames?: string[];
  presets?: { print: string; filaments: string[]; printer: string };
}

interface SliceObjectInput {
  modelId: string;
  name: string;
  transform: number[];
  instances?: number[][];
}

interface SliceRequest {
  objects: SliceObjectInput[];
  print: { name: string; config: PresetConfig };
  filaments: Array<{ name: string; config: PresetConfig }>;
  printer: { name: string; config: PresetConfig };
  outputName?: string;
}

interface ProjectRecord {
  id: string;
  owner?: string;
  printer?: { name: string };
  print?: { name: string };
  filaments?: Array<{ name: string }>;
  objects?: Array<{ id: string; modelId: string; name?: string; instances?: number[][] }>;
}

const endpoints: EndpointResult[] = [];
const setup: Record<string, string | boolean> = {};

/** Preset configs are read once and reused, so every request body is byte-identical in both runs. */
const presetConfig: { printer: PresetConfig; print: PresetConfig; filament: PresetConfig } = { printer: {}, print: {}, filament: {} };
/** The model the export/autosave/direct-slice requests reference. */
let cachedModel: UploadedModel | undefined;
/** The printer the "send to printer" check uses; created in `printerEndpoints`, deleted at the end. */
let smokePrinterId: string | undefined;
/** The job of the project lifecycle – the only finished job available for `/send`. */
let lifecycleJobId: string | undefined;

// ---------------------------------------------------------------------------
// requests
// ---------------------------------------------------------------------------

interface RequestOptions {
  method?: string;
  /** JSON bodies are serialised; strings and byte arrays are sent as they are */
  body?: unknown;
  headers?: Record<string, string>;
  /** the key recorded in the snapshot; defaults to `METHOD path` */
  key?: string;
  /** the path recorded in the snapshot; defaults to the request path – pass placeholders here */
  recordedPath?: string;
  /** custom body reader – for binary output and for bodies too large to record */
  readBody?: (res: Response) => Promise<unknown>;
  timeoutMs?: number;
  accept?: string;
}

/**
 * One recorded exchange. Connection errors, timeouts and unreadable bodies all become snapshot entries
 * instead of exceptions, so a broken endpoint never aborts the whole run.
 */
async function call(urlPath: string, opts: RequestOptions = {}): Promise<EndpointResult> {
  const method = opts.method || 'GET';
  const entry: EndpointResult = {
    key: opts.key || `${method} ${urlPath.split('?')[0]}`,
    method,
    path: opts.recordedPath || urlPath,
    status: 0,
  };
  log(`-> ${method} ${urlPath}`);
  let res: Response;
  try {
    res = await fetch(`${BASE}${urlPath}`, {
      method,
      headers: requestHeaders(opts),
      body: bodyOf(opts.body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    entry.body = { error: `request failed: ${(e as Error).message}` };
    endpoints.push(entry);
    log(`   !! ${(e as Error).message}`);
    return entry;
  }

  entry.status = res.status;
  const responseHeaders = pickHeaders(res);
  if (Object.keys(responseHeaders).length) entry.headers = responseHeaders;

  try {
    entry.body = opts.readBody ? await opts.readBody(res) : await readTextBody(res);
  } catch (e) {
    entry.body = { error: `could not read the response: ${(e as Error).message}` };
  }
  endpoints.push(entry);
  log(`   <- ${res.status}${typeof entry.body === 'string' ? ` ${entry.body.slice(0, 60)}` : ''}`);
  return entry;
}

/**
 * `Buffer`/`Uint8Array` do not satisfy the `BodyInit` union of the fetch types even though Node accepts
 * them at runtime, so the byte branch goes through one clearly named cast.
 */
function bodyOf(body: unknown): BodyInit | undefined {
  if (body === undefined) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return body as unknown as BodyInit;
  return JSON.stringify(body);
}

/**
 * A JSON object body is sent as JSON; everything else keeps the caller's headers. Express only parses
 * `express.json()`, so for these routes the content type is not optional decoration but what makes the
 * route see the body at all.
 */
function requestHeaders(opts: RequestOptions): Record<string, string> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.body !== undefined && !(opts.body instanceof Uint8Array) && typeof opts.body !== 'string') {
    headers['content-type'] = 'application/json';
  }
  if (opts.accept) headers.accept = opts.accept;
  return headers;
}

/** The headers the contract cares about; sizes and dates would only add run-dependent noise. */
function pickHeaders(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of ['content-type', 'content-disposition', 'cache-control']) {
    const value = res.headers.get(name);
    if (value !== null) out[name] = value;
  }
  return out;
}

async function readTextBody(res: Response): Promise<unknown> {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.startsWith('text/event-stream')) {
    // Only the framing is interesting, and the stream may stay open – read what is buffered.
    const reader = res.body?.getReader();
    if (!reader) return '<stream>';
    const first = await reader.read();
    await reader.cancel().catch(() => undefined);
    return `<stream: ${new TextDecoder().decode(first.value ?? new Uint8Array()).slice(0, 60)}>`;
  }
  const text = await res.text();
  if (contentType.includes('json')) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { error: `unparsable JSON: ${text.slice(0, 120)}` };
    }
  }
  return text;
}

/** Status and headers only – used where the body is a large file whose content is not comparable. */
async function readNothing(res: Response): Promise<unknown> {
  await res.body?.cancel().catch(() => undefined);
  return `<omitted: ${res.headers.get('content-type') || 'unknown'}>`;
}

/** Digest of the deterministic part of an archive (see `zipEntry`). */
function readArchiveEntry(entryName: string): (res: Response) => Promise<unknown> {
  return async (res) => {
    const buf = Buffer.from(await res.arrayBuffer());
    try {
      return { entry: entryName, sha256: createHash('sha256').update(zipEntry(buf, entryName)).digest('hex').slice(0, 16) };
    } catch (e) {
      return { entry: entryName, error: (e as Error).message };
    }
  };
}

/** A GET/POST whose body drives the next request; not recorded, `call` records the same route. */
async function getJson<T>(urlPath: string, body?: unknown): Promise<T | undefined> {
  try {
    const res = await fetch(`${BASE}${urlPath}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return (await res.json()) as T;
  } catch {
    return undefined;
  }
}

/**
 * Opens the SSE stream of a running job and records the observable parts of the protocol: the sequence
 * of event types, the first characters of the framing and the two headers that decide whether browsers
 * and proxies handle the stream correctly.
 */
async function callEvents(jobId: string): Promise<EndpointResult> {
  const entry: EndpointResult = { key: 'GET /api/jobs/:id/events', method: 'GET', path: '/api/jobs/<uuid>/events', status: 0 };
  log(`-> GET /api/jobs/${jobId}/events`);
  const types: string[] = [];
  let framing = '';
  try {
    const res = await fetch(`${BASE}/api/jobs/${jobId}/events`, {
      headers: { accept: 'text/event-stream' },
      signal: AbortSignal.timeout(SSE_TIMEOUT_MS),
    });
    entry.status = res.status;
    const headers = pickHeaders(res);
    entry.headers = { ...headers, 'cache-control': headers['cache-control'] ?? '<absent>' };
    if (!res.body) throw new Error('no response body');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finished = false;
    while (!finished) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const text = decoder.decode(chunk.value, { stream: true });
      // The framing is recorded before parsing, so a changed separator or field name shows up. It has to
      // be normalised per chunk: capping first would cut the job id mid-UUID and every run would differ.
      if (framing.length < 40) framing += normalizeText(text.slice(0, 40 - framing.length));
      buffer += text;
      let end = buffer.indexOf('\n\n');
      while (end >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const type = frameType(frame);
        if (type) types.push(type);
        if (type && isTerminal(type, frame)) finished = true;
        if (finished) break;
        end = buffer.indexOf('\n\n');
      }
    }
    await reader.cancel().catch(() => undefined);
  } catch (e) {
    entry.body = { error: `request failed: ${(e as Error).message}` };
  }
  entry.events = collapseDuplicates(types);
  entry.framing = normalizeFraming(framing);
  entry.body = entry.body ?? { frames: '<n>' };
  endpoints.push(entry);
  log(`   <- ${entry.status}, ${types.length} frames: ${entry.events.join(',')}`);
  return entry;
}

/** `data: {...}` frames carry a `type`; `: ping` is the keep-alive comment. */
function frameType(frame: string): string | undefined {
  if (frame.startsWith(':')) return ':ping';
  const m = /^data: (.*)$/m.exec(frame);
  if (!m) return undefined;
  try {
    const event = JSON.parse(m[1]) as { type?: unknown };
    return typeof event.type === 'string' ? event.type : undefined;
  } catch {
    return 'unparsable';
  }
}

/** The stream ends after `done` / `error`; a cancelled job reports it as a `status` frame. */
function isTerminal(type: string, frame: string): boolean {
  if (type === 'done' || type === 'error') return true;
  if (type !== 'status') return false;
  const m = /^data: (.*)$/m.exec(frame);
  if (!m) return false;
  try {
    return (JSON.parse(m[1]) as { job?: { status?: string } }).job?.status === 'cancelled';
  } catch {
    return false;
  }
}

/** A job emits one frame per slicer line; the sequence of kinds is the contract, not the repetition. */
function collapseDuplicates(values: string[]): string[] {
  return values.filter((value, i) => value !== values[i - 1]);
}

/**
 * The recorded framing is a prefix of the first frame, so it usually cuts a UUID in half; the halves
 * are masked as well, otherwise every run would differ at that one character.
 */
function normalizeFraming(framing: string): string {
  return normalizeText(framing).replace(/[0-9a-f]{4,}$/i, '<uuid>');
}

/** Polls `GET /api/jobs/:id` until the job is finished and returns the terminal status. */
async function waitForJob(id: string): Promise<string> {
  for (let i = 0; i < 900; i++) {
    const job = await getJson<JobRecord>(`/api/jobs/${id}`);
    if (!job) return 'unknown';
    if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') return job.status;
    await sleep(100);
  }
  return 'timeout';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Progress goes to stderr only, so stdout stays a clean JSON document. */
function log(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

// ---------------------------------------------------------------------------
// normalisation
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_TEXT_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/;
/** A timestamp inside a longer text, e.g. `PrusaSlicer 2.9.6 on 2026-10-21 at 18:10:23 UTC`. */
const ISO_TEXT_RE = /\d{4}-\d{2}-\d{2}(?:[T ]at )?[\d:.]+Z?/g;

/** Fields whose value depends on the clock, the machine or the model rather than on the contract. */
const VOLATILE_KEYS = new Set([
  'sizeBytes',
  'size',
  'durationMs',
  'percent',
  'layers',
  'maxZ',
  'layerHeight',
  'firstLayerHeight',
  'mtime',
  'savedAt',
  'filamentCost',
  'totalFilamentG',
  'totalFilamentCost',
]);

export function isVolatileKey(key: string): boolean {
  return (
    VOLATILE_KEYS.has(key) ||
    key.endsWith('At') || // createdAt, updatedAt, expiresAt, startedAt, finishedAt …
    key.startsWith('estimatedTime') || // estimatedTime, estimatedTimeSeconds, estimatedFirstLayerTime
    key.startsWith('filamentUsed') // filamentUsedMm, filamentUsedCm3, filamentUsedG …
  );
}

/** Replaces ids and timestamps inside any string, wherever they appear. */
export function normalizeString(value: string): string {
  if (ISO_RE.test(value) || UUID_RE.test(value)) return ISO_RE.test(value) ? '<ts>' : '<uuid>';
  return value.replace(UUID_TEXT_RE, '<uuid>').replace(ISO_TEXT_RE, '<ts>');
}

/** Log lines and error messages carry addresses and byte counts on top of ids and timestamps. */
export function normalizeText(value: string): string {
  return normalizeString(value)
    .replace(/0x[0-9a-f]+/gi, '<addr>')
    .replace(/\b\d{8,}(\.\d+)?\b/g, '<n>');
}

export function normalizeValue(value: unknown): unknown {
  if (typeof value === 'string') return normalizeString(value);
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === 'object') return normalizeObject(value as Record<string, unknown>);
  return value;
}

function normalizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isVolatileKey(key)) out[key] = '<n>';
    else if (key === 'error' || key === 'message' || key === 'line' || key === 'text')
      out[key] = typeof value === 'string' ? normalizeText(value) : normalizeValue(value);
    else out[key] = normalizeValue(value);
  }
  return out;
}

/** Sorted keys everywhere, so two snapshots can be compared line by line. */
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = sortDeep(source[key]);
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// setup – identical starting state for both runs
// ---------------------------------------------------------------------------

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

/**
 * `/api/installed-printers` is echoed by several responses, so both runs need the same list. It is
 * written through the bind-mounted data directory: an in-band `PUT` would have to repeat the previous
 * state of *that* server, which may differ between the two containers.
 */
function seedInstalledPrinters(): string {
  if (!DATA_DIR) return 'skipped';
  const file = path.join(DATA_DIR, 'installed_printers.json');
  const current = readJson<Array<{ vendorId: string; modelId: string; variant: string }>>(file) ?? [];
  const wanted = { vendorId: PRINTER_VENDOR, modelId: PRINTER_MODEL, variant: PRINTER_VARIANT };
  const merged = [...current.filter((p) => p.vendorId !== wanted.vendorId || p.modelId !== wanted.modelId), wanted];
  try {
    writeJson(file, merged);
    return 'seeded';
  } catch (e) {
    log(`   !! could not seed ${file}: ${(e as Error).message}`);
    return 'failed';
  }
}

/** Physical printers are user data; both runs start from an empty list. */
function seedPhysicalPrinters(): string {
  if (!DATA_DIR) return 'skipped';
  try {
    writeJson(path.join(DATA_DIR, 'physical_printers.json'), []);
    return 'emptied';
  } catch (e) {
    log(`   !! could not empty physical_printers.json: ${(e as Error).message}`);
    return 'failed';
  }
}

// ---------------------------------------------------------------------------
// the run
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log(`WebSlicer API smoke against ${BASE}`);
  if (!(await reachable())) {
    log(`   !! ${BASE}/api/health did not answer – nothing to compare`);
    process.exit(2);
  }
  setup.installedPrinters = seedInstalledPrinters();
  setup.physicalPrinters = seedPhysicalPrinters();
  setup.libraryDir = LIBRARY_DIR ? 'available' : 'skipped';

  await metadataEndpoints();
  await presetEndpoints();
  await modelEndpoints();
  await exportEndpoints();
  await libraryEndpoints();
  await printerEndpoints();
  await projectEndpoints();
  await sliceAndCancel();
  await jobErrorPaths();
  await autosaveEndpoints();
  await printerCleanup();

  writeSnapshot();
}

async function reachable(): Promise<boolean> {
  try {
    return (await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(5000) })).ok;
  } catch {
    return false;
  }
}

// ---- metadata --------------------------------------------------------------

async function metadataEndpoints(): Promise<void> {
  log('== metadata ==');
  await call('/api/health');
  await call('/api/info');
  const schema = await call('/api/schema');
  // ~250 kB of option metadata: the number of options is the stable part, the options themselves are
  // vendor bundle data that no refactoring of the routes can change.
  const schemaBody = schema.body as { options?: Record<string, unknown> } | undefined;
  if (schemaBody?.options) schema.body = { optionCount: Object.keys(schemaBody.options).length };

  const vendors = await call('/api/vendors');
  if (Array.isArray(vendors.body)) {
    vendors.body = (vendors.body as Array<{ id: string; name: string; configVersion?: string; models?: unknown[] }>).map((v) => ({
      id: v.id,
      name: v.name,
      configVersion: v.configVersion,
      modelCount: (v.models || []).length,
    }));
  }

  const asset = await call('/api/vendors/PrusaResearch/asset/coreonel_bed.stl', {
    key: 'GET /api/vendors/:vendor/asset/:file',
    recordedPath: '/api/vendors/<vendor>/asset/<file>',
    readBody: readNothing,
  });
  log(`   asset: ${JSON.stringify(asset.body)}`);
  await call('/api/vendors/nope/asset/nope.stl', {
    key: 'GET /api/vendors/:vendor/asset/:file (unknown)',
    recordedPath: '/api/vendors/nope/asset/nope.stl',
  });

  await call('/api/installed-printers');
  // An entry without vendor and model is dropped by the route – the answer equals the list above.
  await call('/api/installed-printers', {
    method: 'PUT',
    body: [{ vendorId: PRINTER_VENDOR, modelId: PRINTER_MODEL, variant: PRINTER_VARIANT }, { modelId: 'broken' }],
    key: 'PUT /api/installed-printers',
  });
}

// ---- presets ---------------------------------------------------------------

async function presetEndpoints(): Promise<void> {
  log('== presets ==');
  for (const type of ['print', 'filament', 'printer', 'sla_print', 'sla_material']) {
    // `all: true` keeps the listing independent of the installed printers.
    summarizePresetList(
      await call(`/api/presets/${type}/list`, { method: 'POST', body: { all: true }, key: `POST /api/presets/${type}/list` }),
    );
    await call(`/api/presets/${type}/default`, { key: `GET /api/presets/${type}/default` });
  }
  await call('/api/presets/bogus/list', { method: 'POST', body: {}, key: 'POST /api/presets/:type/list (unknown type)' });
  await call('/api/presets/nope/nothing', { key: 'GET /api/presets/:type/:name (unknown type)' });

  await loadPresetConfigs();
  await call(`/api/presets/printer/${encodeURIComponent(PRINTER_PRESET)}`, {
    key: 'GET /api/presets/printer/:name',
    recordedPath: '/api/presets/printer/<fixed preset>',
  });
  await call(`/api/presets/print/${encodeURIComponent(PRINT_PRESET)}`, {
    key: 'GET /api/presets/print/:name',
    recordedPath: '/api/presets/print/<fixed preset>',
  });
  await call(`/api/presets/filament/${encodeURIComponent(FILAMENT_PRESET)}`, {
    key: 'GET /api/presets/filament/:name',
    recordedPath: '/api/presets/filament/<fixed preset>',
  });
  await call('/api/presets/print/NoSuchUserPreset', { key: 'GET /api/presets/:type/:name (unknown name)' });

  await call(`/api/presets/print/${LIBRARY_PRESET}`, {
    method: 'PUT',
    // `no_such_option` is not in the schema and must be dropped by the route
    body: { config: { layer_height: '0.25', no_such_option: 'x' }, inherits: DEFAULT_PRESET },
    key: 'PUT /api/presets/:type/:name',
  });
  await call(`/api/presets/print/${LIBRARY_PRESET}`, { key: 'GET /api/presets/:type/:name (user preset)' });
  await call(`/api/presets/print/${LIBRARY_PRESET}`, { method: 'DELETE', key: 'DELETE /api/presets/:type/:name' });
  await call(`/api/presets/print/${LIBRARY_PRESET}`, { method: 'DELETE', key: 'DELETE /api/presets/:type/:name (second time)' });
  await call(`/api/presets/print/${LIBRARY_PRESET}`, { key: 'GET /api/presets/:type/:name (deleted)' });
  await call('/api/presets/print/-not-valid', {
    method: 'PUT',
    body: { config: {} },
    key: 'PUT /api/presets/:type/:name (invalid name)',
  });
  await call(`/api/presets/print/${LIBRARY_PRESET}`, { method: 'PUT', body: {}, key: 'PUT /api/presets/:type/:name (no config)' });
}

/** Reads the three preset configs once; every request body is built from them. */
async function loadPresetConfigs(): Promise<void> {
  const printer = await getJson<ResolvedPreset>(`/api/presets/printer/${encodeURIComponent(PRINTER_PRESET)}`);
  const print = await getJson<ResolvedPreset>(`/api/presets/print/${encodeURIComponent(PRINT_PRESET)}`);
  const filament = await getJson<ResolvedPreset>(`/api/presets/filament/${encodeURIComponent(FILAMENT_PRESET)}`);
  presetConfig.printer = printer?.config ?? {};
  presetConfig.print = print?.config ?? {};
  presetConfig.filament = filament?.config ?? {};
  setup.fixedPresets = !!(printer?.config && print?.config && filament?.config);
  if (!setup.fixedPresets) log(`   !! the fixed presets are missing – later requests use empty configs`);
}

/** The full listings are vendor bundle data; the count and the MK4S subset carry the contract. */
function summarizePresetList(entry: EndpointResult): void {
  if (!Array.isArray(entry.body)) return;
  const list = entry.body as PresetSummary[];
  entry.body = {
    count: list.length,
    defaults: list.filter((p) => p.name.startsWith('- default')).map((p) => p.name),
    mk4s: list.filter((p) => p.name.includes('MK4S') || (p.alias || '').includes('MK4S')).map((p) => p.name),
    incompatible: list.filter((p) => p.compatible === false).length,
  };
}

// ---- models ----------------------------------------------------------------

async function modelEndpoints(): Promise<void> {
  log('== models ==');
  const stl = await fetchSample(SAMPLE_CUBE);
  const upload = await call('/api/models', {
    method: 'POST',
    body: stl ?? Buffer.alloc(0),
    headers: { 'content-type': 'application/octet-stream', 'x-filename': 'calibration_cube_20mm.stl' },
  });
  if (!stl) setup.sampleModel = 'unavailable';

  await call('/api/models', {
    method: 'POST',
    body: Buffer.alloc(0),
    headers: { 'content-type': 'application/octet-stream' },
    key: 'POST /api/models (empty body)',
  });
  await call('/api/models', {
    method: 'POST',
    body: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
    headers: { 'content-type': 'application/octet-stream', 'x-filename': 'broken.stl' },
    key: 'POST /api/models (not an STL)',
  });

  // The first upload is used for the read/delete round trip; it is gone afterwards, so the model the
  // later routes reference is a second one that stays on the server for the rest of the run.
  const disposable = upload.body as UploadedModel | undefined;
  if (disposable?.id) {
    await call(`/api/models/${disposable.id}`, {
      key: 'GET /api/models/:id',
      recordedPath: '/api/models/<uuid>',
      readBody: readNothing,
    });
    await call(`/api/models/${disposable.id}`, {
      method: 'DELETE',
      key: 'DELETE /api/models/:id',
      recordedPath: '/api/models/<uuid>',
    });
    await call(`/api/models/${disposable.id}`, {
      key: 'GET /api/models/:id (deleted)',
      recordedPath: '/api/models/<uuid>',
    });
  }
  for (const id of UNKNOWN_IDS) {
    await call(`/api/models/${id}`, { key: `GET /api/models/:id (${id})`, recordedPath: `/api/models/${id}` });
    // Deleting an unknown model answers 200: the route is deliberately idempotent.
    await call(`/api/models/${id}`, { method: 'DELETE', key: `DELETE /api/models/:id (${id})`, recordedPath: `/api/models/${id}` });
  }
  await oversizedUpload();
}

/**
 * Streams `maxUploadBytes + 1 KiB` at `/api/models`. express stops reading at the limit and answers 413,
 * so the stream is abandoned instead of being sent completely – the check stays cheap.
 */
async function oversizedUpload(): Promise<void> {
  const info = await getJson<{ maxUploadBytes?: number }>('/api/info');
  const limit = Number(info?.maxUploadBytes) || 500 * 1024 * 1024;
  const total = limit + 1024;
  let produced = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (produced >= total) {
        controller.close();
        return;
      }
      const n = Math.min(1 << 20, total - produced);
      produced += n;
      controller.enqueue(new Uint8Array(n));
    },
  });
  // A streamed body requires `duplex: 'half'`, which the fetch types do not declare.
  const init: RequestInit & { duplex: 'half' } = {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', 'x-filename': 'oversized.stl' },
    body: stream,
    duplex: 'half',
    signal: AbortSignal.timeout(120_000),
  };
  const entry: EndpointResult = { key: 'POST /api/models (over maxUploadBytes)', method: 'POST', path: '/api/models', status: 0 };
  log(`-> POST /api/models (${total} bytes, limit ${limit})`);
  try {
    const res = await fetch(`${BASE}/api/models`, init);
    entry.status = res.status;
    entry.body = await readTextBody(res);
  } catch (e) {
    entry.body = { error: `request failed: ${(e as Error).message}` };
  }
  endpoints.push(entry);
  log(`   <- ${entry.status} after ${produced} bytes`);
}

/** The model the export, autosave and slice requests reference. */
async function uploadedModel(): Promise<UploadedModel | undefined> {
  if (cachedModel) return cachedModel;
  const stl = await fetchSample(SAMPLE_CUBE);
  if (!stl) return undefined;
  try {
    const res = await fetch(`${BASE}/api/models`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-filename': 'calibration_cube_20mm.stl' },
      body: stl as unknown as BodyInit,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.ok) cachedModel = (await res.json()) as UploadedModel;
  } catch {
    /* the caller reports the missing model */
  }
  return cachedModel;
}

// ---- exports ---------------------------------------------------------------

/**
 * `POST /api/export/3mf` and `POST /api/export/config` take the same body as `/api/slice`.
 * The config is recorded as the full text – it is deterministic, and a changed merge order would show
 * up there immediately, which is exactly what a route refactoring could break.
 */
async function exportEndpoints(): Promise<void> {
  log('== exports ==');
  const request = await sliceRequest('smoke_export', 'calibration_cube_20mm');
  if (request) {
    const config = await call('/api/export/config', { method: 'POST', body: request });
    if (typeof config.body === 'string') config.body = config.body.split('\n');
    await call('/api/export/3mf', {
      method: 'POST',
      body: request,
      readBody: readArchiveEntry('3D/3dmodel.model'),
    });
  } else {
    endpoints.push({
      key: 'POST /api/export/3mf',
      method: 'POST',
      path: '/api/export/3mf',
      status: 0,
      body: { error: 'no uploaded model' },
    });
  }
  await call('/api/export/3mf', { method: 'POST', body: {}, key: 'POST /api/export/3mf (empty body)' });
  await call('/api/export/config', { method: 'POST', body: {}, key: 'POST /api/export/config (empty body)' });
}

// ---- library ---------------------------------------------------------------

async function libraryEndpoints(): Promise<void> {
  log('== library ==');
  summarizeListing(await call('/api/library'));
  summarizeListing(await call('/api/library?path=samples', { key: 'GET /api/library?path=samples' }));

  // A file written straight into the mounted directory proves that /library is that directory.
  setup.librarySeed = seedLibraryFile();
  if (setup.librarySeed === 'seeded') {
    await call(`/api/library/file?path=${encodeURIComponent(SEED_FILE)}`, {
      key: 'GET /api/library/file (seeded on disk)',
      recordedPath: `/api/library/file?path=${SEED_FILE}`,
      readBody: readNothing,
    });
  }

  await call(`/api/library/file?path=${encodeURIComponent(SAMPLE_CUBE)}`, { key: 'GET /api/library/file', readBody: readNothing });
  await call(`/api/library/file?path=${encodeURIComponent(SAMPLE_CUBE)}&download=1`, {
    key: 'GET /api/library/file?download',
    readBody: readNothing,
  });
  await call('/api/library/file?path=does-not-exist.stl', { key: 'GET /api/library/file (missing)' });
  await call('/api/library?path=..%2F..', { key: 'GET /api/library (path escape)' });
  await call('/api/library/file?path=..%2F..%2Fetc%2Fpasswd', { key: 'GET /api/library/file (path escape)' });

  await call(`/api/library/file?path=${encodeURIComponent(TMP_FILE)}`, {
    method: 'PUT',
    body: Buffer.from([9, 8, 7, 6, 5]),
    headers: { 'content-type': 'application/octet-stream' },
    key: 'PUT /api/library/file',
    recordedPath: `/api/library/file?path=${TMP_FILE}`,
  });
  setup.libraryUploadOnDisk = LIBRARY_DIR ? (fs.existsSync(path.join(LIBRARY_DIR, TMP_FILE)) ? 'present' : 'missing') : 'skipped';
  summarizeListing(await call(`/api/library?path=${encodeURIComponent(TMP_DIR)}`, { key: 'GET /api/library?path=<tmp dir>' }));
  await call(`/api/library/file?path=${encodeURIComponent(TMP_FILE)}`, {
    key: 'GET /api/library/file (own upload)',
    recordedPath: `/api/library/file?path=${TMP_FILE}`,
    readBody: readNothing,
  });

  await call(`/api/library/file?path=${encodeURIComponent(TMP_FILE)}`, {
    method: 'PUT',
    body: Buffer.alloc(0),
    headers: { 'content-type': 'application/octet-stream' },
    key: 'PUT /api/library/file (empty body)',
  });
  await call('/api/library/file?path=..%2Fx', {
    method: 'PUT',
    body: Buffer.from([1]),
    headers: { 'content-type': 'application/octet-stream' },
    key: 'PUT /api/library/file (path escape)',
  });

  await call('/api/library/mkdir', { method: 'POST', body: { path: '', name: TMP_DIR }, key: 'POST /api/library/mkdir (exists)' });
  await call('/api/library/mkdir', { method: 'POST', body: { path: '', name: '..' }, key: 'POST /api/library/mkdir (invalid name)' });
  await call('/api/library/mkdir', { method: 'POST', body: { path: '..%2F', name: 'x' }, key: 'POST /api/library/mkdir (path escape)' });

  await call('/api/library/gcode', {
    method: 'POST',
    body: { jobId: 'unknown-job', path: '', name: 'smoke' },
    key: 'POST /api/library/gcode (unknown job)',
  });

  // Save the plater into the library; the same request body as the 3MF export.
  const request = await sliceRequest('smoke_library_project', 'calibration_cube_20mm');
  if (request) {
    await call(`/api/library/project?path=&name=${LIBRARY_PROJECT}`, {
      method: 'POST',
      body: request,
      key: 'POST /api/library/project',
      recordedPath: `/api/library/project?path=&name=${LIBRARY_PROJECT}`,
    });
    await call(`/api/library/file?path=${LIBRARY_PROJECT}.3mf`, {
      method: 'DELETE',
      key: 'DELETE /api/library/file (saved project)',
      recordedPath: `/api/library/file?path=${LIBRARY_PROJECT}.3mf`,
    });
  } else {
    endpoints.push({
      key: 'POST /api/library/project',
      method: 'POST',
      path: `/api/library/project?path=&name=${LIBRARY_PROJECT}`,
      status: 0,
      body: { error: 'no uploaded model' },
    });
  }
  await call('/api/library/project', { method: 'POST', body: { objects: [] }, key: 'POST /api/library/project (no objects)' });

  await call(`/api/library/file?path=${encodeURIComponent(TMP_DIR)}`, {
    method: 'DELETE',
    key: 'DELETE /api/library/file (non-empty directory)',
    recordedPath: `/api/library/file?path=${TMP_DIR}`,
  });
  await call(`/api/library/file?path=${encodeURIComponent(TMP_FILE)}`, {
    method: 'DELETE',
    key: 'DELETE /api/library/file',
    recordedPath: `/api/library/file?path=${TMP_FILE}`,
  });
  await call(`/api/library/file?path=${encodeURIComponent(TMP_FILE)}`, {
    method: 'DELETE',
    key: 'DELETE /api/library/file (second time)',
    recordedPath: `/api/library/file?path=${TMP_FILE}`,
  });
  await call(`/api/library/file?path=${encodeURIComponent(TMP_DIR)}`, {
    method: 'DELETE',
    key: 'DELETE /api/library/file (empty directory)',
    recordedPath: `/api/library/file?path=${TMP_DIR}`,
  });
  await call('/api/library/file?path=', { method: 'DELETE', key: 'DELETE /api/library/file (root)' });
  if (setup.librarySeed === 'seeded') {
    await call(`/api/library/file?path=${encodeURIComponent(SEED_FILE)}`, {
      method: 'DELETE',
      key: 'DELETE /api/library/file (seed cleanup)',
      recordedPath: `/api/library/file?path=${SEED_FILE}`,
    });
  }
}

function seedLibraryFile(): string {
  if (!LIBRARY_DIR) return 'skipped';
  try {
    fs.writeFileSync(path.join(LIBRARY_DIR, SEED_FILE), Buffer.from([1, 2, 3, 4]));
    return 'seeded';
  } catch (e) {
    log(`   !! could not write into ${LIBRARY_DIR}: ${(e as Error).message}`);
    return 'failed';
  }
}

/** Listings carry sizes and mtimes; the names, kinds and the reported path are the contract. */
function summarizeListing(entry: EndpointResult): void {
  const body = entry.body as { root?: string; path?: string; entries?: Array<Record<string, unknown>> } | undefined;
  if (!body || typeof body !== 'object' || !Array.isArray(body.entries)) return;
  entry.body = {
    root: body.root,
    path: body.path,
    entries: body.entries.map((e) => ({ name: e.name, dir: !!e.dir, kind: e.kind ?? 'dir' })),
  };
}

// ---- physical printers -----------------------------------------------------

/** Creates the printer the later `/send` check uses; `printerCleanup` deletes it again. */
async function printerEndpoints(): Promise<void> {
  log('== printers ==');
  summarizePrinters(await call('/api/printers'));

  const created = await call('/api/printers', {
    method: 'POST',
    body: { name: 'Smoke printer', type: 'prusalink', host: '127.0.0.1:9', apiKey: 'smoke-secret' },
  });
  smokePrinterId = (created.body as { id?: string } | undefined)?.id;

  if (smokePrinterId) {
    // The masked placeholder means "keep the stored key" – the documented behaviour of the route.
    await call(`/api/printers/${smokePrinterId}`, {
      method: 'PUT',
      body: { name: 'Smoke printer 2', apiKey: '••••••••' },
      key: 'PUT /api/printers/:id',
      recordedPath: '/api/printers/<uuid>',
    });
    // The host is a closed port, so "cannot reach it" is the deterministic outcome.
    normalizeConnectFailure(
      await call(`/api/printers/${smokePrinterId}/test`, {
        method: 'POST',
        key: 'POST /api/printers/:id/test',
        recordedPath: '/api/printers/<uuid>/test',
      }),
    );
  }
  normalizeConnectFailure(
    await call('/api/printers/test', {
      method: 'POST',
      body: { host: '127.0.0.1:9', type: 'octoprint' },
      key: 'POST /api/printers/test',
    }),
  );
  normalizeConnectFailure(await call('/api/printers/test', { method: 'POST', body: {}, key: 'POST /api/printers/test (no host)' }));

  await call('/api/printers/unknown', { method: 'PUT', body: { name: 'x' }, key: 'PUT /api/printers/:id (unknown)' });
  await call('/api/printers/unknown/test', { method: 'POST', key: 'POST /api/printers/:id/test (unknown)' });
  await call('/api/printers/unknown', { method: 'DELETE', key: 'DELETE /api/printers/:id (unknown)' });
  summarizePrinters(await call('/api/printers', { key: 'GET /api/printers (after the create)' }));
}

async function printerCleanup(): Promise<void> {
  if (!smokePrinterId) return;
  await call(`/api/printers/${smokePrinterId}`, {
    method: 'DELETE',
    key: 'DELETE /api/printers/:id',
    recordedPath: '/api/printers/<uuid>',
  });
  summarizePrinters(await call('/api/printers', { key: 'GET /api/printers (after the delete)' }));
}

/** The connection error text depends on the resolver; its shape (`ok: false`) is the contract. */
function normalizeConnectFailure(entry: EndpointResult): void {
  const body = entry.body as { ok?: boolean } | undefined;
  if (body && typeof body === 'object' && body.ok === false) entry.body = { ok: false, message: '<connect error>' };
}

/** Printer entries are mapped to the fields a diff can compare. */
function summarizePrinters(entry: EndpointResult): void {
  if (!Array.isArray(entry.body)) return;
  const list = entry.body as Array<{ name?: string; type?: string; host?: string; hasApiKey?: boolean }>;
  entry.body = list.map((p) => ({ name: p.name, type: p.type, host: p.host, hasApiKey: !!p.hasApiKey }));
}

// ---- server-side projects --------------------------------------------------

async function projectEndpoints(): Promise<void> {
  log('== projects ==');
  await projectParse();
  await projectCreate();

  const empty = await getJson<ProjectRecord>('/api/projects', { printer: PRINTER_PRESET, print: PRINT_PRESET });
  if (empty?.id) {
    // A project without objects cannot be sliced.
    await call(`/api/projects/${empty.id}/slice`, {
      method: 'POST',
      body: {},
      key: 'POST /api/projects/:id/slice (no objects)',
      recordedPath: '/api/projects/<uuid>/slice',
    });
  }

  for (const id of UNKNOWN_IDS) {
    await call(`/api/projects/${id}`, { key: `GET /api/projects/:id (${id})`, recordedPath: `/api/projects/${id}` });
    await call(`/api/projects/${id}/arrange`, {
      method: 'POST',
      body: {},
      key: `POST /api/projects/:id/arrange (${id})`,
      recordedPath: `/api/projects/${id}/arrange`,
    });
    await call(`/api/projects/${id}/models`, {
      method: 'POST',
      body: { libraryPath: SAMPLE_CUBE },
      key: `POST /api/projects/:id/models (${id})`,
      recordedPath: `/api/projects/${id}/models`,
    });
    await call(`/api/projects/${id}/slice`, {
      method: 'POST',
      body: {},
      key: `POST /api/projects/:id/slice (${id})`,
      recordedPath: `/api/projects/${id}/slice`,
    });
  }

  await call('/api/projects', {
    method: 'POST',
    body: { printer: PRINTER_PRESET, print: PRINT_PRESET, owner: 'x'.repeat(9 * 1024 * 1024) },
    key: 'POST /api/projects (over the 8mb JSON limit)',
    timeoutMs: 60_000,
  });

  await projectRoutes();
  await projectLifecycle();
}

/** `POST /api/projects/parse`: the browser's 3MF import, available without a browser. */
async function projectParse(): Promise<void> {
  const threeMf = await fetchSample(SAMPLE_3MF);
  const parsed = await call('/api/projects/parse', {
    method: 'POST',
    body: threeMf ?? Buffer.alloc(0),
    headers: { 'content-type': 'application/octet-stream' },
  });
  if (threeMf) normalizeParsedProject(parsed);
  else setup.sample3mf = 'unavailable';

  await call('/api/projects/parse', {
    method: 'POST',
    body: Buffer.alloc(0),
    headers: { 'content-type': 'application/octet-stream' },
    key: 'POST /api/projects/parse (empty body)',
  });
  await call('/api/projects/parse', {
    method: 'POST',
    body: Buffer.from('this is not a 3MF archive'),
    headers: { 'content-type': 'application/octet-stream' },
    key: 'POST /api/projects/parse (not a 3MF)',
  });
}

/** A parsed 3MF lists modifiers and their triangle ranges; the names and the counts are the contract. */
function normalizeParsedProject(entry: EndpointResult): void {
  const body = entry.body as { objects?: Array<{ name?: string; volumes?: Array<{ name?: string; type?: string }> }> } | undefined;
  if (!body || !Array.isArray(body.objects)) return;
  entry.body = {
    objects: body.objects.map((o) => ({
      name: o.name,
      volumes: (o.volumes || []).map((v) => ({ name: v.name, type: v.type })),
    })),
  };
}

async function projectCreate(): Promise<void> {
  await call('/api/projects', {
    method: 'POST',
    body: { printer: PRINTER_PRESET, print: PRINT_PRESET, filaments: [FILAMENT_PRESET], owner: 'smoke' },
  });
  await call('/api/projects', { method: 'POST', body: { printer: 42, print: PRINT_PRESET }, key: 'POST /api/projects (invalid printer)' });
  await call('/api/projects', {
    method: 'POST',
    body: { printer: 'NoSuchPrinter', print: 'NoSuchPrint' },
    key: 'POST /api/projects (unknown presets)',
  });
  await call('/api/projects', {
    method: 'POST',
    body: { printer: PRINTER_PRESET, print: PRINT_PRESET, filaments: { name: 'x' } },
    key: 'POST /api/projects (filaments not an array)',
  });
}

/** The routes of one project: add, arrange, read – plus their error paths. */
async function projectRoutes(): Promise<void> {
  const created = await getJson<ProjectRecord>('/api/projects', {
    printer: PRINTER_PRESET,
    print: PRINT_PRESET,
    filaments: [FILAMENT_PRESET],
    owner: 'smoke',
  });
  if (!created?.id) {
    endpoints.push({
      key: 'POST /api/projects/:id/models',
      method: 'POST',
      path: '/api/projects/<uuid>/models',
      status: 0,
      body: { error: 'no project was created' },
    });
    return;
  }
  const id = created.id;
  const at = (suffix: string): string => `/api/projects/${id}${suffix}`;
  const shown = (suffix: string): string => `/api/projects/<uuid>${suffix}`;

  await call(at(''), { key: 'GET /api/projects/:id', recordedPath: shown('') });
  await call(at('/models'), {
    method: 'POST',
    body: { libraryPath: SAMPLE_CUBE, copies: 2 },
    key: 'POST /api/projects/:id/models',
    recordedPath: shown('/models'),
  });
  await call(at(''), { key: 'GET /api/projects/:id (with objects)', recordedPath: shown('') });
  await call(at('/arrange'), { method: 'POST', body: {}, key: 'POST /api/projects/:id/arrange', recordedPath: shown('/arrange') });
  await call(at(''), { key: 'GET /api/projects/:id (arranged)', recordedPath: shown('') });

  await call(at('/models'), {
    method: 'POST',
    body: {},
    key: 'POST /api/projects/:id/models (no libraryPath)',
    recordedPath: shown('/models'),
  });
  await call(at('/models'), {
    method: 'POST',
    body: { libraryPath: 'does-not-exist.stl' },
    key: 'POST /api/projects/:id/models (missing file)',
    recordedPath: shown('/models'),
  });
  await call(at('/models'), {
    method: 'POST',
    body: { libraryPath: '../../etc/passwd' },
    key: 'POST /api/projects/:id/models (path escape)',
    recordedPath: shown('/models'),
  });
  await call(at('/models'), {
    method: 'POST',
    body: { libraryPath: SAMPLE_CUBE, copies: 0 },
    key: 'POST /api/projects/:id/models (copies 0)',
    recordedPath: shown('/models'),
  });
  // Slicing a project with objects starts a real job – that is the lifecycle below, not this route.
}

/**
 * The documented lifecycle: create → add the sample cube from the library → arrange → slice → follow the
 * job through the events stream → G-code, log, send, delete.
 */
async function projectLifecycle(): Promise<void> {
  log('== project lifecycle ==');
  const created = await getJson<ProjectRecord>('/api/projects', {
    printer: PRINTER_PRESET,
    print: PRINT_PRESET,
    filaments: [FILAMENT_PRESET],
    owner: 'smoke',
  });
  if (!created?.id) {
    log('   !! no project – the lifecycle is skipped');
    return;
  }
  const id = created.id;
  const at = (suffix: string): string => `/api/projects/${id}${suffix}`;
  const shown = (suffix: string): string => `/api/projects/<uuid>${suffix}`;

  const added = await call(at('/models'), {
    method: 'POST',
    body: { libraryPath: SAMPLE_CUBE, copies: 12 },
    key: 'POST /api/projects/:id/models (12 copies)',
    recordedPath: shown('/models'),
  });
  const modelId = (added.body as ProjectRecord | undefined)?.objects?.[0]?.modelId;
  if (modelId) cachedModel = { id: modelId, name: 'calibration_cube_20mm', triangles: 0, vertices: 0 };

  await call(at('/arrange'), {
    method: 'POST',
    body: {},
    key: 'POST /api/projects/:id/arrange (12 copies)',
    recordedPath: shown('/arrange'),
  });
  await call(at(''), { key: 'GET /api/projects/:id (12 copies arranged)', recordedPath: shown('') });

  const started = await call(at('/slice'), {
    method: 'POST',
    body: { outputName: 'smoke_project' },
    key: 'POST /api/projects/:id/slice',
    recordedPath: shown('/slice'),
  });
  const job = started.body as JobRecord | undefined;
  if (started.status !== 202 || !job?.id) {
    log(`   !! the project slice did not start a job (status ${started.status})`);
    return;
  }

  await callEvents(job.id);
  log(`   job ${job.id} finished as ${await waitForJob(job.id)}`);
  await call(`/api/jobs/${job.id}`, { key: 'GET /api/jobs/:id', recordedPath: '/api/jobs/<uuid>' });
  await call(`/api/jobs/${job.id}/gcode`, {
    key: 'GET /api/jobs/:id/gcode',
    recordedPath: '/api/jobs/<uuid>/gcode',
    readBody: readNothing,
  });
  await call(`/api/jobs/${job.id}/gcode?download=1`, {
    key: 'GET /api/jobs/:id/gcode?download',
    recordedPath: '/api/jobs/<uuid>/gcode?download',
    readBody: readNothing,
  });
  summarizeLog(await call(`/api/jobs/${job.id}/log`, { key: 'GET /api/jobs/:id/log', recordedPath: '/api/jobs/<uuid>/log' }));
  await call(`/api/jobs/${job.id}/cancel`, {
    method: 'POST',
    key: 'POST /api/jobs/:id/cancel (already finished)',
    recordedPath: '/api/jobs/<uuid>/cancel',
  });
  await call(`/api/jobs/${job.id}/send`, {
    method: 'POST',
    body: {},
    key: 'POST /api/jobs/:id/send (no printerId)',
    recordedPath: '/api/jobs/<uuid>/send',
  });
  if (smokePrinterId) {
    normalizeConnectFailure(
      await call(`/api/jobs/${job.id}/send`, {
        method: 'POST',
        body: { printerId: smokePrinterId, filename: 'smoke.gcode' },
        key: 'POST /api/jobs/:id/send',
        recordedPath: '/api/jobs/<uuid>/send',
      }),
    );
  }
  await call('/api/library/gcode', { method: 'POST', body: { jobId: job.id, path: '', name: 'smoke_cube' } });
  summarizeListing(await call('/api/library', { key: 'GET /api/library (after the G-code copy)' }));
  await call(`/api/library/file?path=${GCODE_COPY}`, {
    method: 'DELETE',
    key: 'DELETE /api/library/file (G-code copy)',
    recordedPath: `/api/library/file?path=${GCODE_COPY}`,
  });

  lifecycleJobId = job.id;
  log(`   lifecycle for project ${id} done`);
}

/** The slicer log mixes stable lines with timestamped internals; the stable ones are the contract. */
function summarizeLog(entry: EndpointResult): void {
  const text = typeof entry.body === 'string' ? entry.body : '';
  const stable = text
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('[')) // `[2026-…] [0x…] [info] …` is machine noise
    .map((line) => normalizeText(line));
  entry.body = { lines: stable.length, text: stable };
}

// ---- slice + cancel --------------------------------------------------------

/** `POST /api/slice` the way the browser does it, plus the cancel route on a job that is still running. */
async function sliceAndCancel(): Promise<void> {
  log('== slice + cancel ==');
  const request = await sliceRequest('smoke_direct', 'calibration_cube_20mm');
  if (!request) {
    endpoints.push({ key: 'POST /api/slice', method: 'POST', path: '/api/slice', status: 0, body: { error: 'no uploaded model' } });
    return;
  }

  await call('/api/slice', { method: 'POST', body: {}, key: 'POST /api/slice (empty body)' });
  await call('/api/slice', {
    method: 'POST',
    body: {
      objects: [{ modelId: request.objects[0].modelId, name: 'x', transform: [] }],
      print: request.print,
      printer: request.printer,
    },
    key: 'POST /api/slice (invalid transform)',
  });

  const started = await call('/api/slice', { method: 'POST', body: request });
  const job = started.body as JobRecord | undefined;
  if (started.status !== 202 || !job?.id) {
    log(`   !! the slice did not start a job (status ${started.status})`);
    return;
  }

  summarizeJobList(await call('/api/jobs', { key: 'GET /api/jobs' }));
  // The output does not exist yet: the route answers 404 while the job is queued or running.
  await call(`/api/jobs/${job.id}/gcode`, {
    key: 'GET /api/jobs/:id/gcode (still running)',
    recordedPath: '/api/jobs/<uuid>/gcode',
  });
  await call(`/api/jobs/${job.id}/cancel`, {
    method: 'POST',
    key: 'POST /api/jobs/:id/cancel',
    recordedPath: '/api/jobs/<uuid>/cancel',
  });
  await call(`/api/jobs/${job.id}/log`, {
    key: 'GET /api/jobs/:id/log (after the cancel)',
    recordedPath: '/api/jobs/<uuid>/log',
    readBody: readNothing,
  });
  await call(`/api/jobs/${job.id}`, { method: 'DELETE', key: 'DELETE /api/jobs/:id', recordedPath: '/api/jobs/<uuid>' });
  await call(`/api/jobs/${job.id}/cancel`, {
    method: 'POST',
    key: 'POST /api/jobs/:id/cancel (deleted)',
    recordedPath: '/api/jobs/<uuid>/cancel',
  });
  await call(`/api/jobs/${job.id}`, { key: 'GET /api/jobs/:id (deleted)', recordedPath: '/api/jobs/<uuid>' });
  await call(`/api/jobs/${job.id}/gcode`, {
    key: 'GET /api/jobs/:id/gcode (deleted job)',
    recordedPath: '/api/jobs/<uuid>/gcode',
  });
}

/**
 * The list grows with every run, so only its shape is comparable. The key list is pinned to the stable
 * keys: `startedAt`, `finishedAt` and `error` appear and disappear with the phase of a job, so which of
 * them the first record carries depends on how fast the slicer picked the job up – a race, not a
 * difference between two builds. Their *values* live in the record itself (see `GET /api/jobs/:id`), so
 * nothing a refactoring could change is normalised away here.
 */
function summarizeJobList(entry: EndpointResult): void {
  if (!Array.isArray(entry.body)) return;
  const list = entry.body as JobRecord[];
  const stableKeys = Object.keys(list[0] ?? {})
    .filter((k) => k !== 'startedAt' && k !== 'finishedAt' && k !== 'error')
    .sort();
  entry.body = { count: '<n>', recordKeys: stableKeys };
}

/** `/api/export/3mf`, `/api/export/config`, `/api/slice` and `/api/autosave` share this body. */
async function sliceRequest(outputName: string, objectName: string): Promise<SliceRequest | undefined> {
  const model = await uploadedModel();
  if (!model) return undefined;
  return {
    objects: [{ modelId: model.id, name: objectName, transform: IDENTITY }],
    print: { name: PRINT_PRESET, config: presetConfig.print },
    printer: { name: PRINTER_PRESET, config: presetConfig.printer },
    filaments: [{ name: FILAMENT_PRESET, config: presetConfig.filament }],
    outputName,
  };
}

// ---- job routes without a job ----------------------------------------------

/** Every job route with an unknown id. */
async function jobErrorPaths(): Promise<void> {
  log('== job error paths ==');
  const job = '/api/jobs/unknown-job';
  await call(job, { key: 'GET /api/jobs/:id (unknown)', recordedPath: job });
  await call(`${job}/events`, { key: 'GET /api/jobs/:id/events (unknown)', recordedPath: `${job}/events` });
  await call(`${job}/gcode`, { key: 'GET /api/jobs/:id/gcode (unknown)', recordedPath: `${job}/gcode` });
  await call(`${job}/log`, { key: 'GET /api/jobs/:id/log (unknown)', recordedPath: `${job}/log` });
  await call(`${job}/cancel`, { method: 'POST', key: 'POST /api/jobs/:id/cancel (unknown)', recordedPath: `${job}/cancel` });
  await call(`${job}/send`, {
    method: 'POST',
    body: { printerId: 'unknown-printer' },
    key: 'POST /api/jobs/:id/send (unknown)',
    recordedPath: `${job}/send`,
  });
  await call(job, { method: 'DELETE', key: 'DELETE /api/jobs/:id (unknown)', recordedPath: job });

  if (!lifecycleJobId) return;
  // The lifecycle job is only deleted here, so an id that really existed is covered once more.
  await call(`/api/jobs/${lifecycleJobId}`, {
    method: 'DELETE',
    key: 'DELETE /api/jobs/:id (lifecycle)',
    recordedPath: '/api/jobs/<uuid>',
  });
  await call(`/api/jobs/${lifecycleJobId}/log`, {
    key: 'GET /api/jobs/:id/log (deleted lifecycle job)',
    recordedPath: '/api/jobs/<uuid>/log',
  });
}

// ---- autosave --------------------------------------------------------------

async function autosaveEndpoints(): Promise<void> {
  log('== autosave ==');
  const request = await sliceRequest('smoke_autosave', 'calibration_cube_20mm');
  normalizeAutosave(
    await call(`/api/autosave/${AUTOSAVE_CLIENT}`, {
      method: 'PUT',
      body: request ?? { objects: [] },
      key: 'PUT /api/autosave/:client',
      recordedPath: '/api/autosave/<client>',
    }),
  );
  normalizeAutosave(
    await call(`/api/autosave/${AUTOSAVE_CLIENT}?info=1`, {
      key: 'GET /api/autosave/:client?info',
      recordedPath: '/api/autosave/<client>?info',
    }),
  );
  await call(`/api/autosave/${AUTOSAVE_CLIENT}`, {
    key: 'GET /api/autosave/:client',
    recordedPath: '/api/autosave/<client>',
    readBody: readNothing,
  });

  await call(`/api/autosave/${INVALID_CLIENT}`, { key: 'GET /api/autosave/:client (invalid client)', recordedPath: '/api/autosave/ab' });
  await call(`/api/autosave/${INVALID_CLIENT}`, {
    method: 'PUT',
    body: {},
    key: 'PUT /api/autosave/:client (invalid client)',
    recordedPath: '/api/autosave/ab',
  });
  await call(`/api/autosave/${AUTOSAVE_CLIENT}`, {
    method: 'PUT',
    body: {},
    key: 'PUT /api/autosave/:client (invalid request)',
    recordedPath: '/api/autosave/<client>',
  });
  await call(`/api/autosave/${AUTOSAVE_CLIENT}`, {
    method: 'DELETE',
    key: 'DELETE /api/autosave/:client',
    recordedPath: '/api/autosave/<client>',
  });
  await call(`/api/autosave/${AUTOSAVE_CLIENT}`, { key: 'GET /api/autosave/:client (deleted)', recordedPath: '/api/autosave/<client>' });
  await call(`/api/autosave/${AUTOSAVE_CLIENT}`, {
    method: 'DELETE',
    key: 'DELETE /api/autosave/:client (second time)',
    recordedPath: '/api/autosave/<client>',
  });
}

function normalizeAutosave(entry: EndpointResult): void {
  const body = entry.body as Record<string, unknown> | undefined;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) out[key] = isVolatileKey(key) ? '<n>' : value;
  entry.body = out;
}

// ---- helpers and output ----------------------------------------------------

/** Reads a file out of the running server's library (the sample models are seeded there). */
async function fetchSample(relPath: string): Promise<Buffer | undefined> {
  try {
    const res = await fetch(`${BASE}/api/library/file?path=${encodeURIComponent(relPath)}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return undefined;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return undefined;
  }
}

/** Reads one entry of a ZIP archive without pulling in a dependency. */
export function zipEntry(buf: Buffer, name: string): Buffer {
  const signature = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  let offset = buf.indexOf(signature);
  while (offset >= 0) {
    const method = buf.readUInt16LE(offset + 8);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    if (buf.subarray(offset + 30, offset + 30 + nameLen).toString('utf8') === name) {
      const data = buf.subarray(offset + 30 + nameLen + extraLen);
      return method === 0 ? data : zlib.inflateRawSync(data);
    }
    offset = buf.indexOf(signature, offset + 4);
  }
  throw new Error(`no "${name}" entry in the archive`);
}

function writeSnapshot(): void {
  const snapshot: Snapshot = {
    url: BASE.replace(/:\d+$/, ':<port>'),
    note: 'ids, timestamps and model-dependent numbers are normalised – see server/scripts/api-smoke.ts',
    setup,
    endpoints: endpoints.map((entry) => ({ ...entry, body: normalizeValue(entry.body) })),
  };
  const json = `${JSON.stringify(sortDeep(snapshot), null, 2)}\n`;
  if (OUT) {
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
    fs.writeFileSync(OUT, json);
    log(`\n${endpoints.length} exchanges written to ${OUT}`);
  } else {
    process.stdout.write(json);
    log(`\n${endpoints.length} exchanges written to stdout`);
  }
}

try {
  await main();
} catch (e) {
  // A failure of the harness itself must not lose the exchanges recorded so far.
  setup.harnessError = normalizeText((e as Error).message);
  log(`!! harness error: ${(e as Error).message}`);
  writeSnapshot();
}
