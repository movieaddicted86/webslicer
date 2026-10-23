/**
 * STEP import (T-009): PrusaSlicer's CLI reads STEP/STP (`--export-stl`), so the server converts an
 * uploaded STEP file to a binary STL and the normal STL path takes over – browser, library and the
 * headless plater all share this one conversion (no second copy of the logic).
 *
 * Every call works in a temp directory under `data/cache` and removes it again, whatever happens:
 * a broken file must not leave a half-written model behind, and the CLI needs the input to keep its
 * `.step`/`.stp` extension (it refuses anything else by name).
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { envIntegerAtLeast } from '../env.js';
import { ValidationError } from '../errors.js';
import { runSlicer, type RunOptions, type RunResult } from './cli.js';

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

/** The escape character of the CLI's ANSI colour codes (`\u001b`, kept out of a regex literal). */
const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

/** Strip the CLI's colour escapes and the `****` decoration of its log lines. */
function cleanLine(line: string): string {
  return line
    .replace(ANSI, '')
    .replace(/^\*+\s*/, '')
    .replace(/\s*\*+$/, '')
    .trim();
}

/** The first line of the CLI output that says what went wrong (what the user gets as 400 text). */
export function failureLine(res: RunResult, timeoutMs = stepTimeoutMs()): string {
  if (res.code === null && res.signal) return `the conversion timed out after ${Math.round(timeoutMs / 1000)} s`;
  const lines = `${res.stderr}\n${res.stdout}`.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const relevant = lines.find((l) => /\b(err|error|fail|cannot|unknown|invalid|syntax|no such|unable)\b/i.test(l));
  return relevant || lines[0] || `the slicer CLI exited with code ${res.code}`;
}

/**
 * Convert the STEP file at `input` to a binary STL and return its bytes. The output file lives in
 * `workDir` (or in a temp directory this function creates and removes again).
 */
export async function convertStepFile(
  input: string,
  opts: { run?: SlicerRunner; workDir?: string; timeoutMs?: number } = {},
): Promise<Buffer> {
  const ownDir = opts.workDir ? undefined : await createStepTempDir();
  const dir = opts.workDir ?? (ownDir as string);
  const timeoutMs = opts.timeoutMs ?? stepTimeoutMs();
  const out = path.join(dir, `.step-out-${Date.now()}-${Math.random().toString(36).slice(2)}.stl`);
  try {
    const run = opts.run ?? runSlicer;
    const res = await run(['--export-stl', '--no-ensure-on-bed', '--output', out, input], { timeoutMs });
    if (res.code !== 0) throw new ValidationError(`cannot convert STEP: ${failureLine(res, timeoutMs)}`);
    let stl: Buffer;
    try {
      stl = await fsp.readFile(out);
    } catch {
      throw new ValidationError(`cannot convert STEP: ${failureLine(res, timeoutMs)}`);
    }
    if (!stl.length) throw new ValidationError('cannot convert STEP: the slicer wrote an empty STL');
    return stl;
  } finally {
    await fsp.rm(out, { force: true }).catch(() => undefined);
    if (ownDir) await fsp.rm(ownDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Convert a STEP file held in memory (the headless plater and the upload route both start here). */
export async function convertStep(buf: Buffer, filename: string, opts: { run?: SlicerRunner; timeoutMs?: number } = {}): Promise<Buffer> {
  const ext = path.extname(filename).toLowerCase();
  if (!STEP_EXTENSIONS.has(ext)) throw new ValidationError(`not a STEP file "${filename}"`);
  const dir = await createStepTempDir();
  try {
    const input = path.join(dir, `input${ext}`);
    await fsp.writeFile(input, buf);
    return await convertStepFile(input, { ...opts, workDir: dir });
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
