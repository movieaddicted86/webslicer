/**
 * The rule that keeps the context panel out of an empty tool mode: a tool whose panel can no longer
 * be shown – its object was deleted, the selection dropped to two objects, an undo took the plate
 * back – is closed through the normal path, so its cleanup runs (cut plane, brush cursor, layer
 * chart) and the panel falls back to plate or object mode with the Slice footer.
 *
 * The guard reads the state the store already has, so it needs no second copy of anything: `select`,
 * delete, merge, undo and a project load all reach it by changing `objects` or `selectedIds`.
 */
import type { State } from './types';
import { unshowableTool } from '../tools/activate';

/** The part of the store the guard listens to. */
export interface ToolGuardStore {
  getState: () => State;
  subscribe: (listener: (state: State, previous: State) => void) => () => void;
}

/**
 * Close the open tool when it cannot be shown any more; true when it was closed (its availability
 * failed while it was open), false when nothing had to happen.
 */
export function closeUnshowableTool(state: State, close: () => void): boolean {
  if (!unshowableTool(state)) return false;
  close();
  return true;
}

/** Wire the guard to the store. Returns the unsubscribe (a hot reload and the tests use it). */
export function installToolGuard(store: ToolGuardStore, close: () => void): () => void {
  return store.subscribe((s, previous) => {
    // only a change that can make the open tool unshowable is worth a look
    if (s.activeTool === previous.activeTool && s.objects === previous.objects && s.selectedIds === previous.selectedIds) return;
    closeUnshowableTool(s, close);
  });
}
