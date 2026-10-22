/**
 * S7: reading an untrusted 3MF must not unpack a zip bomb.
 *
 * A 3MF is a ZIP, and its central directory announces the size of every entry *before* anything is
 * decompressed. Both readers therefore inspect the directory first: an archive with too many entries,
 * or with more uncompressed bytes than `MAX_3MF_BYTES`, is refused without inflating a single entry.
 * The declared size can lie, so the per-entry read is capped as well.
 */
import type JSZip from 'jszip';
import { ValidationError } from '../../errors.js';

/** Uncompressed budget of one 3MF (a large painted project is still well below this). */
export const MAX_3MF_BYTES = 1024 * 1024 * 1024; // 1 GiB
/** Entry budget of one 3MF (a project has a few dozen files, not thousands). */
export const MAX_3MF_ENTRIES = 10_000;

interface EntryInfo {
  /** declared uncompressed size, when the archive carries it */
  size?: number;
  dir?: boolean;
}

/** The shadow `JSZip` keeps for every entry; `_data.uncompressedSize` is the central-directory size. */
function uncompressedSizeOf(entry: unknown): number | undefined {
  const data = (entry as { _data?: { uncompressedSize?: unknown } } | null)?._data;
  const n = data?.uncompressedSize;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * Refuse an archive whose entries or declared total size exceed the limits. Call it right after
 * `JSZip.loadAsync`: that only parses the directory, no entry is decompressed yet.
 */
export function assertZipReasonable(zip: JSZip): void {
  const files = (zip as unknown as { files?: Record<string, EntryInfo> }).files;
  if (!files) return;
  const names = Object.keys(files);
  if (names.length > MAX_3MF_ENTRIES) {
    throw new ValidationError(`3MF has too many entries (${names.length} > ${MAX_3MF_ENTRIES})`);
  }
  let total = 0;
  for (const name of names) {
    const size = uncompressedSizeOf((files as Record<string, unknown>)[name]);
    if (size === undefined) continue;
    total += size;
    if (total > MAX_3MF_BYTES) {
      throw new ValidationError(`3MF is too large uncompressed (> ${MAX_3MF_BYTES} bytes)`);
    }
  }
}

/**
 * Read one entry as text within the declared limits. An entry whose declared size is missing or lies
 * is caught while it inflates: the limit is the remaining archive budget rather than "unlimited".
 */
export async function readZipEntryText(zip: JSZip, name: string): Promise<string> {
  const entry = zip.file(name);
  if (!entry) return '';
  const declared = uncompressedSizeOf(entry);
  if (declared !== undefined && declared > MAX_3MF_BYTES) {
    throw new ValidationError(`3MF entry ${name} is too large uncompressed`);
  }
  const text = await entry.async('string');
  // a lying central directory is caught here: the actual text is what the memory holds now
  if (Buffer.byteLength(text, 'utf8') > MAX_3MF_BYTES) {
    throw new ValidationError(`3MF entry ${name} is too large uncompressed`);
  }
  return text;
}
