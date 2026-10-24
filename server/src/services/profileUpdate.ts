/**
 * Vendor bundle updates: check the profile repository, install a newer bundle, revert, and install a
 * bundle from a file for air-gapped installs.
 *
 * - **Fixed sources only.** Host `raw.githubusercontent.com`, repository `prusa3d/PrusaSlicer-settings`,
 *   branch `master`, path `live/<VendorId>/…`. The vendor id must be one of the vendors this install
 *   already has; every file name is built here (`<version>.ini`, assets from an allowlist pattern),
 *   never taken from a response as a path. Redirects are refused, each request times out after 10 s
 *   and every body is capped (bundle 5 MB, asset 5 MB).
 * - **Validate before install.** The download is parsed in a temporary directory inside the data dir.
 *   The bundle has to name this vendor, carry a newer `config_version`, and pass the limit sweep of
 *   the bundled profiles plus the preflight scanner over its start/layer/end G-code. A block-level
 *   finding refuses the whole bundle; nothing is written. G-code rules the vendor's bundle in use
 *   already trips are reported, not treated as new (see `bundleFindings`).
 * - **Nothing changes without a click.** The check may run once per 24 h and only when
 *   `WEBSLICER_UPDATE_CHECK` is not `off`; installing is always the user's action.
 * - **Newer wins.** The bundle is renamed into `<dataDir>/vendor/<VendorId>.ini` (the previous file
 *   stays as `.prev`), then `loadBundles(true)` makes it the one in use. `loadBundles` picks the
 *   highest `config_version` per vendor id, so the image's copy remains the fallback, and a revert is
 *   one rename back.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  BUNDLE_VERSION_PATTERN,
  PREFLIGHT_SEVERITY,
  PROFILE_ASSET_PATTERN,
  VENDOR_ID_PATTERN,
  checkConfigValues,
  configVersionOf,
  hasLoneCarriageReturn,
  isNewerVersion,
  isValidConfigKey,
  newestCompatible,
  newestEntry,
  parseIndex,
  profilePageUrl,
  profileUrl,
  scanGcodeText,
  type BundleRefusal,
  type IndexVersion,
  type PresetType,
  type VendorPresetWithoutParent,
  type VendorUpdate,
  type VendorUpdateList,
  type VendorUpdateResult,
} from '@webslicer/shared';
import { config } from '../config.js';
import { ConflictError, HttpError, NotFoundError, ValidationError } from '../errors.js';
import { loadBundles, parseBundle, vendorDataDir, type BundleData, type SystemPreset } from '../slicer/bundles.js';
import { listUserPresets, userPresetExists } from '../slicer/presets.js';
import { getSlicerVersion } from '../slicer/cli.js';
import { isUpdateCheckEnabled } from './updateCheck.js';
import { readJson, writeJson } from '../storage/jsonStore.js';

/** How long one request to the profile repository may take. */
export const PROFILE_TIMEOUT_MS = 10_000;
/** The largest bundle the updater accepts. */
export const MAX_BUNDLE_BYTES = 5 * 1024 * 1024;
/** The largest single asset (bed model, texture, thumbnail) the updater accepts. */
export const MAX_ASSET_BYTES = 5 * 1024 * 1024;
/** The largest `index.idx` (the real one is about 25 KB). */
export const MAX_INDEX_BYTES = 1024 * 1024;
/** The check runs at most once a day per installation, like the update notice. */
export const PROFILE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** How many assets one bundle may reference; far above the real count, low enough to bound the work. */
const MAX_ASSETS = 200;
/** How many requests are made at once. */
const CONCURRENCY = 4;
/** Preset types in the order the contract lists them. */
const PRESET_TYPES: readonly PresetType[] = ['print', 'filament', 'printer', 'sla_print', 'sla_material'];

/** The downloader the updater uses; injected in tests, the global `fetch` otherwise. */
export type ProfileFetch = typeof fetch;

export interface ProfileUpdaterOptions {
  /** `false` with `WEBSLICER_UPDATE_CHECK=off`: no request at all is made */
  enabled: boolean;
  /** the running PrusaSlicer version (`2.9.6`); an unknown one makes every bundle incompatible */
  engineVersion: string;
  /** `<dataDir>/vendor` – where an installed bundle and its assets live */
  vendorDir: string;
  /** where the result of the last check is kept */
  cacheFile: string;
  fetch?: ProfileFetch;
  now?: () => Date;
  /** debug logging; defaults to a `[profiles]` console line */
  log?: (message: string) => void;
}

