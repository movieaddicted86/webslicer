/**
 * The JSON stores (printers, projects, MCP tokens, installed printers) share two rules (B7):
 *
 * 1. **Writes are atomic**: the file is written to a temporary name in the same directory and then
 *    renamed over the original. A crash, a full disk or a killed container leaves either the old file
 *    or the new one, never a truncated file that the next start parses as "no data".
 * 2. **A corrupt file is quarantined, not treated as empty**: an unparseable file is moved aside as
 *    `<name>.corrupt-<timestamp>` and reported in the log. The old code answered "empty list", and the
 *    next save then overwrote the only copy of the data.
 *
 * The functions are async where their callers are (`printers`, `projects`) and sync where the store is
 * sync (`presets`, `tokens`), so each store keeps its own call shape.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Why a read answered `undefined`: the file is missing, or it was corrupt and has been set aside. */
export interface ReadResult<T> {
  value: T | undefined;
  /** set when the file existed but could not be parsed; it has been renamed already */
  corrupt?: string;
}

function corruptName(file: string): string {
  return `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

/** Move a bad file aside so its content is not lost and the next write starts from a clean state. */
function quarantineSync(file: string): string | undefined {
  const target = corruptName(file);
  try {
    fs.renameSync(file, target);
    console.error(`[webslicer] ${path.basename(file)} is corrupt and was moved to ${path.basename(target)}`);
    return target;
  } catch (e) {
    console.error(`[webslicer] ${path.basename(file)} is corrupt and could not be moved aside: ${(e as Error).message}`);
    return undefined;
  }
}

async function quarantine(file: string): Promise<string | undefined> {
  const target = corruptName(file);
  try {
    await fsp.rename(file, target);
    console.error(`[webslicer] ${path.basename(file)} is corrupt and was moved to ${path.basename(target)}`);
    return target;
  } catch (e) {
    console.error(`[webslicer] ${path.basename(file)} is corrupt and could not be moved aside: ${(e as Error).message}`);
    return undefined;
  }
}

/** Read and parse a JSON file; a missing file is `undefined`, a corrupt one is quarantined. */
export function readJsonSync<T>(file: string): ReadResult<T> {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { value: undefined };
  }
  try {
    return { value: JSON.parse(text) as T };
  } catch {
    return { value: undefined, corrupt: quarantineSync(file) };
  }
}

/** Async form of `readJsonSync`. */
export async function readJson<T>(file: string): Promise<ReadResult<T>> {
  let text: string;
  try {
    text = await fsp.readFile(file, 'utf8');
  } catch {
    return { value: undefined };
  }
  try {
    return { value: JSON.parse(text) as T };
  } catch {
    return { value: undefined, corrupt: await quarantine(file) };
  }
}

/** Write text atomically: temp file in the same directory, then rename over the target. */
export async function writeText(file: string, text: string, mode: number = 0o644): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
  try {
    await fsp.writeFile(tmp, text, { mode });
    await fsp.rename(tmp, file);
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  }
}

/** Write JSON atomically. */
export async function writeJson(file: string, value: unknown, mode: number = 0o644): Promise<void> {
  await writeText(file, JSON.stringify(value, null, 2), mode);
}

/** Sync form of `writeText` (the token and preset stores are synchronous). */
export function writeTextSync(file: string, text: string, mode: number = 0o644): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
  try {
    fs.writeFileSync(tmp, text, { mode });
    fs.renameSync(tmp, file);
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
    throw e;
  }
}

/** Sync form of `writeJson`. */
export function writeJsonSync(file: string, value: unknown, mode: number = 0o644): void {
  writeTextSync(file, JSON.stringify(value, null, 2), mode);
}
