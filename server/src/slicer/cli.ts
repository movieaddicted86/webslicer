/**
 * The one seam to the PrusaSlicer binary (q2-slicer-cli): every invocation goes through
 * `runSlicer`, which starts the process, limits how many run at once, kills it on abort/timeout and
 * turns its output into a readable error line.
 *
 * The argument lists themselves live in `commands.ts`; this file knows how to *run* them.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { helpArgs } from './commands.js';

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  signal: NodeJS.Signals | null;
}

export interface RunOptions {
  cwd?: string;
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** What an aborted or limit-cancelled run resolves to – no process was left behind. */
const ABORTED: RunResult = { code: null, stdout: '', stderr: '', signal: 'SIGKILL' };

// ---- concurrency limiter ---------------------------------------------------
//
// A small in-module semaphore (no dependency): at most `MAX_CLI_PROCESSES` PrusaSlicer processes
// run at the same time across slicing jobs, STEP conversion and cut. Further calls wait FIFO. The
// jobs' own queue sits *above* this one, so a job never holds a queue slot while waiting for the
// process slot.

/** How many CLI processes may run at once (`MAX_CLI_PROCESSES`, default `MAX_JOBS`). */
export function cliProcessLimit(): number {
  return config.maxCliProcesses;
}

interface Waiter {
  grant: (release: () => void) => void;
  cancel: () => void;
}

let activeProcesses = 0;
const waitingForSlot: Waiter[] = [];
/** `kill` functions of the spawned children, so shutdown can stop STEP/cut processes too (AC-4). */
const runningKills = new Set<() => void>();

function releaseSlot(): void {
  activeProcesses = Math.max(0, activeProcesses - 1);
  grantSlots();
}

function grantSlots(): void {
  const limit = cliProcessLimit();
  while (activeProcesses < limit && waitingForSlot.length) {
    const waiter = waitingForSlot.shift() as Waiter;
    activeProcesses++;
    waiter.grant(releaseSlot);
  }
}

/** Wait for a free slot; resolves `undefined` when the signal aborted while waiting (nothing starts). */
function acquireSlot(signal?: AbortSignal): Promise<(() => void) | undefined> {
  if (signal?.aborted) return Promise.resolve(undefined);
  if (activeProcesses < cliProcessLimit()) {
    activeProcesses++;
    return Promise.resolve(releaseSlot);
  }
  return new Promise((resolve) => {
    const waiter: Waiter = {
      grant: (release) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(release);
      },
      cancel: () => undefined,
    };
    const onAbort = () => {
      const i = waitingForSlot.indexOf(waiter);
      if (i >= 0) waitingForSlot.splice(i, 1);
      resolve(undefined);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    waiter.cancel = onAbort;
    waitingForSlot.push(waiter);
  });
}

/**
 * Stop every running PrusaSlicer process and empty the wait queue – called on SIGTERM/SIGINT
 * (AC-4). A waiting caller resolves as aborted and never starts a process.
 */
export function stopRunningSlicers(): void {
  for (const waiter of [...waitingForSlot]) waiter.cancel();
  for (const kill of [...runningKills]) kill();
}

/** Number of processes currently running (tests and diagnostics). */
export function activeSlicerProcesses(): number {
  return activeProcesses;
}

/** Spawn the PrusaSlicer binary with the given arguments. */
export async function runSlicer(args: string[], opts: RunOptions = {}): Promise<RunResult> {
  // a signal that was aborted before the call must not start a process that nobody stops (B6: a
  // cancel during preparation aborts the controller before the CLI is spawned)
  if (opts.signal?.aborted) return Promise.resolve({ ...ABORTED });
  const release = await acquireSlot(opts.signal);
  if (!release) return { ...ABORTED };
  try {
    return await spawnSlicer(args, opts);
  } finally {
    release();
  }
}