/** What the check learned about one vendor; this is what the cache stores. */
export interface VendorObservation {
  available?: string;
  compatible: boolean;
  reason?: string;
}

interface ObservationCache {
  checkedAt: string;
  vendors: Record<string, VendorObservation>;
}

/** A bundle that passed every check, ready to be moved into place. */
interface ValidatedBundle {
  version: string;
  presets: SystemPreset[];
  assets: string[];
  refusals: BundleRefusal[];
  preExisting: BundleRefusal[];
}

/** The findings of one bundle, split into what refuses it and what the vendor already ships. */
export interface BundleFindings {
  refusals: BundleRefusal[];
  preExisting: BundleRefusal[];
}

export interface ProfileUpdater {
  readonly enabled: boolean;
  /** the list the API answers; `refresh` forces a check even inside the 24 h window */
  list(refresh?: boolean): Promise<VendorUpdateList>;
  /** install the newest compatible upstream bundle of an installed vendor */
  install(vendorId: string): Promise<VendorUpdateResult>;
  /** go back to the previous bundle (`.prev`, or the image's copy) */
  revert(vendorId: string): Promise<VendorUpdateResult>;
  /**
   * Install a bundle the user picked; the same validation as an online install. The vendor is the one
   * the file names (`vendor_id`, else the folder of its `config_update_url`) and has to be installed.
   */
  installFromFile(file: string): Promise<VendorUpdateResult>;
}

// ---------------------------------------------------------------------------
// Bundle validation (pure, exported for the tests)
// ---------------------------------------------------------------------------

/** PrusaSlicer stores G-code in a bundle as one line with `\n` escapes; undo them for the scanner. */
export function unescapeGcode(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c !== '\\' || i + 1 >= raw.length) {
      out += c;
      continue;
    }
    const next = raw[i + 1];
    if (next === 'n') out += '\n';
    else if (next === 'r') out += '\r';
    else if (next === '"') out += '"';
    else if (next === '\\') out += '\\';
    else out += `\\${next}`;
    i++;
  }
  return out;
}

/** The vendor a bundle itself names: `vendor_id`, or the folder its `config_update_url` points into. */
export function bundleVendorId(text: string): string | undefined {
  let inVendor = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      inVendor = line.toLowerCase() === '[vendor]';
      continue;
    }
    if (!inVendor || line.startsWith('#') || line.startsWith(';')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key === 'vendor_id' && value) return value;
    if (key === 'config_update_url' && value) {
      const match = /\/live\/([^/]+)\/?$/.exec(value);
      if (match) return match[1];
    }
  }
  return undefined;
}

/** The asset names a bundle references, without duplicates. */
function assetNamesOf(bundle: ReturnType<typeof parseBundle>): string[] {
  const names = new Set<string>();
  for (const preset of bundle.presets) {
    for (const key of ['bed_model', 'bed_texture', 'thumbnail']) {
      const value = preset.config[key]?.trim();
      if (value) names.add(value);
    }
  }
  for (const model of bundle.vendor.models) {
    for (const value of [model.bedModel, model.bedTexture, model.thumbnail]) {
      const name = value?.trim();
      if (name) names.add(name);
    }
  }
  return [...names];
}

/**
 * Every block-level finding of a bundle: malformed or injected keys, values with a lone carriage
 * return, absurd values (the configuration limits) and dangerous firmware commands in its G-code.
 *
 * The ordering rules (`no_homing`, `macro_before_move`) only apply to a **start** G-code: an end
 * G-code is appended to a file that has homed long before, so scanning it on its own would flag
 * every vendor preset that lifts Z at the end.
 *
 * A `gcode.*` finding is *pre-existing* when `vendorBaseline` lists the same rule for the vendor's
 * bundle in use. PrusaSlicer's own bundles do contain `M92` and moves before `G28` (the preflight
 * sweep found them in 2.9.6), so refusing every bundle that repeats them would refuse every official
 * bundle. The exception covers `gcode.*` rules only, and only those the vendor already had: an
 * injected key, a lone carriage return, an absurd temperature or a new G-code rule still refuses it.
 */
