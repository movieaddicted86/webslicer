/**
 * Slicing job queue: in-memory jobs with their progress events (SSE) and the runner that drives
 * PrusaSlicer. The files of a job live in `DATA_DIR/jobs/<id>/` – that side is
 * `jobs/persistence.ts`, the config merge is `services/configMerge.ts` and the 3MF comes from
 * `services/slice.ts`.
 */
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { runSlicer } from './slicer/cli.js';
import { serializeIni } from './slicer/ini.js';
import { extractWarnings, readGcodeInfo } from './slicer/gcodeInfo.js';
import { machineLimitsOf, scanGcodeFile } from './slicer/gcodePreflight.js';
import { injectThumbnails } from './slicer/thumbnails.js';
import { mergeConfigs } from './services/configMerge.js';
import { build3mfForRequest } from './services/slice.js';
import { pruneModels } from './services/models.js';
import { maxTemperaturesOf } from '@webslicer/shared';
import {
  fileSize,
  initJobDir,
  jobDir,
  jobFile,
  loadJobRecords,
  outputExists,
  removeJobDir,
  removeJobFile,
  readJobRequest,
  saveJobRecord,
  writeJobConfig,
  writeJobLog,
  writeJobModel,
} from './jobs/persistence.js';
import type { ConfigIssue, JobEvent, JobRecord, Schema, SliceRequest } from '@webslicer/shared';

const jobs = new Map<string, JobRecord>();
const emitters = new Map<string, EventEmitter>();
const controllers = new Map<string, AbortController>();
/** jobs whose cancel was asked for while they were still preparing (no controller yet, B6) */
const cancelling = new Set<string>();
/** the in-flight `runJob` of a running job, so a delete can wait for the CLI to be gone (B6) */
const runningJobs = new Map<string, Promise<void>>();
const queue: string[] = [];
let running = 0;
let schemaRef: Schema | undefined;

export function setSchema(s: Schema) {
  schemaRef = s;
}

/** Directory of a job (re-exported for the routes that stream from it). */
export { jobDir };

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

/** Load job records left over from previous runs */
export async function loadJobsFromDisk(): Promise<void> {
  for (const job of await loadJobRecords()) jobs.set(job.id, job);
  await pruneJobs();
  await pruneModels();
  setInterval(() => void pruneModels(), 6 * 3600_000).unref();
}

async function pruneJobs(): Promise<void> {
  for (const j of listJobs().slice(config.jobRetention)) {
    if (j.status === 'running' || j.status === 'queued') continue;
    await deleteJob(j.id);
  }
}

export async function deleteJob(id: string): Promise<boolean> {
  const j = jobs.get(id);
  if (!j) return false;
  if (j.status === 'running' || j.status === 'queued') {
    cancelJob(id);
    // the CLI process keeps writing into the directory until it is killed; deleting it underneath the
    // job left a half-written dir behind (B6) – wait for the run to finish its cleanup first
    await runningJobs.get(id);
  }
  jobs.delete(id);
  emitters.delete(id);
  cancelling.delete(id);
  await removeJobDir(id);
  return true;
}

/**
 * Cancel a job, whatever stage it is in.
 *
 * Queued: leave the queue. Running: abort the CLI. Still **preparing** (the model is being built and
 * the AbortController does not exist yet, B6): mark it, and `runJob` aborts as soon as the controller
 * is created – the call used to answer 404 and the job kept slicing.
 */
export function cancelJob(id: string): boolean {
  const j = jobs.get(id);
  if (!j) return false;
  if (j.status === 'queued') {
    const i = queue.indexOf(id);
    if (i >= 0) queue.splice(i, 1);
    j.status = 'cancelled';
    j.finishedAt = new Date().toISOString();
    j.message = 'Cancelled';
    void saveJobRecord(j);
    emit(id, { type: 'status', job: j });
    return true;
  }
  if (j.status === 'running') {
    const controller = controllers.get(id);
    if (controller) controller.abort();
    else cancelling.add(id);
    return true;
  }
  return false;
}

/**
 * End a cancelled run: record the state and remove the temporary inputs (the config and the 3MF are
 * rebuilt on the next slice; only the log stays).
 */
