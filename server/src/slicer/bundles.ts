/**
 * Loader for PrusaSlicer vendor configuration bundles (resources/profiles/*.ini).
 * Resolves preset inheritance and exposes printer models / variants.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { parseIni, type IniSection } from './ini.js';
import { PRESET_TYPES, compareVersions, isPresetType, type PresetType, type Vendor } from '@webslicer/shared';

export interface SystemPreset {
  type: PresetType;
  name: string;
  vendorId: string;
  vendorName: string;
  /** fully resolved config (inheritance applied), not including slicer defaults */
  config: IniSection;
  alias?: string;
  renamedFrom: string[];
  /** For printer presets: model id and variant */
  printerModel?: string;
  printerVariant?: string;
}

export interface BundleData {
  vendors: Vendor[];
  presets: Record<PresetType, SystemPreset[]>;
  /** config keys seen per preset type (used to classify options) */
  keys: Record<PresetType, Set<string>>;
  resourcesDir?: string;
}

const META_KEYS = new Set(['inherits', 'alias', 'renamed_from']);

function resolveSection(name: string, raw: Map<string, IniSection>, cache: Map<string, IniSection>, stack: Set<string>): IniSection {
  const cached = cache.get(name);
  if (cached) return cached;
  const sec = raw.get(name);
  if (!sec) return {};
  if (stack.has(name)) return {};
  stack.add(name);
  const result: IniSection = {};
  const inherits = (sec.inherits || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const parent of inherits) {
    Object.assign(result, resolveSection(parent, raw, cache, stack));
  }
  for (const [k, v] of Object.entries(sec)) {
    if (k === 'inherits') continue;
    result[k] = v;
  }
  stack.delete(name);
  cache.set(name, result);
  return result;
}

export function parseBundle(file: string, text: string): { vendor: Vendor; presets: SystemPreset[] } {
  const doc = parseIni(text);
  const vendorSec = doc.sections.get('vendor') || {};
  const vendorId = path.basename(file, '.ini');
  const vendorName = vendorSec.name || vendorId;
  const vendor: Vendor = { id: vendorId, name: vendorName, configVersion: vendorSec.config_version, models: [], file };
  const presets: SystemPreset[] = [];

  const byType: Record<PresetType, Map<string, IniSection>> = {
    print: new Map(),
    filament: new Map(),
    printer: new Map(),
    sla_print: new Map(),
    sla_material: new Map(),
  };

  for (const [section, values] of doc.sections) {
    if (section.startsWith('printer_model:')) {
      const id = section.slice('printer_model:'.length).trim();
      vendor.models.push({
        vendorId,
        vendorName,
        id,
        // wxWidgets escapes "&" as "&&" in bundle names; show a single ampersand like PrusaSlicer
        name: (values.name || id).replace(/&&/g, '&'),
        variants: (values.variants || '')
          .split(';')
          .map((s) => s.trim())
          .filter(Boolean),
        technology: values.technology === 'SLA' ? 'SLA' : 'FFF',
        family: values.family || '',
        bedModel: values.bed_model,
        bedTexture: values.bed_texture,
        thumbnail: values.thumbnail,
        defaultMaterials: (values.default_materials || values.default_filaments || '')
          .split(';')
          .map((s) => s.trim())
          .filter(Boolean),
      });
      continue;
    }
    const colon = section.indexOf(':');
    if (colon < 0) continue;
    const type = section.slice(0, colon) as PresetType;
    if (!isPresetType(type)) continue;
    const name = section.slice(colon + 1).trim();
    byType[type].set(name, values);
  }

  for (const type of PRESET_TYPES) {
    const raw = byType[type];
    const cache = new Map<string, IniSection>();
    for (const [name, sec] of raw) {
      if (name.startsWith('*')) continue; // abstract/intermediate preset
      const resolved = resolveSection(name, raw, cache, new Set());
      const cfg: IniSection = {};
      for (const [k, v] of Object.entries(resolved)) if (!META_KEYS.has(k)) cfg[k] = v;
      // Like PrusaSlicer: an explicit alias, otherwise the name without its " @variant" suffix.
      let alias = sec.alias;
      if (!alias) {
        const at = name.indexOf('@');
        if (at > 0) alias = name.slice(0, at).trim();
      }
      presets.push({
        type,
        name,
        vendorId,
        vendorName,
        config: cfg,
        alias,
        renamedFrom: (resolved.renamed_from || '')
          .split(';')
          .map((s) => s.trim())
          .filter(Boolean),
        printerModel: type === 'printer' ? cfg.printer_model : undefined,
        printerVariant: type === 'printer' ? cfg.printer_variant : undefined,
      });
    }
  }
  return { vendor, presets };
}