export function bundleFindings(presets: readonly SystemPreset[], vendorBaseline?: ReadonlySet<string>): BundleFindings {
  const all: BundleRefusal[] = [];
  for (const preset of presets) {
    for (const [key, value] of Object.entries(preset.config)) {
      if (!isValidConfigKey(key)) {
        all.push({
          type: preset.type,
          preset: preset.name,
          rule: 'bundle.invalid_key',
          message: `the option name "${key}" is not a valid config key`,
        });
        continue;
      }
      if (hasLoneCarriageReturn(value)) {
        all.push({
          type: preset.type,
          preset: preset.name,
          rule: 'bundle.lone_cr',
          message: `"${key}" carries a lone carriage return, which can hide a command`,
        });
      }
    }
    for (const issue of checkConfigValues(preset.type, preset.config)) {
      if (issue.severity !== 'block') continue;
      all.push({ type: preset.type, preset: preset.name, rule: issue.rule, message: issue.message });
    }
    for (const key of ['start_gcode', 'layer_gcode', 'end_gcode'] as const) {
      const raw = preset.config[key];
      if (!raw) continue;
      for (const issue of scanGcodeText(unescapeGcode(raw)).issues) {
        if (PREFLIGHT_SEVERITY[issue.rule] !== 'block') continue;
        if (key !== 'start_gcode' && (issue.rule === 'gcode.no_homing' || issue.rule === 'gcode.macro_before_move')) continue;
        all.push({ type: preset.type, preset: preset.name, rule: issue.rule, message: `${key}: ${issue.message}` });
      }
    }
  }
  const preExisting = all.filter((f) => f.rule.startsWith('gcode.') && vendorBaseline?.has(f.rule));
  const refusals = all.filter((f) => !preExisting.includes(f));
  return { refusals, preExisting };
}

/** The `gcode.*` rules the bundle in use for `vendorId` already fires. */
export function vendorBaseline(bundles: BundleData, vendorId: string): ReadonlySet<string> {
  const presets = PRESET_TYPES.flatMap((type) => bundles.presets[type]).filter((p) => p.vendorId === vendorId);
  const { refusals, preExisting } = bundleFindings(presets);
  return new Set([...refusals, ...preExisting].map((f) => f.rule));
}

/**
 * Parse and validate a bundle text for `vendorId`. Throws a 400 when the file itself is unusable;
 * answers the findings otherwise, so the caller decides whether to install.
 */
export function validateBundleText(
  vendorId: string,
  file: string,
  text: string,
  installedVersion: string | undefined,
  vendorBaselineRules?: ReadonlySet<string>,
): ValidatedBundle {
  const declared = bundleVendorId(text);
  if (declared && declared !== vendorId) {
    throw new ValidationError(`the bundle names the vendor "${declared}", not "${vendorId}"`);
  }
  const version = configVersionOf(text);
  if (!version) throw new ValidationError('the bundle has no config_version');
  if (!BUNDLE_VERSION_PATTERN.test(version)) throw new ValidationError(`the bundle version "${version}" is not a version`);
  if (!isNewerVersion(version, installedVersion ?? '0')) {
    throw new ValidationError(`the bundle version ${version} is not newer than the installed ${installedVersion ?? '(none)'}`);
  }
  const parsed = parseBundle(file, text);
  if (!parsed.presets.length) throw new ValidationError('the bundle holds no preset');
  const assets = assetNamesOf(parsed);
  const badAsset = assets.find((name) => !PROFILE_ASSET_PATTERN.test(name));
  if (badAsset) throw new ValidationError(`the bundle references an unusable asset name "${badAsset}"`);
  const findings = bundleFindings(parsed.presets, vendorBaselineRules);
  return { version, presets: parsed.presets, assets, ...findings };
}

// ---------------------------------------------------------------------------
// The updater
// ---------------------------------------------------------------------------

