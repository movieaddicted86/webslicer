/**
 * The one import button of the app (the menu's hidden file input) opened from elsewhere.
 *
 * `runNavAction({kind: 'import'})` returns `true` and leaves the click to its host – that is the menu.
 * A second host (the empty object list's "Add objects…" button) must not grow its own input or its own
 * menu entry: it asks the registered host to open the same input through this plain setter, the same
 * pattern as `thumbnailRenderer.ts`. No store state, no second dialog.
 */
type ImportOpener = () => void;

let opener: ImportOpener | undefined;

/** Register (or clear, with `undefined`) the host that owns the hidden file input. */
export function setImportOpener(fn?: ImportOpener): void {
  opener = fn;
}

/** Open the file dialog through the registered host; nothing happens without one. */
export function requestImport(): void {
  opener?.();
}
