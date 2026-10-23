/**
 * STEP import (T-009): PrusaSlicer's CLI reads STEP/STP (`--export-stl`), so the server converts an
 * uploaded STEP file to a binary STL and the normal STL path takes over – browser, library and the
 * headless plater all share this one conversion (no second copy of the logic).
 *
 * Every call works in a temp directory under `data/cache` and removes it again, whatever happens:
 * a broken file must not leave a half-written model behind, and the CLI needs the input to keep its
 * `.step`/`.stp` extension (it refuses anything else by name). The process itself goes through the
 * one CLI seam (`cli.ts`): limited, abortable on a client disconnect, output bounded.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { envIntegerAtLeast } from '../env.js';
import { ValidationError } from '../errors.js';
import { exportStlArgs } from './commands.js';
import { failureLine, maskTempPath, runSlicer, withTempDir, type RunOptions, type RunResult } from './cli.js';

/** The CLI runner, injectable so the tests do not need PrusaSlicer. */
export type SlicerRunner = (args: string[], opts?: RunOptions) => Promise<RunResult>;

export const STEP_EXTENSIONS = new Set(['.step', '.stp']);

/** The formats the CLI accepts as STEP input, by file extension. */
export function isStepFile(name: string): boolean {
  return STEP_EXTENSIONS.has(path.extname(name).toLowerCase());
}

/** How long one STEP conversion may take (the CLI can hang on a broken file). */
export function stepTimeoutMs(): number {
  return envIntegerAtLeast('STEP_TIMEOUT_MS', 1, 120_000);
}

/** The directory the temp folders are created in (created if missing). */
export async function stepTempRoot(): Promise<string> {
  const root = path.join(config.cacheDir, 'step');
  await fsp.mkdir(root, { recursive: true });
  return root;
}

/** A unique temp directory for one conversion. */
export async function createStepTempDir(): Promise<string> {
  return fsp.mkdtemp(path.join(await stepTempRoot(), `${process.pid}-`));
}

/** A 400 that never carries a server path (AC-6). */
function stepError(message: string, dir: string): ValidationError {
  return new ValidationError(maskTempPath(message, dir));
}

export interface StepOptions {
  run?: SlicerRunner;
  workDir?: string;
  timeoutMs?: number;
  /** kills the CLI when the client goes away (AC-3) */
  signal?: AbortSignal;
}

/**
 * Convert the STEP file at `input` to a binary STL and return its bytes. The output file lives in
 * `workDir` (or in a temp directory this function creates and removes again).
 */
export async function convertStepFile(input: string, opts: StepOptions = {}): Promise<Buffer> {
  if (opts.workDir) return convertInDir(input, opts.workDir, opts);
  return withTempDir('step', (dir) => convertInDir(input, dir, opts));
}

async function convertInDir(input: string, dir: string, opts: StepOptions): Promise<Buffer> {
  const timeoutMs = opts.timeoutMs ?? stepTimeoutMs();
  const out = path.join(dir, `.step-out-${Date.now()}-${Math.random().toString(36).slice(2)}.stl`);
  try {
    const run = opts.run ?? runSlicer;
    const res = await run(exportStlArgs({ outputFile: out, inputFile: input }), { timeoutMs, signal: opts.signal });
    if (res.code !== 0) throw stepError(`cannot convert STEP: ${failureLine(res, timeoutMs)}`, dir);
    // the CLI output is bounded like an upload: a STEP that explodes is a 400, not an unbounded read
    const stat = await fsp.stat(out).catch(() => undefined);
    if (!stat) throw stepError(`cannot convert STEP: ${failureLine(res, timeoutMs)}`, dir);
    if (stat.size > config.maxUploadBytes) {
      throw stepError(`cannot convert STEP: the converted model is larger than the allowed size of ${config.maxUploadBytes} bytes`, dir);
    }
    let stl: Buffer;
    try {
      stl = await fsp.readFile(out);
    } catch {
      throw stepError(`cannot convert STEP: ${failureLine(res, timeoutMs)}`, dir);
    }
    if (!stl.length) throw stepError('cannot convert STEP: the slicer wrote an empty STL', dir);
    return stl;
  } finally {
    await fsp.rm(out, { force: true }).catch(() => undefined);
  }
}

/** Convert a STEP file held in memory (the headless plater and the upload route both start here). */
export async function convertStep(
  buf: Buffer,
  filename: string,
  opts: { run?: SlicerRunner; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<Buffer> {
  const ext = path.extname(filename).toLowerCase();
  if (!STEP_EXTENSIONS.has(ext)) throw new ValidationError(`not a STEP file "${filename}"`);
  return withTempDir('step', async (dir) => {
    const input = path.join(dir, `input${ext}`);
    await fsp.writeFile(input, buf);
    return convertStepFile(input, { ...opts, workDir: dir });
  });
}
