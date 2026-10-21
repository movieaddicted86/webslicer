/**
 * The server-only key list and its reasons (SEC-1, T-024).
 *
 * The list itself lives in `@webslicer/shared`, because the settings UI has to show the same note;
 * this module is the server's entry point to it and the one place the slicing code imports the rule
 * from. Keeping a second copy of the keys here would let the UI and the merge drift apart.
 */
import { SERVER_ONLY_KEYS, serverOnlyReason, type Config } from '@webslicer/shared';

export { SERVER_ONLY_KEYS, serverOnlyReason };

/**
 * A copy of a preset config without the server-only keys.
 *
 * Returns a new object and never mutates the caller's config: the same request object is handed to
 * the 3MF writer and the job runner, and a request may be reused across calls.
 */
export function stripServerOnly(config: Config | undefined): Config {
  const out: Config = { ...(config ?? {}) };
  for (const key of SERVER_ONLY_KEYS) delete out[key];
  return out;
}