function parseCache(value: unknown): ObservationCache | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.checkedAt !== 'string' || !v.vendors || typeof v.vendors !== 'object' || Array.isArray(v.vendors)) return undefined;
  const vendors: Record<string, VendorObservation> = {};
  for (const [id, entry] of Object.entries(v.vendors as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.compatible !== 'boolean') continue;
    if (e.available !== undefined && typeof e.available !== 'string') continue;
    if (e.reason !== undefined && typeof e.reason !== 'string') continue;
    vendors[id] = {
      ...(typeof e.available === 'string' && e.available ? { available: e.available } : {}),
      compatible: e.compatible,
      ...(typeof e.reason === 'string' && e.reason ? { reason: e.reason } : {}),
    };
  }
  return { checkedAt: v.checkedAt, vendors };
}

function bundleFile(vendorDir: string, vendorId: string): string {
  return path.join(vendorDir, `${vendorId}.ini`);
}

function previousFile(vendorDir: string, vendorId: string): string {
  return path.join(vendorDir, `${vendorId}.ini.prev`);
}

function assetDir(vendorDir: string, vendorId: string): string {
  return path.join(vendorDir, vendorId);
}

/** The version of the bundle in use, from the loaded bundles (not from the disk). */
function installedVersionOf(vendorId: string, bundles: BundleData): string | undefined {
  return bundles.vendors.find((v) => v.id === vendorId)?.configVersion;
}

/** `true` when the vendor is one this install already has. */
function assertInstalled(vendorId: string, bundles: BundleData): void {
  if (!VENDOR_ID_PATTERN.test(vendorId)) throw new ValidationError('invalid vendor id');
  if (!bundles.vendors.some((v) => v.id === vendorId)) throw new NotFoundError(`unknown vendor "${vendorId}"`);
}

/** The names a preset of a type answers to (its own, its alias and the names it was renamed from). */
function parentNames(bundles: BundleData, type: PresetType): Set<string> {
  const names = new Set<string>();
  for (const preset of bundles.presets[type]) {
    names.add(preset.name);
    for (const renamed of preset.renamedFrom) names.add(renamed);
    if (preset.alias) names.add(preset.alias);
  }
  return names;
}

/**
 * The user presets whose `inherits` named a system preset before a change and no longer does.
 * Nothing is rewritten or deleted – the list is what the install result reports.
 */
export function lostParents(before: BundleData, after: BundleData): VendorPresetWithoutParent[] {
  const out: VendorPresetWithoutParent[] = [];
  for (const type of PRESET_TYPES) {
    const was = parentNames(before, type);
    const is = parentNames(after, type);
    for (const preset of listUserPresets(type)) {
      const parent = preset.config.inherits?.trim();
      if (!parent || userPresetExists(type, parent)) continue;
      if (was.has(parent) && !is.has(parent)) out.push({ type, name: preset.name, parent });
    }
  }
  return out;
}

