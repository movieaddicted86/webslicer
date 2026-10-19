/**
 * Slicing job queue. Each job gets a directory under DATA_DIR/jobs/<id> with
 * the generated config.ini, model.3mf, the output G-code and a log.
 */
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { runSlicer } from './slicer/cli.js';
import { serializeIni, type IniSection } from './slicer/ini.js';
import { build3mf, parseStl, transformMesh, type CustomGcode, type ThreeMfObject, type ThreeMfVolume, type VolumeType } from './slicer/threemf.js';
import { readGcodeInfo, type GcodeInfo } from './slicer/gcodeInfo.js';
import { injectThumbnails, type ThumbnailInput } from './slicer/thumbnails.js';
import { escapeStringsCstyle, unescapeStringsCstyle, splitVector } from './slicer/values.js';
import type { Schema } from './slicer/schema.js';

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export interface SliceVolumeInput {
  modelId: string;
  name: string;
  type: VolumeType;
  /** transform relative to the object (column-major 4x4) */
  transform: number[];
  config?: IniSection;
  extruder?: number;
}

export interface SliceObjectInput {
  modelId: string;
  name: string;
  /** transform of instance 1 (kept for older clients) */
  transform: number[];
  /** all instance transforms (including the first) when the object has more than one instance */
  instances?: number[][];
  config?: IniSection;
  extruder?: number;
  volumes?: SliceVolumeInput[];
  /** per-triangle paint of the main mesh: one char per triangle ('0' none, '4' enforcer, '8' blocker) */
  supportPaint?: string;
  seamPaint?: string;
  /** MMU paint: one hex char per triangle = extruder index (0 = object default) */
  mmuPaint?: string;
  /** height range modifiers (object Z, mm) */
  ranges?: Array<{ minZ: number; maxZ: number; config: IniSection }>;
}

export interface SliceRequest {
  objects: SliceObjectInput[];
  print: { name: string; config: IniSection };
  filaments: Array<{ name: string; config: IniSection }>;
  printer: { name: string; config: IniSection };
  outputName?: string;
  /** Emit binary G-code (.bgcode) when the printer supports it. Default: ASCII (previewable). */
  binaryGcode?: boolean;
  /** previews rendered by the browser; embedded into ASCII G-code after slicing */
  thumbnails?: ThumbnailInput[];
  /** colour changes, pauses and custom G-code at given layer heights */
  customGcodes?: CustomGcode[];
}

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

const jobs = new Map<string, JobRecord>();
const emitters = new Map<string, EventEmitter>();
const controllers = new Map<string, AbortController>();
const queue: string[] = [];
let running = 0;
let schemaRef: Schema | undefined;

export function setSchema(s: Schema) {
  schemaRef = s;
}

export function jobDir(id: string): string {
  return path.join(config.jobsDir, id);
}

export function getJob(id: string): JobRecord | undefined {
  return jobs.get(id);
}

