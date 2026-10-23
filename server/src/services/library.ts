/**
 * File library: a mounted directory with models (STL/OBJ/3MF/AMF), projects (3MF) and G-code.
 * Lets users pick files that were copied in via NAS/SMB without a browser upload, and store
 * projects and sliced G-code next to them.
 *
 * No Express here: the routes validate the query and respond, this module does the file work. All
 * file I/O is `fs/promises` (N-7) – a request must not block the event loop on a slow NAS mount.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Dirent } from 'node:fs';
import { config } from '../config.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { safeName as sharedSafeName, type LibraryEntry } from '@webslicer/shared';

/** Step files are models too (T-009): the listing shows them like an STL and the import converts them. */
export const MODEL_EXT = new Set(['.stl', '.obj', '.3mf', '.amf', '.step', '.stp']);
export const GCODE_EXT = new Set(['.gcode', '.bgcode', '.gco', '.g']);

/**
 * Resolve a user supplied relative path inside the library; rejects escapes.
 *
 * The lexical check alone is not enough on a NAS share: a symlink inside the library can point
 * outside it (S10). `resolveLibraryPath` therefore also returns the *resolved* path when the target
 * (or its closest existing ancestor) leaves the library root, and `assertInsideLibrary` refuses it.
 * Paths that do not exist yet are compared through their deepest existing ancestor, so a write
 * cannot create a file behind a symlinked directory either.
 */
