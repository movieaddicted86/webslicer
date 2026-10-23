/**
 * The viewer's thumbnail renderer (q4-web-store, AC-4): the Viewer registers its scene-bound
 * renderer through this plain setter, so the callback is no longer part of the store state and the
 * store can ask for thumbnails without importing three.js.
 */
import type { ThumbnailInput, ThumbnailSpec } from '@webslicer/shared';

/** Renders the requested G-code preview thumbnails of the plater (the Viewer supplies it). */
export type ThumbnailRenderer = (specs: ThumbnailSpec[], colors: string[]) => ThumbnailInput[];

let renderer: ThumbnailRenderer | undefined;

/** Register (or clear, with `undefined`) the Viewer's thumbnail renderer. */
export function setThumbnailRenderer(fn?: ThumbnailRenderer): void {
  renderer = fn;
}

/** Is a Viewer mounted that can render thumbnails? */
export function hasThumbnailRenderer(): boolean {
  return !!renderer;
}

/** Render thumbnails through the registered renderer; empty when no Viewer is mounted. */
export function renderThumbnails(specs: ThumbnailSpec[], colors: string[]): ThumbnailInput[] {
  return renderer ? renderer(specs, colors) : [];
}
