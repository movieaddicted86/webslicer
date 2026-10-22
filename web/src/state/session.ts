/**
 * What happens when the app starts (T-035): the plater of the last session comes back without a
 * click, from the server autosave or – when a flush was newer than the server file – from the local
 * cache of that flush. The rule itself is `decideSessionStart` in `sessionStart.ts`.
 */
import { autosaveApi } from '../api';
import { restoreAutosave } from '../importFiles';
import { clientId } from './client';
import { clearCachedRequest, clearPendingFlush, pendingFlush, readCachedRequest } from './sessionCache';
import { decideSessionStart } from './sessionStart';
import { useStore } from './store';

/** "Start empty": drop the restored plater and forget the autosave, so a reload stays empty. */
export function startEmpty(): void {
  const s = useStore.getState();
  s.clearObjects();
  void s.discardAutosave();
}

/** Startup runs once per page, even when React's StrictMode mounts the app effect twice. */
let started = false;

/** Restore the last session if there is one; a failure keeps the objects list with the error. */
export async function startSession(): Promise<void> {
  if (started) return;
  started = true;
  await runStart();
}

/** The "Retry" of a failed automatic restore: the error stays until the attempt reports back. */
export async function retrySession(): Promise<void> {
  useStore.setState({ autosaveError: undefined });
  await runStart();
}

async function runStart(): Promise<void> {
  if (useStore.getState().objects.length) return;
  const [info, cache] = await Promise.all([autosaveApi.info(clientId()).catch(() => undefined), readCachedRequest()]);
  // A flush that never reported back may still land (a keepalive request outlives the page). Give it
  // a moment, so the start does not restore the file the flush was about to replace.
  const server = isPendingFlushOlderThan(info) ? await waitForServerFlush(info) : info;
  const start = decideSessionStart({ objectsPresent: false, server, cache });
  if (start.source === 'none') return;
  try {
    if (start.source === 'cache') {
      // The cached request is the one the page had; writing it to the server rebuilds the 3MF, and
      // the normal restore path imports it from there.
      await autosaveApi.save(clientId(), start.request);
      await clearCachedRequest();
      clearPendingFlush();
    }
    await restoreAutosave({ quiet: true });
    clearPendingFlush();
    useStore.getState().toast('success', 'Previous session restored', { label: 'Start empty', run: startEmpty });
  } catch (e) {
    useStore.setState({ autosaveError: (e as Error).message });
  }
}

/** How long a start waits for a pending flush to become the server's file (two polls of 400 ms). */
const FLUSH_WAIT_MS = 1500;
const POLL_MS = 400;

/** True when the page left a flush behind that the current server file does not reflect yet. */
function isPendingFlushOlderThan(server: Awaited<ReturnType<typeof autosaveApi.info>>): boolean {
  const pending = pendingFlush();
  if (pending === undefined) return false;
  if (!server) return true;
  const saved = Date.parse(server.savedAt);
  return Number.isFinite(saved) ? saved < pending - 1000 : true;
}

/** Poll the autosave info until the file is at least as new as the pending flush, or the wait is over. */
async function waitForServerFlush(server: Awaited<ReturnType<typeof autosaveApi.info>>) {
  const pending = pendingFlush() ?? 0;
  const deadline = Date.now() + FLUSH_WAIT_MS;
  let current = server;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    current = await autosaveApi.info(clientId()).catch(() => current);
    if (current && Date.parse(current.savedAt) >= pending - 1000) return current;
  }
  return current;
}