export function listJobs(): JobRecord[] {
  return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function subscribe(id: string, fn: (ev: JobEvent) => void): () => void {
  let em = emitters.get(id);
  if (!em) {
    em = new EventEmitter();
    em.setMaxListeners(100);
    emitters.set(id, em);
  }
  em.on('event', fn);
  return () => em?.off('event', fn);
}

function emit(id: string, ev: JobEvent) {
  emitters.get(id)?.emit('event', ev);
}

function persist(job: JobRecord) {
  try {
    fs.writeFileSync(path.join(jobDir(job.id), 'job.json'), JSON.stringify(job, null, 2));
  } catch {
    /* ignore */
  }
}

/** Load job records left over from previous runs */
export function loadJobsFromDisk() {
  try {
    for (const id of fs.readdirSync(config.jobsDir)) {
      const f = path.join(config.jobsDir, id, 'job.json');
      if (!fs.existsSync(f)) continue;
      try {
        const j = JSON.parse(fs.readFileSync(f, 'utf8')) as JobRecord;
        if (j.status === 'running' || j.status === 'queued') {
          j.status = 'error';
          j.error = 'Interrupted by server restart';
        }
        jobs.set(j.id, j);
      } catch {
        /* skip */
      }
    }
  } catch {
    /* ignore */
  }
  pruneJobs();
  pruneModels();
  setInterval(pruneModels, 6 * 3600_000).unref();
}

/** Remove uploaded model files that are older than MODEL_RETENTION_DAYS (default 7). */
export function pruneModels() {
  const days = Number(process.env.MODEL_RETENTION_DAYS || 7);
  const cutoff = Date.now() - days * 86400_000;
  try {
    for (const f of fs.readdirSync(config.modelsDir)) {
      const p = path.join(config.modelsDir, f);
      try {
        if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

function pruneJobs() {
  const all = listJobs();
  for (const j of all.slice(config.jobRetention)) {
    if (j.status === 'running' || j.status === 'queued') continue;
    deleteJob(j.id);
  }
}

export function deleteJob(id: string): boolean {
  const j = jobs.get(id);
  if (!j) return false;
  if (j.status === 'running' || j.status === 'queued') cancelJob(id);
  jobs.delete(id);
  emitters.delete(id);
  try {
    fs.rmSync(jobDir(id), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  return true;
}

export function cancelJob(id: string): boolean {
  const j = jobs.get(id);
  if (!j) return false;
  if (j.status === 'queued') {
    const i = queue.indexOf(id);
    if (i >= 0) queue.splice(i, 1);
    j.status = 'cancelled';
    j.finishedAt = new Date().toISOString();
    persist(j);
    emit(id, { type: 'status', job: j });
    return true;
  }
  if (j.status === 'running') {
    controllers.get(id)?.abort();
    return true;
  }
  return false;
}

/**
 * Merge print + printer + filament presets into one flat PrusaSlicer config.
 * Filament options are per-extruder vectors; one filament preset per extruder.
 */
export function mergeConfigs(schema: Schema, req: SliceRequest, opts: { forProject?: boolean } = {}): IniSection {
  const merged: IniSection = {};
  const skip = new Set(['inherits', 'compatible_printers', 'compatible_printers_condition', 'compatible_prints', 'compatible_prints_condition']);
  // Printer first, then print: a few keys occur in both preset types in vendor bundles
  // (e.g. elefant_foot_compensation on SLA printers) and the print preset owns them.
  for (const [k, v] of Object.entries(req.printer.config)) if (!skip.has(k)) merged[k] = v;
  for (const [k, v] of Object.entries(req.print.config)) if (!skip.has(k)) merged[k] = v;

  const nExtruders = Math.max(1, splitVector(req.printer.config.nozzle_diameter || '0.4').length);
  const filaments = req.filaments.length ? req.filaments : [{ name: '- default FFF -', config: {} }];
  while (filaments.length < nExtruders) filaments.push(filaments[filaments.length - 1]);
  const filamentKeys = new Set<string>();
  for (const f of filaments) for (const k of Object.keys(f.config)) filamentKeys.add(k);
  for (const k of filamentKeys) {
    if (skip.has(k)) continue;
    const opt = schema.options[k];
    const isStrings = opt?.type === 'strings' || k === 'filament_settings_id';
    const vector = opt ? ['floats', 'ints', 'bools', 'strings', 'percents', 'floats_or_percents', 'points'].includes(opt.type) : true;
    if (!vector) {
      merged[k] = filaments[0].config[k] ?? '';
      continue;
    }
    const values = filaments.slice(0, nExtruders).map((f) => {
      const raw = f.config[k] ?? opt?.default ?? '';
      if (isStrings) return unescapeStringsCstyle(raw)[0] ?? '';
      return splitVector(raw)[0] ?? '';
    });
    merged[k] = isStrings ? escapeStringsCstyle(values) : values.join(',');
  }
  merged.print_settings_id = req.print.name;
  merged.printer_settings_id = req.printer.name;
  merged.filament_settings_id = escapeStringsCstyle(filaments.slice(0, nExtruders).map((f) => f.name));
  if (!merged.printer_technology) merged.printer_technology = 'FFF';
  // Slicing honours the UI choice (ASCII by default for the preview); a project keeps the preset value.
  if (merged.binary_gcode !== undefined && !opts.forProject) merged.binary_gcode = req.binaryGcode ? '1' : '0';
  return merged;
}

export async function build3mfForRequest(req: SliceRequest, projectConfig?: IniSection): Promise<Buffer> {
  const objects: ThreeMfObject[] = [];
  for (const o of req.objects) {
    // old clients send only `transform`; newer ones list every instance (including the first)
    const transforms = o.instances?.length ? o.instances : [o.transform];
    const file = path.join(config.modelsDir, `${o.modelId}.stl`);
    if (!fs.existsSync(file)) throw new Error(`Model ${o.modelId} not found on server; please re-upload`);
    const mesh = parseStl(fs.readFileSync(file));
    const volumes: ThreeMfVolume[] = [];
    for (const v of o.volumes || []) {
      const vf = path.join(config.modelsDir, `${v.modelId}.stl`);
      if (!fs.existsSync(vf)) throw new Error(`Volume model ${v.modelId} not found on server; please re-add the volume`);
      volumes.push({
        name: v.name || v.type,
        mesh: transformMesh(parseStl(fs.readFileSync(vf)), v.transform),
        type: v.type,
        config: v.config,
        extruder: v.extruder,
      });
    }
    objects.push({
      name: o.name || 'object',
      mesh,
      transform: transforms[0],
      instances: transforms.length > 1 ? transforms : undefined,
      config: o.config,
      extruder: o.extruder,
      volumes,
      supportPaint: o.supportPaint,
      seamPaint: o.seamPaint,
      mmuPaint: o.mmuPaint,
      ranges: o.ranges,
    });
  }
  const extruders = Math.max(1, splitVector(req.printer.config.nozzle_diameter || '0.4').length);
  return build3mf(objects, {
    projectConfig,
    title: req.outputName,
    customGcodes: req.customGcodes,
    extruders,
  });
}

function sanitizeFilename(name: string, ext: string): string {
  let base = name.replace(/\.(gcode|bgcode|sl1|sl1s|3mf)$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
  if (!base) base = 'print';
  return `${base}${ext}`;
}

export function createJob(req: SliceRequest, schema: Schema): JobRecord {
  const id = randomUUID();
  const tech = req.printer.config.printer_technology === 'SLA' ? 'SLA' : 'FFF';
  const binary = tech === 'FFF' && !!req.binaryGcode && (req.printer.config.binary_gcode === '1' || req.printer.config.binary_gcode === 'true');
  const ext = tech === 'SLA' ? '.sl1' : binary ? '.bgcode' : '.gcode';
  const job: JobRecord = {
    id,
    status: 'queued',
    createdAt: new Date().toISOString(),
    percent: 0,
    message: 'Queued',
    outputName: sanitizeFilename(req.outputName || req.objects[0]?.name || 'print', ext),
    technology: tech,
    presets: { print: req.print.name, filaments: req.filaments.map((f) => f.name), printer: req.printer.name },
    objectNames: req.objects.map((o) => o.name),
  };
  fs.mkdirSync(jobDir(id), { recursive: true });
  fs.writeFileSync(path.join(jobDir(id), 'request.json'), JSON.stringify(req));
  jobs.set(id, job);
  persist(job);
  queue.push(id);
  schemaRef = schema;
  setImmediate(pump);
  pruneJobs();
  return job;
}

function pump() {
  while (running < config.maxJobs && queue.length) {
    const id = queue.shift()!;
    const job = jobs.get(id);
    if (!job || job.status !== 'queued') continue;
    running++;
    runJob(job)
      .catch((e) => {
        job.status = 'error';
        job.error = (e as Error).message;
        job.finishedAt = new Date().toISOString();
        persist(job);
        emit(job.id, { type: 'error', message: job.error, job });
      })
      .finally(() => {
        running--;
        setImmediate(pump);
      });
  }
}

async function runJob(job: JobRecord) {
  const dir = jobDir(job.id);
  const req = JSON.parse(fs.readFileSync(path.join(dir, 'request.json'), 'utf8')) as SliceRequest;
  const schema = schemaRef!;
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  job.message = 'Preparing model';
  persist(job);
  emit(job.id, { type: 'status', job });

  const merged = mergeConfigs(schema, req);
  const cfgFile = path.join(dir, 'config.ini');
  fs.writeFileSync(cfgFile, serializeIni(merged, `WebSlicer job ${job.id}`));
  const modelFile = path.join(dir, 'model.3mf');
  fs.writeFileSync(modelFile, await build3mfForRequest(req));
  const outFile = path.join(dir, job.outputName);
  const logLines: string[] = [];
  const logFile = path.join(dir, 'log.txt');

  const args = [
    job.technology === 'SLA' ? '--export-sla' : '--export-gcode',
    '--load',
    cfgFile,
    '--dont-arrange',
    '--loglevel',
    '3',
    '--output',
    outFile,
    modelFile,
  ];
  logLines.push(`$ ${config.slicerBin} ${args.join(' ')}`);
  const controller = new AbortController();
  controllers.set(job.id, controller);
  job.message = 'Slicing';
  emit(job.id, { type: 'progress', percent: 1, message: job.message });

  const res = await runSlicer(args, {
    cwd: dir,
    signal: controller.signal,
    timeoutMs: Number(process.env.SLICE_TIMEOUT_MS || 60 * 60 * 1000),
    onLine: (line) => {
      logLines.push(line);
      emit(job.id, { type: 'log', line });
      const m = /^\s*(\d{1,3})\s*=>\s*(.*)$/.exec(line);
      if (m) {
        job.percent = Math.min(99, Number(m[1]));
        job.message = m[2].trim();
        emit(job.id, { type: 'progress', percent: job.percent, message: job.message });
      } else if (/^\s*=>\s*/.test(line)) {
        job.message = line.replace(/^\s*=>\s*/, '').trim();
        emit(job.id, { type: 'progress', percent: job.percent, message: job.message });
      }
    },
  });
  controllers.delete(job.id);
  fs.writeFileSync(logFile, logLines.join('\n') + '\n');
  job.finishedAt = new Date().toISOString();

  if (controller.signal.aborted) {
    job.status = 'cancelled';
    job.message = 'Cancelled';
    persist(job);
    emit(job.id, { type: 'status', job });
    return;
  }
  if (res.code !== 0 || !fs.existsSync(outFile)) {
    const errLine =
      logLines
        .filter((l) => /error|exception|failed|invalid/i.test(l))
        .slice(-3)
        .join(' | ') || res.stderr.trim().split(/\r?\n/).slice(-3).join(' | ');
    job.status = 'error';
    job.error = errLine || `Slicer exited with code ${res.code}`;
    job.message = 'Failed';
    persist(job);
    emit(job.id, { type: 'error', message: job.error, job });
    return;
  }
  if (outFile.endsWith('.gcode') && req.thumbnails?.length) {
    try {
      await injectThumbnails(outFile, req.thumbnails);
      logLines.push(`WebSlicer: embedded ${req.thumbnails.length} thumbnail(s): ${req.thumbnails.map((t) => `${t.width}x${t.height}/${t.format}`).join(', ')}`);
    } catch (e) {
      logLines.push(`WebSlicer: thumbnail embedding failed: ${(e as Error).message}`);
    }
    fs.writeFileSync(logFile, logLines.join('\n') + '\n');
  }
  job.status = 'done';
  job.percent = 100;
  job.message = 'Done';
  if (job.technology === 'FFF' && outFile.endsWith('.gcode')) {
    try {
      job.info = readGcodeInfo(outFile);
    } catch {
      /* ignore */
    }
  } else {
    job.info = { sizeBytes: fs.statSync(outFile).size };
  }
  persist(job);
  emit(job.id, { type: 'done', job });
}

export function jobOutputPath(job: JobRecord): string {
  return path.join(jobDir(job.id), job.outputName);
}