async function finishCancelled(job: JobRecord): Promise<void> {
  job.status = 'cancelled';
  job.message = 'Cancelled';
  job.finishedAt = job.finishedAt || new Date().toISOString();
  await saveJobRecord(job);
  await removeJobFile(job.id, 'config.ini');
  await removeJobFile(job.id, 'model.3mf');
  emit(job.id, { type: 'status', job });
}

function sanitizeFilename(name: string, ext: string): string {
  let base = name
    .replace(/\.(gcode|bgcode|sl1|sl1s|3mf)$/i, '')
    // the control-character range is the point here: user-supplied names must not reach the filesystem raw
    // eslint-disable-next-line no-control-regex -- intentional control-character stripping
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .trim();
  if (!base) base = 'print';
  return `${base}${ext}`;
}

/** Queue a job for a validated request; the caller has already checked the request. */
export async function createJob(req: SliceRequest, schema: Schema, configIssues: ConfigIssue[] = []): Promise<JobRecord> {
  const id = randomUUID();
  const tech = req.printer.config.printer_technology === 'SLA' ? 'SLA' : 'FFF';
  const binary =
    tech === 'FFF' && !!req.binaryGcode && (req.printer.config.binary_gcode === '1' || req.printer.config.binary_gcode === 'true');
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
    configIssues: configIssues.length ? configIssues : undefined,
    // S1-d: what the send dialog compares against the safety profile of the chosen host
    temperatures: maxTemperaturesOf(req),
  };
  await initJobDir(id, req);
  jobs.set(id, job);
  await saveJobRecord(job);
  queue.push(id);
  schemaRef = schema;
  setImmediate(pump);
  await pruneJobs();
  return job;
}

function pump() {
  while (running < config.maxJobs && queue.length) {
    const id = queue.shift();
    if (!id) break;
    const job = jobs.get(id);
    if (!job || job.status !== 'queued') continue;
    running++;
    const run = runJob(job)
      .catch(async (e) => {
        // a cancel that raced the preparation (B6) wins over the error the preparation then hit
        if (job.status === 'cancelled' || cancelling.delete(job.id)) return finishCancelled(job);
        job.status = 'error';
        job.error = (e as Error).message;
        job.finishedAt = new Date().toISOString();
        void saveJobRecord(job);
        emit(job.id, { type: 'error', message: job.error, job });
      })
      .finally(() => {
        running--;
        runningJobs.delete(id);
        setImmediate(pump);
      });
    runningJobs.set(id, run);
  }
}

/** Progress of one job as it runs: the slicer's own percentage lines drive the messages. */
function progressReporter(job: JobRecord, logLines: string[]) {
  return (line: string) => {
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
  };
}

/**
 * Last few meaningful log lines, as the error message of a failed job. The plate checks of T-034
 * catch most of these in the browser, but when the slicer itself refuses a plate its own wording has
 * to reach the user instead of a generic "Slicing failed" – "All objects are outside of the print
 * volume." carries none of the usual error keywords, hence the explicit pattern.
 */
export function failureMessage(logLines: string[], stderr: string, code: number | null): string {
  return (
    logLines
      .filter((l) => /error|exception|failed|invalid|conflicts? found|outside of the print volume/i.test(l))
      .slice(-3)
      .join(' | ') ||
    stderr.trim().split(/\r?\n/).slice(-3).join(' | ') ||
    `Slicer exited with code ${code}`
  );
}

/** Embed the requested thumbnails into a finished FFF G-code, if any were asked for. */
async function embedThumbnails(job: JobRecord, req: SliceRequest, outFile: string, logLines: string[]): Promise<void> {
  if (!outFile.endsWith('.gcode') || !req.thumbnails?.length) return;
  try {
    await injectThumbnails(outFile, req.thumbnails);
    logLines.push(
      `WebSlicer: embedded ${req.thumbnails.length} thumbnail(s): ${req.thumbnails.map((t) => `${t.width}x${t.height}/${t.format}`).join(', ')}`,
    );
  } catch (e) {
    logLines.push(`WebSlicer: thumbnail embedding failed: ${(e as Error).message}`);
  }
  await writeJobLog(job.id, logLines.join('\n') + '\n');
}