export function resolveLibraryPath(rel: string | undefined): string {
  const clean = String(rel || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (clean.split('/').some((p) => p === '..')) throw new ValidationError('invalid path');
  const abs = path.resolve(config.libraryDir, clean);
  const root = path.resolve(config.libraryDir);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new ValidationError('invalid path');
  return abs;
}

/** The real path of `target`, or of its deepest existing ancestor plus the rest of the name. */
async function realTarget(target: string): Promise<string> {
  let current = path.resolve(target);
  const rest: string[] = [];
  for (;;) {
    try {
      const real = await fs.realpath(current);
      return path.join(real, ...rest);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(target);
      rest.unshift(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Refuse a path whose real location is outside the library root (S10). Without this a symlink on the
 * share – or a symlinked library root itself – lets a request read or write anywhere the service
 * user may.
 */
export async function assertInsideLibrary(abs: string): Promise<void> {
  const [realRoot, realAbs] = await Promise.all([
    fs.realpath(config.libraryDir).catch(() => path.resolve(config.libraryDir)),
    realTarget(abs),
  ]);
  if (realAbs !== realRoot && !realAbs.startsWith(realRoot + path.sep)) {
    // the path itself is not echoed: a 400 has to be enough to refuse it (S10)
    throw new ValidationError('invalid path');
  }
}

/** Resolve and check a library path in one step. */
export async function resolveInsideLibrary(rel: string | undefined): Promise<string> {
  const abs = resolveLibraryPath(rel);
  await assertInsideLibrary(abs);
  return abs;
}

/** Path relative to the library root, with forward slashes (what the client addresses). */
export function libraryRelativePath(abs: string): string {
  return path.relative(config.libraryDir, abs).replace(/\\/g, '/');
}

function kindOf(name: string): LibraryEntry['kind'] {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.3mf') return 'project';
  if (MODEL_EXT.has(ext)) return 'model';
  if (GCODE_EXT.has(ext)) return 'gcode';
  return 'other';
}

/** A user supplied file name, reduced to a safe base name; the rule itself is shared (W4). */
export function safeName(name: string): string {
  const n = sharedSafeName(name);
  if (!n) throw new ValidationError('invalid name');
  return n;
}

/** Files and folders of one library directory. */
export async function listLibrary(rel: string): Promise<{ path: string; entries: LibraryEntry[] }> {
  const abs = await resolveInsideLibrary(rel);
  const relPath = libraryRelativePath(abs);
  let names: Dirent[];
  try {
    names = await fs.readdir(abs, { withFileTypes: true });
  } catch {
    throw new NotFoundError('directory not found');
  }
  const entries = await Promise.all(
    names
      .filter((d) => !d.name.startsWith('.'))
      .map(async (d): Promise<LibraryEntry | undefined> => {
        const relEntry = relPath ? `${relPath}/${d.name}` : d.name;
        if (d.isDirectory()) return { name: d.name, path: relEntry, dir: true };
        if (!d.isFile()) return undefined;
        let st;
        try {
          st = await fs.stat(path.join(abs, d.name));
        } catch {
          return undefined;
        }
        return { name: d.name, path: relEntry, dir: false, size: st.size, mtime: st.mtime.toISOString(), kind: kindOf(d.name) };
      }),
  );
  const present = entries.filter((e): e is LibraryEntry => e !== undefined);
  present.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.dir ? -1 : 1));
  return { path: relPath, entries: present };
}

/** Absolute path of a library file, or a 404 if it is not a regular file. */
export async function resolveLibraryFile(rel: string | undefined): Promise<string> {
  const abs = await resolveInsideLibrary(rel);
  let st;
  try {
    st = await fs.stat(abs);
  } catch {
    throw new NotFoundError('file not found');
  }
  if (!st.isFile()) throw new NotFoundError('file not found');
  return abs;
}

/** Write an uploaded body into the library. */
export async function writeLibraryFile(rel: string | undefined, buf: Buffer): Promise<{ path: string; size: number }> {
  return writeLibraryData(await resolveInsideLibrary(rel), buf);
}

/**
 * Write a buffer to an absolute path the caller has already checked (a path built by
 * `libraryTarget`) and report it the way the client addresses it.
 */
export async function writeLibraryData(abs: string, buf: Buffer): Promise<{ path: string; size: number }> {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buf);
  return { path: libraryRelativePath(abs), size: buf.length };
}

/** Create a directory inside the library. */
export async function makeLibraryDir(parentRel: string | undefined, name: string): Promise<{ path: string }> {
  const abs = path.join(await resolveInsideLibrary(parentRel), safeName(name));
  await assertInsideLibrary(abs);
  await fs.mkdir(abs, { recursive: true });
  return { path: libraryRelativePath(abs) };
}

/**
 * Delete a library file or an empty directory. The library root itself is refused, so a client
 * cannot wipe the mounted share with one request.
 */
export async function deleteLibraryEntry(rel: string | undefined): Promise<void> {
  const abs = await resolveInsideLibrary(rel);
  if (abs === path.resolve(config.libraryDir)) throw new ValidationError('cannot delete the library root');
  let st;
  try {
    st = await fs.stat(abs);
  } catch {
    throw new NotFoundError('not found');
  }
  if (!st.isDirectory()) return void (await fs.unlink(abs));
  const inside = await fs.readdir(abs);
  if (inside.length) throw new ValidationError('directory not empty');
  await fs.rmdir(abs);
}

/**
 * Target file of a write into the library: `<dir>/<safeName><ext>`. The target is checked against
 * the root in its real form (`libraryTargetChecked`) before anything is written.
 */
export function libraryTarget(dirRel: string | undefined, name: string, ext: string): string {
  const base = safeName(name).replace(new RegExp(`${ext.replace('.', '\\.')}$`, 'i'), '');
  return path.join(resolveLibraryPath(dirRel), `${base}${ext}`);
}

/** `libraryTarget` with the symlink check of S10 – what every write route uses. */
export async function libraryTargetChecked(dirRel: string | undefined, name: string, ext: string): Promise<string> {
  const target = libraryTarget(dirRel, name, ext);
  await assertInsideLibrary(target);
  return target;
}

/** Copy a file into the library at an already resolved target path. */
export async function copyIntoLibrary(from: string, to: string): Promise<{ path: string; size: number }> {
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
  return { path: libraryRelativePath(to), size: (await fs.stat(to)).size };
}
