/**
 * Slicer options the server never lets a client set (SEC-1, T-024).
 *
 * PrusaSlicer acts on these values *on the host* rather than inside the G-code:
 *
 * - `post_process` – a list of shell commands PrusaSlicer runs through `/bin/sh` after the G-code
 *   export. 2.9.6 logs "A post-processing script has been detected in the config data" and asks
 *   "Continue(Y/N)?"; a client that can set the key runs commands as the service user.
 * - `output_filename_format` – the output file name. The slicer expands it against its own working
 *   directory and accepts `../`, so a client that can set it writes (and overwrites) files anywhere
 *   the service user can reach.
 *
 * The list is declared once here because both sides need it: the server drops the keys from every
 * merged config (`server/src/services/configMerge.ts`) and refuses them in the MCP `set_settings`
 * tool, and the settings UI labels them as not passed on (`web/src/components/OptionField.tsx`) – an
 * option the server deletes is not something a user should be able to edit and expect to work.
 */

/** Preset options the server removes before a config reaches the slicer. */
export const SERVER_ONLY_KEYS: ReadonlySet<string> = new Set(['output_filename_format', 'post_process']);

/** The keys as a sorted array – the order every message and list uses. */
export const SERVER_ONLY_KEY_LIST: readonly string[] = [...SERVER_ONLY_KEYS].sort();

/** Why the server refuses a key, in one sentence – shown to a user and to an MCP client. */
const REASONS: Record<string, string> = {
  post_process: 'PrusaSlicer would run it as a command on the server',
  output_filename_format: 'it names the output file and could leave the job directory',
};

/** The reason a server-only key is refused; a generic sentence for a key without its own text. */
export function serverOnlyReason(key: string): string {
  return REASONS[key] ?? 'the server removes it before slicing';
}

/** The note the settings UI shows next to a server-only option; `undefined` for every other key. */
export function serverOnlyNote(key: string): string | undefined {
  return SERVER_ONLY_KEYS.has(key) ? `Not passed to the slicer: ${serverOnlyReason(key)}.` : undefined;
}