/** Run `work` over `items`, at most `limit` at a time. */
async function pooled<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await work(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** The message for a version the engine cannot run. */
function rangeReason(entry: IndexVersion, engine: string): string {
  const low = entry.minEngine ? `PrusaSlicer ${entry.minEngine}` : '';
  const high = entry.maxEngine ? `PrusaSlicer up to ${entry.maxEngine}` : '';
  return `the newest bundle (${entry.version}) needs ${[low, high].filter(Boolean).join(' and ')}, this install runs ${engine}`;
}

/** One updater; `createProfileUpdater` is what the tests build, the app uses the singleton below. */
export function createProfileUpdater(options: ProfileUpdaterOptions): ProfileUpdater {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? ((message: string) => console.log(`[profiles] ${message}`));
  let cache: ObservationCache | undefined;
  let loaded = false;
  let pending: Promise<void> | undefined;

  async function loadCache(): Promise<void> {
    if (loaded) return;
    loaded = true;
    const { value } = await readJson<unknown>(options.cacheFile).catch(() => ({ value: undefined }));
    cache = parseCache(value);
  }

  /** One capped GET; a redirect is a failure (the source is fixed), a wrong status is one too. */
  async function fetchCapped(url: string, cap: number): Promise<string> {
    const res = await fetchImpl(url, {
      redirect: 'error',
      headers: { 'User-Agent': 'webslicer' },
      signal: AbortSignal.timeout(PROFILE_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`the profile repository answered ${res.status}`);
    const declared = Number(res.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > cap) throw new ValidationError(`the answer is larger than ${cap} bytes`);
    if (!res.body) {
      const text = await res.text();
      if (Buffer.byteLength(text) > cap) throw new ValidationError(`the answer is larger than ${cap} bytes`);
      return text;
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > cap) {
        await reader.cancel().catch(() => undefined);
        throw new ValidationError(`the answer is larger than ${cap} bytes`);
      }
      chunks.push(value);
    }
    return new TextDecoder().decode(Buffer.concat(chunks));
  }

  /** The engine version as a bundle compares it; `unknown` when the slicer did not answer with one. */
  function engineVersion(): string {
    const match = /\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?/.exec(options.engineVersion);
    return match ? match[0] : 'unknown';
  }

  /** What one vendor's `index.idx` says, or `undefined` when it cannot be read. */
  async function indexOf(vendorId: string): Promise<IndexVersion[] | undefined> {
    try {
      return parseIndex(await fetchCapped(profileUrl(vendorId, 'index.idx'), MAX_INDEX_BYTES));
    } catch (e) {
      log(`cannot read the index of ${vendorId}: ${(e as Error).message}`);
      return undefined;
    }
  }

  /** One observation for one vendor; a failure keeps what the last check knew about it. */
  async function observe(vendorId: string, engine: string): Promise<VendorObservation | undefined> {
    const entries = await indexOf(vendorId);
    if (!entries) return undefined;
    const newest = newestEntry(entries);
    if (!newest) return undefined;
    const compatible = newestCompatible(entries, engine);
    return {
      available: newest.version,
      compatible: !!compatible,
      ...(compatible ? {} : { reason: rangeReason(newest, engine) }),
    };
  }

  /** One check of every installed vendor; failures keep the previous observation of that vendor. */
  async function refresh(): Promise<void> {
    if (!options.enabled) return;
    if (pending) return pending;
    pending = (async () => {
      try {
        await loadCache();
        const engine = engineVersion();
        const vendors = loadBundles().vendors;
        const observed: Record<string, VendorObservation> = { ...(cache?.vendors ?? {}) };
        await pooled(vendors, CONCURRENCY, async (vendor) => {
          const observation = await observe(vendor.id, engine);
          if (observation) observed[vendor.id] = observation;
        });
        cache = { checkedAt: now().toISOString(), vendors: observed };
        // the cache is a convenience, not the result: a read-only data dir must not fail the check
        await writeJson(options.cacheFile, cache).catch((e: Error) => log(`cannot cache the check: ${e.message}`));
        log(`checked ${vendors.length} vendor indexes`);
      } finally {
        pending = undefined;
      }
    })();
    return pending;
  }

  function canRevert(vendorId: string): boolean {
    try {
      return fs.existsSync(previousFile(options.vendorDir, vendorId)) || fs.existsSync(bundleFile(options.vendorDir, vendorId));
    } catch {
      return false;
    }
  }

  function rowOf(vendor: { id: string; name: string }, installed: string | undefined): VendorUpdate {
    const observation = cache?.vendors[vendor.id];
    const available = observation?.available;
    const compatible = observation?.compatible ?? false;
    const newer = !!available && isNewerVersion(available, installed ?? '0');
    const reason = !available
      ? undefined
      : newer && compatible
        ? undefined
        : newer
          ? (observation?.reason ?? 'not compatible')
          : 'up to date';
    return {
      id: vendor.id,
      name: vendor.name,
      ...(installed ? { installed } : {}),
      ...(available ? { available } : {}),
      compatible,
      update: newer && compatible,
      ...(reason ? { reason } : {}),
      url: profilePageUrl(vendor.id),
      canRevert: canRevert(vendor.id),
      ...(cache?.checkedAt ? { checkedAt: cache.checkedAt } : {}),
    };
  }

  async function list(force = false): Promise<VendorUpdateList> {
    await loadCache();
    if (options.enabled) {
      const stale = !cache || now().getTime() - Date.parse(cache.checkedAt) >= PROFILE_CHECK_INTERVAL_MS;
      if (force || stale) await refresh();
    }
    const bundles = loadBundles();
    return {
      enabled: options.enabled,
      checkedAt: cache?.checkedAt ?? null,
      vendors: bundles.vendors.map((v) => rowOf(v, v.configVersion)),
    };
  }

  /** Move a validated bundle into place, keeping the previous one for one-step rollback. */
  async function placeBundle(vendorId: string, source: string): Promise<void> {
    const target = bundleFile(options.vendorDir, vendorId);
    const previous = previousFile(options.vendorDir, vendorId);
    await fsp.mkdir(options.vendorDir, { recursive: true });
    if (fs.existsSync(target)) {
      await fsp.rm(previous, { force: true });
      await fsp.rename(target, previous);
    }
    // a rename within one directory is atomic: a crash leaves the old bundle or the new one
    await fsp.rename(source, target);
  }

  /** Download the assets a bundle references; a failed asset keeps the engine's copy and is logged. */
  async function downloadAssets(vendorId: string, names: readonly string[]): Promise<void> {
    const dir = assetDir(options.vendorDir, vendorId);
    await fsp.mkdir(dir, { recursive: true });
    await pooled(names.slice(0, MAX_ASSETS), CONCURRENCY, async (name) => {
      if (!PROFILE_ASSET_PATTERN.test(name)) return;
      try {
        const res = await fetchImpl(profileUrl(vendorId, name), {
          redirect: 'error',
          headers: { 'User-Agent': 'webslicer' },
          signal: AbortSignal.timeout(PROFILE_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`answered ${res.status}`);
        const declared = Number(res.headers.get('content-length') ?? '');
        if (Number.isFinite(declared) && declared > MAX_ASSET_BYTES) throw new Error('larger than the asset cap');
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.byteLength > MAX_ASSET_BYTES) throw new Error('larger than the asset cap');
        const tmp = path.join(dir, `.${name}.${process.pid}.tmp`);
        await fsp.writeFile(tmp, bytes);
        await fsp.rename(tmp, path.join(dir, name));
      } catch (e) {
        log(`asset ${name} of ${vendorId} not installed: ${(e as Error).message}`);
      }
    });
  }

  /** After a bundle change: reload, then report the user presets that lost their parent. */
  function reloadAndReport(vendorId: string, from: string | undefined, before: BundleData): VendorUpdateResult {
    const bundles = loadBundles(true);
    const to = installedVersionOf(vendorId, bundles);
    const orphaned = lostParents(before, bundles);
    log(`${vendorId}: ${from ?? '(none)'} -> ${to ?? '(none)'}, ${orphaned.length} user preset(s) reference removed profiles`);
    return { vendor: vendorId, ...(from ? { from } : {}), ...(to ? { to } : {}), orphaned };
  }

  /** Read, cap and validate a bundle on disk; a refused bundle writes nothing. */
  async function validateFile(
    vendorId: string,
    file: string,
    installed: string | undefined,
    baseline: ReadonlySet<string>,
  ): Promise<ValidatedBundle> {
    let text: string;
    try {
      text = await fsp.readFile(file, 'utf8');
    } catch {
      throw new ValidationError('the bundle could not be read');
    }
    if (Buffer.byteLength(text) > MAX_BUNDLE_BYTES) throw new ValidationError(`the bundle is larger than ${MAX_BUNDLE_BYTES} bytes`);
    const validated = validateBundleText(vendorId, bundleFile(options.vendorDir, vendorId), text, installed, baseline);
    if (validated.preExisting.length) {
      log(`${vendorId}: ${validated.preExisting.length} G-code finding(s) are already present in the bundle in use`);
    }
    if (validated.refusals.length) {
      throw new ConflictError(`the bundle ${vendorId} ${validated.version} was refused: ${validated.refusals.length} blocking finding(s)`, {
        refusals: validated.refusals,
      });
    }
    return validated;
  }

  async function install(vendorId: string): Promise<VendorUpdateResult> {
    if (!options.enabled) throw new ConflictError('online profile updates are disabled');
    const before = loadBundles();
    assertInstalled(vendorId, before);
    await loadCache();
    const installed = installedVersionOf(vendorId, before);
    const engine = engineVersion();
    const entries = await indexOf(vendorId);
    if (!entries) throw new HttpError(502, `the profile repository did not answer for ${vendorId}`);
    const entry = newestCompatible(entries, engine);
    if (!entry) throw new ConflictError(`no bundle of ${vendorId} runs on PrusaSlicer ${engine}`);
    if (!BUNDLE_VERSION_PATTERN.test(entry.version))
      throw new HttpError(502, `the profile repository lists an unusable version for ${vendorId}`);
    if (!isNewerVersion(entry.version, installed ?? '0'))
      throw new ConflictError(`${vendorId} is already up to date (${installed ?? 'unknown'})`);

    await fsp.mkdir(options.vendorDir, { recursive: true });
    const tmpDir = await fsp.mkdtemp(path.join(options.vendorDir, '.install-'));
    const tmp = path.join(tmpDir, `${vendorId}.ini`);
    try {
      let text: string;
      try {
        text = await fetchCapped(profileUrl(vendorId, `${entry.version}.ini`), MAX_BUNDLE_BYTES);
      } catch (e) {
        if (e instanceof ValidationError) throw e;
        throw new HttpError(502, `the bundle ${vendorId} ${entry.version} could not be downloaded`);
      }
      await fsp.writeFile(tmp, text);
      const validated = await validateFile(vendorId, tmp, installed, vendorBaseline(before, vendorId));
      await downloadAssets(vendorId, validated.assets);
      await placeBundle(vendorId, tmp);
      log(`${vendorId}: installed ${validated.version}`);
      return reloadAndReport(vendorId, installed, before);
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async function revert(vendorId: string): Promise<VendorUpdateResult> {
    const before = loadBundles();
    assertInstalled(vendorId, before);
    const installed = installedVersionOf(vendorId, before);
    const previous = previousFile(options.vendorDir, vendorId);
    const target = bundleFile(options.vendorDir, vendorId);
    if (fs.existsSync(previous)) {
      await fsp.rename(previous, target);
    } else if (fs.existsSync(target)) {
      // the first install replaced the image's bundle: dropping the file restores that one
      await fsp.rm(target, { force: true });
    } else {
      throw new ConflictError(`${vendorId} has no installed update to revert`);
    }
    log(`${vendorId}: reverted`);
    return reloadAndReport(vendorId, installed, before);
  }

  async function installFromFile(file: string): Promise<VendorUpdateResult> {
    const before = loadBundles();
    let text: string;
    try {
      text = await fsp.readFile(file, 'utf8');
    } catch {
      throw new ValidationError('the bundle could not be read');
    }
    if (Buffer.byteLength(text) > MAX_BUNDLE_BYTES) throw new ValidationError(`the bundle is larger than ${MAX_BUNDLE_BYTES} bytes`);
    const vendorId = bundleVendorId(text);
    if (!vendorId) throw new ValidationError('the bundle does not name a vendor (vendor_id or config_update_url)');
    assertInstalled(vendorId, before);
    const installed = installedVersionOf(vendorId, before);
    const validated = validateBundleText(
      vendorId,
      bundleFile(options.vendorDir, vendorId),
      text,
      installed,
      vendorBaseline(before, vendorId),
    );
    if (validated.refusals.length) {
      throw new ConflictError(`the bundle ${vendorId} ${validated.version} was refused: ${validated.refusals.length} blocking finding(s)`, {
        refusals: validated.refusals,
      });
    }
    await fsp.mkdir(options.vendorDir, { recursive: true });
    const tmpDir = await fsp.mkdtemp(path.join(options.vendorDir, '.install-'));
    try {
      const tmp = path.join(tmpDir, `${vendorId}.ini`);
      await fsp.copyFile(file, tmp);
      await placeBundle(vendorId, tmp);
      log(`${vendorId}: installed ${validated.version} from a file`);
      return reloadAndReport(vendorId, installed, before);
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  return { enabled: options.enabled, list, install, revert, installFromFile };
}

// ---------------------------------------------------------------------------
// The app's updater (the routes read it)
// ---------------------------------------------------------------------------

let active: ProfileUpdater | undefined;

async function defaultUpdater(): Promise<ProfileUpdater> {
  return createProfileUpdater({
    enabled: isUpdateCheckEnabled(config.updateCheck),
    engineVersion: await getSlicerVersion(),
    vendorDir: vendorDataDir(),
    cacheFile: config.vendorUpdatesFile,
  });
}

/** The updater of this process, built on first use; tests replace it with `setProfileUpdater`. */
export async function profileUpdater(): Promise<ProfileUpdater> {
  active ??= await defaultUpdater();
  return active;
}

/** Replace the app's updater (tests); `undefined` restores the configured one on the next read. */
export function setProfileUpdater(updater: ProfileUpdater | undefined): void {
  active = updater;
}
