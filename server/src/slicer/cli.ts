import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { config } from '../config.js';

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

/** Spawn the PrusaSlicer binary with the given arguments. */
export function runSlicer(args: string[], opts: RunOptions = {}): Promise<RunResult> {
  // a signal that was aborted before the call must not start a process that nobody stops (B6: a
  // cancel during preparation aborts the controller before the CLI is spawned)
  if (opts.signal?.aborted) return Promise.resolve({ code: null, stdout: '', stderr: '', signal: 'SIGKILL' });
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
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', abort);
      resolve({ code, stdout, stderr, signal });
    });
  });
}

let versionCache: string | undefined;

/** Return the version string reported by the slicer binary (first line of --help). */
export async function getSlicerVersion(): Promise<string> {
  if (versionCache) return versionCache;
  try {
    const res = await runSlicer(['--help'], { timeoutMs: 60_000 });
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
    const res = await runSlicer(['--help'], { timeoutMs: 60_000 });
    return res.code === 0;
  } catch {
    return false;
  }
}

export async function getHelpText(tech: 'fff' | 'sla'): Promise<string> {
  const res = await runSlicer([tech === 'fff' ? '--help-fff' : '--help-sla'], { timeoutMs: 120_000 });
  if (res.code !== 0 && !res.stdout) {
    throw new Error(`Slicer help failed (exit ${res.code}): ${res.stderr.slice(0, 500)}`);
  }
  return res.stdout;
}
