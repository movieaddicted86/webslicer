/**
 * Reading the profile repository of PrusaSlicer (P2): the fixed upstream layout, `index.idx` and the
 * engine-compatibility rule.
 *
 * The files live in `https://raw.githubusercontent.com/prusa3d/PrusaSlicer-settings/master/live/<VendorId>/`:
 * `index.idx` lists one line per bundle version (`<version> <description>`, newest **first**), and a
 * `min_slic3r_version = x.y.z` / `max_slic3r_version = x.y.z` line applies to every version line
 * **below** it until the next such line – that is how PrusaSlicer's own preset updater reads it. A
 * version with no `min_slic3r_version` runs on every engine; one with a `max_slic3r_version` was
 * retired from engines at or above that version.
 *
 * This module is pure: it reads text and answers values. The download, the temporary files and the
 * atomic rename are `services/profileUpdate.ts`.
 */
import { compareVersions } from './update.js';

/** The one host, repository and branch the updater may talk to. */
export const PROFILE_HOST = 'raw.githubusercontent.com';
export const PROFILE_REPO = 'prusa3d/PrusaSlicer-settings';
export const PROFILE_BRANCH = 'master';

/** A vendor folder name: nothing but letters, digits, `_` and `-` – it becomes a URL path segment. */
export const VENDOR_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** A bundle version as the repository names its files (`1.14.2.ini`, `2.0.0-alpha1.ini`). */
export const BUNDLE_VERSION_PATTERN = /^[0-9][0-9A-Za-z.+-]*$/;

/** An asset name a bundle may reference – the server builds the URL from an allowlist pattern, never from a response. */
export const PROFILE_ASSET_PATTERN = /^[A-Za-z0-9_.-]+\.(svg|png|stl)$/;

/** The fixed URL of one file in a vendor folder. Throws on anything that is not a valid vendor/version/asset name. */
export function profileUrl(vendorId: string, file: string): string {
  if (!VENDOR_ID_PATTERN.test(vendorId)) throw new Error(`invalid vendor id "${vendorId}"`);
  if (!/^[A-Za-z0-9_.-]+$/.test(file)) throw new Error(`invalid file name "${file}"`);
  return `https://${PROFILE_HOST}/${PROFILE_REPO}/${PROFILE_BRANCH}/live/${vendorId}/${file}`;
}

/** The page a user can open to read what changed; the JSON `url` of a vendor update. */
export function profilePageUrl(vendorId: string): string {
  if (!VENDOR_ID_PATTERN.test(vendorId)) throw new Error(`invalid vendor id "${vendorId}"`);
  return `https://github.com/${PROFILE_REPO}/tree/${PROFILE_BRANCH}/live/${vendorId}`;
}

/** One version line of an `index.idx`, with the engine range that applies to it. */
export interface IndexVersion {
  version: string;
  description: string;
  /** lowest engine version the bundle runs on */
  minEngine?: string;
  /** highest engine version the bundle runs on (a retired range) */
  maxEngine?: string;
}

/**
 * Parse an `index.idx`.
 *
 * The format is PrusaSlicer's own (`src/slic3r/Config/Version.cpp`, `Index::load`): the file is
 * ordered newest first, a `min_slic3r_version`/`max_slic3r_version` line sets one bound for every
 * version line **below** it, and a later line of the same key replaces that bound. The two bounds are
 * independent – a `min_slic3r_version` does not close a `max_slic3r_version` that was set above it
 * (the real file relies on that: everything below `max_slic3r_version = 2.7.9` stays capped).
 * Comment lines start with `#`, an empty value is an open interval, and anything else that is not a
 * version line is ignored rather than guessed at.
 */
export function parseIndex(text: string): IndexVersion[] {
  const out: IndexVersion[] = [];
  let minEngine: string | undefined;
  let maxEngine: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const bound = /^(min|max)_slic3r_version\s*=\s*(.*)$/.exec(line);
    if (bound) {
      const value = bound[2].trim() || undefined;
      if (bound[1] === 'min') minEngine = value;
      else maxEngine = value;
      continue;
    }
    const version = /^(\S+)(?:\s+(.*))?$/.exec(line);
    if (!version || !BUNDLE_VERSION_PATTERN.test(version[1])) continue;
    out.push({
      version: version[1],
      description: (version[2] ?? '').trim(),
      ...(minEngine ? { minEngine } : {}),
      ...(maxEngine ? { maxEngine } : {}),
    });
  }
  return out;
}

/**
 * Whether a version entry may run on `engine`. Two rules of PrusaSlicer's own (`Version::is_slic3r_supported`):
 * both bounds are inclusive, and a released engine ignores a pre-release bundle (the other way round is
 * fine: an alpha PrusaSlicer loads any configuration).
 */
export function engineCompatible(entry: Pick<IndexVersion, 'version' | 'minEngine' | 'maxEngine'>, engine: string): boolean {
  if (entry.minEngine && compareVersions(engine, entry.minEngine) < 0) return false;
  if (entry.maxEngine && compareVersions(engine, entry.maxEngine) > 0) return false;
  const prerelease = /^[0-9][0-9A-Za-z.+]*-([0-9A-Za-z.-]+)$/.exec(entry.version)?.[1];
  if (prerelease && !/-[0-9A-Za-z.-]+$/.test(engine)) return false;
  return true;
}

/** The newest entry of an index, whatever its engine range. */
export function newestEntry(entries: readonly IndexVersion[]): IndexVersion | undefined {
  let newest: IndexVersion | undefined;
  for (const entry of entries) if (!newest || compareVersions(entry.version, newest.version) > 0) newest = entry;
  return newest;
}

/** The newest entry that runs on `engine`, or `undefined` when every listed version is out of range. */
export function newestCompatible(entries: readonly IndexVersion[], engine: string): IndexVersion | undefined {
  let newest: IndexVersion | undefined;
  for (const entry of entries) {
    if (!engineCompatible(entry, engine)) continue;
    if (!newest || compareVersions(entry.version, newest.version) > 0) newest = entry;
  }
  return newest;
}

/** The `config_version` of a bundle text (`[vendor]` section), or `undefined`. Parsed without the bundle loader. */
export function configVersionOf(text: string): string | undefined {
  let vendor = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      vendor = line.toLowerCase() === '[vendor]';
      continue;
    }
    if (!vendor || line.startsWith('#') || line.startsWith(';')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    if (line.slice(0, eq).trim() === 'config_version') return line.slice(eq + 1).trim() || undefined;
  }
  return undefined;
}