/** Read size, and for FFF G-code the estimated time / filament / layers, into the job record. */
async function collectJobInfo(
  job: JobRecord,
  outFile: string,
  warnings: string[],
  machineLimits: Readonly<Record<string, string>>,
): Promise<void> {
  // S1-c: the finished file is scanned once, here; the result is stored in the record and the send
  // gate merges its issues into the preset issues (no second scan on every send).
  const preflight = await scanGcodeFile(outFile, machineLimits);
  if (job.technology === 'FFF' && outFile.endsWith('.gcode')) {
    try {
      job.info = { ...readGcodeInfo(outFile), warnings, preflight };
      return;
    } catch {
      /* fall through to the size-only record */
    }
  }
  job.info = { sizeBytes: await fileSize(outFile), warnings, preflight };
}

/**
 * Turn a sliced job into a finished one. The info – size, G-code estimates and the preflight scan,
 * which is awaited and yields the event loop on its chunks – is written **first**, the `done` status
 * after: a reader (job list, `GET /api/jobs/:id`, a send) must never see a `done` job without its
 * `info.preflight`, and the send gate would then scan the file again on demand.
 */
export async function completeJob(
  job: JobRecord,
  outFile: string,
  warnings: string[],
  machineLimits: Readonly<Record<string, string>>,
): Promise<void> {
  await collectJobInfo(job, outFile, warnings, machineLimits);
  job.status = 'done';
  job.percent = 100;
  job.message = 'Done';
}

async function runJob(job: JobRecord) {
  const dir = jobDir(job.id);
  const req = await readJobRequest(job.id);
  const schema = schemaRef;
  if (!schema) throw new Error('schema not loaded yet');
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  job.message = 'Preparing model';
  await saveJobRecord(job);
  emit(job.id, { type: 'status', job });

  const merged = mergeConfigs(schema, req);
  const cfgFile = jobFile(job.id, 'config.ini');
  await writeJobConfig(job.id, serializeIni(merged, `WebSlicer job ${job.id}`));
  await writeJobModel(job.id, await build3mfForRequest(req));
  const outFile = path.join(dir, job.outputName);
  const logLines: string[] = [];

  const args = [
    job.technology === 'SLA' ? '--export-sla' : '--export-gcode',
    '--load',
    cfgFile,
    '--dont-arrange',
    '--loglevel',
    '3',
    '--output',
    outFile,
    jobFile(job.id, 'model.3mf'),
  ];
  logLines.push(`$ ${config.slicerBin} ${args.join(' ')}`);
  const controller = new AbortController();
  controllers.set(job.id, controller);
  // a cancel that arrived during preparation (B6) aborts before the CLI is ever spawned
  const cancelledEarly = cancelling.delete(job.id);
  if (cancelledEarly) controller.abort();
  job.message = 'Slicing';
  emit(job.id, { type: 'progress', percent: 1, message: job.message });

  const res = await runSlicer(args, {
    cwd: dir,
    signal: controller.signal,
    timeoutMs: Number(process.env.SLICE_TIMEOUT_MS || 60 * 60 * 1000),
    onLine: progressReporter(job, logLines),
  });
  controllers.delete(job.id);
  cancelling.delete(job.id);
  await writeJobLog(job.id, logLines.join('\n') + '\n');

  if (controller.signal.aborted) {
    await finishCancelled(job);
    return;
  }
  job.finishedAt = new Date().toISOString();
  if (res.code !== 0 || !(await outputExists(outFile))) {
    job.status = 'error';
    job.error = failureMessage(logLines, res.stderr, res.code);
    job.message = 'Failed';
    await saveJobRecord(job);
    emit(job.id, { type: 'error', message: job.error, job });
    return;
  }
  await embedThumbnails(job, req, outFile, logLines);
  await completeJob(job, outFile, extractWarnings(logLines), machineLimitsOf(req.printer.config));
  await saveJobRecord(job);
  emit(job.id, { type: 'done', job });
}

export function jobOutputPath(job: JobRecord): string {
  return jobFile(job.id, job.outputName);
}

/** Read the log of a job (the routes and the MCP tools show it). */
export { readJobLog } from './jobs/persistence.js';
