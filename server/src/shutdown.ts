/**
 * Clean stop (W5): Docker and Proxmox stop the process with SIGTERM. Without a handler the running
 * slicer processes died with the process – a half-written job and a stale temp file in `/data`.
 *
 * The sequence: stop accepting connections, let the queue refuse new jobs, cancel the running slicers
 * and wait for their cleanup, then exit. A second signal exits immediately; a cleanup that hangs is
 * cut off after `SHUTDOWN_GRACE_MS`.
 *
 * The pieces are injected so the sequence can be tested without starting a server; `index.ts` wires
 * the real listener and the job queue in.
 */
import type { Server } from 'node:http';
import { shutdownJobs } from './jobs.js';

/** How long a connection may keep the process alive after the listeners are closed. */
export const SHUTDOWN_GRACE_MS = 5000;

export interface ShutdownDeps {
  /** `server.close()` – no new connection is accepted, the open ones keep the process alive */
  closeServer: () => void;
  /** cancel the running jobs and wait for their runners to finish */
  stopJobs: () => Promise<void>;
  exit: (code: number) => void;
  graceMs?: number;
}

/**
 * Run one shutdown. Resolves (and calls `exit`) exactly once per call, with 0 on success and 1 when
 * the cleanup failed or took too long.
 */
export async function shutdown(deps: ShutdownDeps, signal: string): Promise<void> {
  console.log(`[webslicer] ${signal}: shutting down`);
  deps.closeServer();
  const graceMs = deps.graceMs ?? SHUTDOWN_GRACE_MS;
  let timer: NodeJS.Timeout | undefined;
  const tooSlow = new Promise<number>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[webslicer] shutdown took longer than ${graceMs} ms – exiting`);
      resolve(1);
    }, graceMs);
    // not unref'd on purpose: the grace timer is the one handle that must keep the process alive
    // while a stuck cleanup is being waited for; `clearTimeout` removes it on the normal path
  });
  let code = 0;
  try {
    code = await Promise.race([deps.stopJobs().then(() => 0), tooSlow]);
  } catch (e) {
    console.error('[webslicer] shutdown cleanup failed:', e);
    code = 1;
  }
  clearTimeout(timer);
  console.log('[webslicer] stopped');
  deps.exit(code);
}

/** Install the SIGTERM/SIGINT handlers on the real process. */
export function installShutdownHandlers(server: Server): void {
  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) {
      console.warn(`[webslicer] ${signal} again – exiting now`);
      process.exit(1);
    }
    stopping = true;
    void shutdown({ closeServer: () => server.close(), stopJobs: shutdownJobs, exit: (code) => process.exit(code) }, signal);
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
}
