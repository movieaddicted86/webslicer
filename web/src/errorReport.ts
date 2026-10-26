/**
 * The one path a UI error takes (P-7): `createRoot`'s `onUncaughtError`/`onCaughtError` and the region
 * boundaries of `ErrorBoundary` all end here. The error is named in the console with its stack (the
 * developer's log) and shown to the user as an error toast – the same path the store's failed actions
 * use – so a broken region is never a silent blank card.
 *
 * One toast per distinct message and region within a short window: a component that throws on every
 * render would otherwise push a hundred identical toasts through `onCaughtError` alone.
 */
import { useStore } from './state/store';

const recent = new Map<string, number>();
/** how long one message is remembered (a toast itself lives 9 s) */
const REPEAT_MS = 10_000;

export function reportUiError(error: unknown, where: string): void {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[webslicer] UI error in ${where}: ${message}`, error);

  const key = `${where}|${message}`;
  const now = Date.now();
  if ((recent.get(key) ?? 0) > now - REPEAT_MS) return;
  recent.set(key, now);
  for (const [k, at] of recent) if (at < now - REPEAT_MS) recent.delete(k);

  useStore.getState().toast('error', `Something went wrong (${where}). Reload view to try again.`);
}
