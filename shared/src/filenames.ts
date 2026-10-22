/**
 * File names that come from a user (W4): one implementation for the library and the preset store.
 *
 * Both used to carry their own `safeName`, and they disagreed – the library took the base name first
 * and refused an empty result, the preset store kept a leading directory part. A name is written to
 * disk under a directory the server owns, so the rule has to be one rule. Pure string work: no
 * `node:path`, because this package is also bundled for the browser.
 */

/** Characters that must not reach a file name: Windows' reserved set plus the control range. */
// eslint-disable-next-line no-control-regex -- stripping the control range is the point
const UNSAFE = /[<>:"/\\|?*\x00-\x1f]/g;

/**
 * A user supplied name reduced to a safe base name: the last path segment, unsafe characters replaced
 * by `_`, trimmed. An empty result (or `.`/`..`) is returned as an empty string so the caller can
 * decide whether that is an error (the library) or simply means "no name" (a preset).
 */
export function safeName(name: unknown): string {
  const base = String(name ?? '')
    .split(/[/\\]/)
    .pop();
  const cleaned = (base || '').replace(UNSAFE, '_').trim();
  return cleaned === '.' || cleaned === '..' ? '' : cleaned;
}
