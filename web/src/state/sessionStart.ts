/**
 * The startup rule of the session restore (T-035), as a pure function so the three cases the task
 * names – empty plater restores, objects present does not, "Start empty" discards – are unit-tested
 * without a server. `session.ts` does the fetching and importing around it.
 */
import type { SliceRequest } from '../api';
import type { CachedAutosave } from './sessionCache';

/** What the start may restore from. */
export interface SessionSources {
  /** the plater already has objects – a second start, or the user imported before the check */
  objectsPresent: boolean;
  /** the server autosave of this client, if the server has one */
  server?: { savedAt: string; size: number };
  /** a local flush that may not have reached the server before the page went away */
  cache?: CachedAutosave;
}

/** The source to restore from, or `none` when the plater must stay empty. */
export type SessionStart = { source: 'none' } | { source: 'server' } | { source: 'cache'; request: SliceRequest };

/**
 * An empty plater restores the newest autosave; a plater that already has objects is left alone (the
 * user is working). The local cache only wins when it is newer than the server file – it holds the
 * same content, written seconds after the last server save.
 */
export function decideSessionStart(s: SessionSources): SessionStart {
  if (s.objectsPresent) return { source: 'none' };
  if (s.server && s.cache) {
    return s.cache.savedAt > Date.parse(s.server.savedAt)
      ? { source: 'cache', request: s.cache.request as SliceRequest }
      : { source: 'server' };
  }
  if (s.server) return { source: 'server' };
  if (s.cache) return { source: 'cache', request: s.cache.request as SliceRequest };
  return { source: 'none' };
}
