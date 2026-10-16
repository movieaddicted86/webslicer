/**
 * Loader for PrusaSlicer vendor configuration bundles (resources/profiles/*.ini).
 * Resolves preset inheritance and exposes printer models / variants.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { parseIni, type IniSection } from './ini.js';
import type { PresetType } from './schema.js';

export interface PrinterModel {
  vendorId: string;
  vendorName: string;
  id: string;
  name: string;
  variants: string[];
  technology: 'FFF' | 'SLA';
  family: string;
  bedModel?: string;
  bedTexture?: string;
  thumbnail?: string;
  defaultMaterials: string[];
}

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

export interface Vendor {
  id: string;
  name: string;
  configVersion?: string;
  models: PrinterModel[];
  file: string;
}

export interface BundleData {
  vendors: Vendor[];
  presets: Record<PresetType, SystemPreset[]>;
  /** config keys seen per preset type (used to classify options) */
  keys: Record<PresetType, Set<string>>;
  resourcesDir?: string;
}

const PRESET_SECTION_TYPES: PresetType[] = ['print', 'filament', 'printer', 'sla_print', 'sla_material'];
const META_KEYS = new Set(['inherits', 'alias', 'renamed_from']);

function resolveSection(
  name: string,
  raw: Map<string, IniSection>,
  cache: Map<string, IniSection>,
  stack: Set<string>,
): IniSection {
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
        name: values.name || id,
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
    if (!PRESET_SECTION_TYPES.includes(type)) continue;
    const name = section.slice(colon + 1).trim();
    byType[type].set(name, values);
  }

  for (const type of PRESET_SECTION_TYPES) {
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

export function findProfilesDir(): string | undefined {
  const candidates: string[] = [];
  if (process.env.PRUSASLICER_PROFILES) candidates.push(process.env.PRUSASLICER_PROFILES);
  if (config.slicerResources) candidates.push(path.join(config.slicerResources, 'profiles'));
  candidates.push(path.join(config.dataDir, 'vendor'));
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

export function loadBundles(force = false): BundleData {
  if (bundleCache && !force) return bundleCache;
  const data: BundleData = {
    vendors: [],
    presets: { print: [], filament: [], printer: [], sla_print: [], sla_material: [] },
    keys: { print: new Set(), filament: new Set(), printer: new Set(), sla_print: new Set(), sla_material: new Set() },
    resourcesDir: config.slicerResources,
  };
  const dirs = [findProfilesDir(), path.join(config.dataDir, 'vendor')].filter((d, i, a): d is string => !!d && a.indexOf(d) === i);
  for (const dir of dirs) {
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
        const { vendor, presets } = parseBundle(file, text);
        if (data.vendors.some((v) => v.id === vendor.id)) continue;
        data.vendors.push(vendor);
        for (const p of presets) {
          data.presets[p.type].push(p);
          for (const k of Object.keys(p.config)) data.keys[p.type].add(k);
        }
      } catch (e) {
        console.warn(`[bundles] failed to parse ${file}: ${(e as Error).message}`);
      }
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

/** Resolve a bed model/texture file for a printer model */
export function resolveModelAsset(vendorId: string, file: string): string | undefined {
  const dir = findProfilesDir();
  if (!dir) return undefined;
  const p = path.join(dir, vendorId, file);
  return fs.existsSync(p) ? p : undefined;
}
