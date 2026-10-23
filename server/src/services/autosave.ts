/**
 * The autosave slot of a browser client: `DATA_DIR/autosave/<client>.3mf`, written on every plater
 * change and read back when the browser asks for it again.
 *
 * The client id is checked here as well as in the route, because it becomes a file name.
 *
 * The read side answers *paths*, not bytes: the route serves the file with `sendFile`, which adds the
 * conditional-request headers (`ETag`, `Last-Modified`, ranges) the browser uses to revalidate a
 * large 3MF instead of downloading it again.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { activeSchema } from './schema.js';
import { build3mfForRequest, validateSliceRequest } from './slice.js';
import { mergeConfigs } from './configMerge.js';
import { ValidationError } from '../errors.js';
import type { SliceRequest } from '@webslicer/shared';

/** A client id that is safe to use as a file name. */
export function isAutosaveClientId(value: unknown): string | undefined {
  const id = String(value || '');
  return /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : undefined;
}

/** File of the autosave slot of a client (already validated by `isAutosaveClientId`). */
export function autosaveFile(id: string): string {
  return path.join(config.autosaveDir, `${id}.3mf`);
}

/** Store the autosave of a client. */
export async function writeAutosave(id: string, buf: Buffer): Promise<void> {
  await fs.mkdir(config.autosaveDir, { recursive: true });
  await fs.writeFile(autosaveFile(id), buf);
}

/** The stored autosave file and its modification time, or undefined when there is none. */
export async function findAutosave(id: string): Promise<{ file: string; savedAt: string } | undefined> {
  const file = autosaveFile(id);
  try {
    const st = await fs.stat(file);
    if (!st.isFile()) return undefined;
    return { file, savedAt: st.mtime.toISOString() };
  } catch {
    return undefined;
  }
}

/** Just the metadata of a stored autosave (`GET /api/autosave/:client?info`). */
export async function readAutosaveInfo(id: string): Promise<{ savedAt: string; size: number } | undefined> {
  const file = autosaveFile(id);
  try {
    const st = await fs.stat(file);
    return { savedAt: st.mtime.toISOString(), size: st.size };
  } catch {
    return undefined;
  }
}

/** Forget the autosave of a client; a missing file is not an error. */
export async function deleteAutosave(id: string): Promise<void> {
  try {
    await fs.unlink(autosaveFile(id));
  } catch {
    /* ignore */
  }
}

/**
 * Build the 3MF a plater autosave stores: the validated request, merged with its presets as a
 * project. An invalid body is the client's 400, not an internal error.
 */
export async function buildAutosave(raw: unknown): Promise<Buffer> {
  let body: SliceRequest;
  try {
    body = validateSliceRequest(raw);
  } catch (e) {
    throw new ValidationError((e as Error).message);
  }
  const schema = await activeSchema();
  return build3mfForRequest(body, mergeConfigs(schema, body, { forProject: true }));
}
