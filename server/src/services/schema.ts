/**
 * The PrusaSlicer option schema, loaded once per process.
 *
 * Building it spawns the slicer binary twice (`--help-fff`, `--help-sla`), so it must not happen per
 * request and not in three places: `index.ts` loads it at startup and hands it over, and the first
 * request would build it if that startup step failed (the server stays usable for the routes that do
 * not need the schema).
 */
import { getSchema } from '../slicer/schema.js';
import { loadBundles } from '../slicer/bundles.js';
import type { Schema } from '@webslicer/shared';

let active: Schema | undefined;

/** Install an already-built schema (startup, tests). */
export function setActiveSchema(schema: Schema): void {
  active = schema;
}

/** The option schema; built from the installed slicer on first use. */
export async function activeSchema(): Promise<Schema> {
  if (!active) active = await getSchema(loadBundles().keys);
  return active;
}