function spawnSlicer(args: string[], opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      // Never try to open a display; PrusaSlicer CLI does not need one but GTK may probe.
      DISPLAY: '',
      WAYLAND_DISPLAY: '',
      // Keep the AppImage from writing config into read-only places
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || `${config.cacheDir}/xdg`,
      XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || `${config.cacheDir}/xdg-cache`,
      HOME: process.env.HOME || config.cacheDir,
    };
    try {
      fs.mkdirSync(env.XDG_CONFIG_HOME as string, { recursive: true });
      fs.mkdirSync(env.XDG_CACHE_HOME as string, { recursive: true });
    } catch {
      /* ignore */
    }
    // A `.cmd`/`.bat` wrapper (common for AppImage or portable installs on Windows) cannot be spawned
    // directly – Node refuses with EINVAL; it has to go through the command interpreter, which needs
    // the quoting Node does for every other argument.
    const script = process.platform === 'win32' && /\.(cmd|bat)$/i.test(config.slicerBin);
    const child = spawn(
      script ? process.env.ComSpec || 'cmd.exe' : config.slicerBin,
      script ? ['/d', '/c', config.slicerBin, ...args] : args,
      {
        cwd: opts.cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    let stdout = '';
    let stderr = '';
    // a wrapper script runs the real slicer as a child of `cmd.exe`, so killing only the shell leaves
    // the process (and its pipes) alive – the tree has to go, and it has to go *before* the shell is
    // killed (afterwards `taskkill` no longer finds the children)
    const kill = () => {
      if (script && child.pid) {
        try {
          const tk = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
          tk.on('error', () => child.kill('SIGKILL'));
          tk.on('close', () => child.kill('SIGKILL'));
          return;
        } catch {
          /* fall back to the direct kill below */
        }
      }
      child.kill('SIGKILL');
    };
    runningKills.add(kill);
    const timer = opts.timeoutMs ? setTimeout(kill, opts.timeoutMs) : undefined;
    const abort = () => kill();
    opts.signal?.addEventListener('abort', abort, { once: true });

    const lineBuffer = (stream: 'stdout' | 'stderr') => {
      let buf = '';
      return (chunk: Buffer) => {
        const s = chunk.toString('utf8');
        if (stream === 'stdout') stdout += s;
        else stderr += s;
        if (!opts.onLine) return;
        buf += s;
        let idx: number;
        while ((idx = buf.search(/\r?\n/)) >= 0) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + (buf[idx] === '\r' ? 2 : 1));
          if (line.trim()) opts.onLine(line, stream);
        }
      };
    };
    child.stdout.on('data', lineBuffer('stdout'));
    child.stderr.on('data', lineBuffer('stderr'));
    child.on('error', (err) => {
      runningKills.delete(kill);
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, signal) => {
      runningKills.delete(kill);
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', abort);
      resolve({ code, stdout, stderr, signal });
    });
  });
}

// ---- output helpers -------------------------------------------------------

/** The escape character of the CLI's ANSI colour codes (`\u001b`, kept out of a regex literal). */
const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

/** Strip the CLI's colour escapes and the `****` decoration of its log lines. */
export function cleanLine(line: string): string {
  return line
    .replace(ANSI, '')
    .replace(/^\*+\s*/, '')
    .replace(/\s*\*+$/, '')
    .trim();
}

/**
 * The first line of the CLI output that says what went wrong (what the user gets as 400 text).
 * `what` names the operation in the timeout message ("the conversion timed out after 120 s").
 */
export function failureLine(res: RunResult, timeoutMs: number, what = 'the conversion'): string {
  if (res.code === null && res.signal) return `${what} timed out after ${Math.round(timeoutMs / 1000)} s`;
  const lines = `${res.stderr}\n${res.stdout}`.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const relevant = lines.find((l) => /\b(err|error|fail|cannot|unknown|invalid|syntax|no such|unable)\b/i.test(l));
  return relevant || lines[0] || `the slicer CLI exited with code ${res.code}`;
}

/** Replace the absolute temp directory in a message: a 400 must not leak server paths (AC-6). */
export function maskTempPath(message: string, dir: string): string {
  return dir ? message.split(dir).join('<tmp>') : message;
}

/**
 * Run `fn` in a fresh temp directory under `DATA_DIR/cache/<prefix>` and remove it again, whatever
 * happens – a failed conversion or cut leaves nothing behind.
 */
export async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const root = path.join(config.cacheDir, prefix);
  await fsp.mkdir(root, { recursive: true });
  const dir = await fsp.mkdtemp(path.join(root, `${process.pid}-`));
  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ---- version / help -------------------------------------------------------

let versionCache: string | undefined;

/** Return the version string reported by the slicer binary (first line of --help). */
export async function getSlicerVersion(): Promise<string> {
  if (versionCache) return versionCache;
  try {
    const res = await runSlicer(helpArgs(), { timeoutMs: 60_000 });
    const first = (res.stdout || res.stderr).split(/\r?\n/).find((l) => /PrusaSlicer/i.test(l)) || '';
    const m = /PrusaSlicer-([0-9][^\s+]*)/.exec(first);
    versionCache = m ? m[1] : first.trim() || 'unknown';
  } catch (e) {
    versionCache = `unavailable (${(e as Error).message})`;
  }
  return versionCache;
}

export async function slicerAvailable(): Promise<boolean> {
  try {
    const res = await runSlicer(helpArgs(), { timeoutMs: 60_000 });
    return res.code === 0;
  } catch {
    return false;
  }
}

export async function getHelpText(tech: 'fff' | 'sla'): Promise<string> {
  const res = await runSlicer(helpArgs(tech), { timeoutMs: 120_000 });
  if (res.code !== 0 && !res.stdout) {
    throw new Error(`Slicer help failed (exit ${res.code}): ${res.stderr.slice(0, 500)}`);
  }
  return res.stdout;
}