let bundleCache: BundleData | undefined;

/** The profiles directory of the installed PrusaSlicer (`PRUSASLICER_PROFILES`, else `<resources>/profiles`). */
export function findProfilesDir(): string | undefined {
  const candidates: string[] = [];
  if (process.env.PRUSASLICER_PROFILES) candidates.push(process.env.PRUSASLICER_PROFILES);
  if (config.slicerResources) candidates.push(path.join(config.slicerResources, 'profiles'));
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

/** Where updated vendor bundles are installed (`<dataDir>/vendor`), independent of the image. */
export function vendorDataDir(): string {
  return path.join(config.dataDir, 'vendor');
}

/** The bundle directories, the engine's first: a bundle in the data dir only replaces one of the same vendor. */
function bundleDirs(): string[] {
  const dirs = [findProfilesDir(), vendorDataDir()].filter((d): d is string => !!d);
  return dirs.filter((d, i) => dirs.indexOf(d) === i);
}

/** `undefined` when neither bundle names a version – then the engine's copy wins. */
function newerBundle(candidate: Vendor, current: Vendor): boolean {
  if (!candidate.configVersion || !current.configVersion) return false;
  return compareVersions(candidate.configVersion, current.configVersion) > 0;
}

export function loadBundles(force = false): BundleData {
  if (bundleCache && !force) return bundleCache;
  const data: BundleData = {
    vendors: [],
    presets: Object.fromEntries(PRESET_TYPES.map((t) => [t, [] as SystemPreset[]])) as Record<PresetType, SystemPreset[]>,
    keys: Object.fromEntries(PRESET_TYPES.map((t) => [t, new Set<string>()])) as Record<PresetType, Set<string>>,
    resourcesDir: config.slicerResources,
  };
  // per vendor id the bundle with the highest `config_version` wins; on a tie the engine's copy stays,
  // because its directory is read first and only a strictly newer one replaces it
  const chosen = new Map<string, { vendor: Vendor; presets: SystemPreset[] }>();
  for (const dir of bundleDirs()) {
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.ini'));
    } catch {
      continue;
    }
    for (const f of files) {
      const file = path.join(dir, f);
      try {
        const text = fs.readFileSync(file, 'utf8');
        const parsed = parseBundle(file, text);
        const current = chosen.get(parsed.vendor.id);
        if (!current || newerBundle(parsed.vendor, current.vendor)) chosen.set(parsed.vendor.id, parsed);
      } catch (e) {
        console.warn(`[bundles] failed to parse ${file}: ${(e as Error).message}`);
      }
    }
  }
  for (const { vendor, presets } of chosen.values()) {
    data.vendors.push(vendor);
    for (const p of presets) {
      data.presets[p.type].push(p);
      for (const k of Object.keys(p.config)) data.keys[p.type].add(k);
    }
  }
  data.vendors.sort((a, b) => (a.id === 'PrusaResearch' ? -1 : b.id === 'PrusaResearch' ? 1 : a.name.localeCompare(b.name)));
  bundleCache = data;
  console.log(
    `[bundles] loaded ${data.vendors.length} vendors, ${data.presets.print.length} print / ${data.presets.filament.length} filament / ${data.presets.printer.length} printer presets`,
  );
  return data;
}

export function findSystemPreset(type: PresetType, name: string): SystemPreset | undefined {
  const b = loadBundles();
  return b.presets[type].find((p) => p.name === name) || b.presets[type].find((p) => p.renamedFrom.includes(name));
}

/**
 * Resolve a bed model/texture file for a printer model. A bundle replaced from the data dir carries no
 * assets of its own, so the data dir is asked first (an operator may drop one there) and the engine's
 * profiles directory answers for everything else.
 */
export function resolveModelAsset(vendorId: string, file: string): string | undefined {
  for (const dir of [vendorDataDir(), findProfilesDir()]) {
    if (!dir) continue;
    const p = path.join(dir, vendorId, file);
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}
