/**
 * Preset management: system presets (vendor bundles) + user presets stored as
 * PrusaSlicer-compatible INI files under DATA_DIR/presets/<type>/<name>.ini.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { loadBundles, findSystemPreset, type SystemPreset } from './bundles.js';
import { parseIni, serializeIni, type IniSection } from './ini.js';
import { evaluateCondition } from './condition.js';
import { splitVector, unescapeStringsCstyle } from '@webslicer/shared';
import type { InstalledPrinter, PresetSummary, PresetType, ResolvedPreset, Schema } from '@webslicer/shared';

function safeName(name: string): string {
  // eslint-disable-next-line no-control-regex -- intentional control-character stripping
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
}

function userPresetFile(type: PresetType, name: string): string {
  return path.join(config.presetsDir, type, `${safeName(name)}.ini`);
}

export function listUserPresets(type: PresetType): Array<{ name: string; config: IniSection }> {
  const dir = path.join(config.presetsDir, type);
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.ini'));
  } catch {
    return [];
  }
  const out: Array<{ name: string; config: IniSection }> = [];
  for (const f of files.sort()) {
    try {
      const doc = parseIni(fs.readFileSync(path.join(dir, f), 'utf8'));
      out.push({ name: f.slice(0, -4), config: doc.global });
    } catch {
      /* skip */
    }
  }
  return out;
}

export function defaultConfig(schema: Schema, type: PresetType): IniSection {
  const cfg: IniSection = {};
  for (const k of schema.presetKeys[type]) {
    const o = schema.options[k];
    if (o) cfg[k] = o.default;
  }
  return cfg;
}

const DEFAULT_NAMES: Record<PresetType, string> = {
  print: '- default FFF -',
  filament: '- default FFF -',
  printer: '- default FFF -',
  sla_print: '- default SLA -',
  sla_material: '- default SLA -',
};

export function defaultPresetName(type: PresetType): string {
  return DEFAULT_NAMES[type];
}

/** Technology of a printer preset config */
function technologyOf(cfg: IniSection): 'FFF' | 'SLA' {
  return cfg.printer_technology === 'SLA' ? 'SLA' : 'FFF';
}

/** Resolve a preset by name into its full config. */
export function resolvePreset(schema: Schema, type: PresetType, name: string): ResolvedPreset | undefined {
  const base = defaultConfig(schema, type);
  if (name === DEFAULT_NAMES[type]) {
    if (type === 'printer' || type === 'sla_print' || type === 'sla_material') {
      base.printer_technology = type === 'printer' ? 'FFF' : 'SLA';
    }
    if (type === 'printer') {
      base.bed_shape = base.bed_shape || '0x0,200x0,200x200,0x200';
      base.nozzle_diameter = base.nozzle_diameter || '0.4';
    }
    return { type, name, system: true, config: base, overrides: {}, technology: type === 'printer' ? 'FFF' : undefined };
  }
  const sys = findSystemPreset(type, name);
  if (sys) {
    const cfg = { ...base, ...sys.config };
    if (type === 'printer' && !cfg.printer_technology) cfg.printer_technology = 'FFF';
    return {
      type,
      name: sys.name,
      system: true,
      vendorId: sys.vendorId,
      vendorName: sys.vendorName,
      alias: sys.alias,
      printerModel: sys.printerModel,
      printerVariant: sys.printerVariant,
      technology: type === 'printer' ? technologyOf(cfg) : undefined,
      config: cfg,
      overrides: {},
    };
  }
  const user = listUserPresets(type).find((p) => p.name === name);
  if (user) {
    // Only keep options the installed slicer knows for this preset type (drops stale/alias keys).
    const allowed = new Set(schema.presetKeys[type]);
    for (const k of Object.keys(user.config)) if (k !== 'inherits' && !allowed.has(k)) delete user.config[k];
    const inherits = user.config.inherits || '';
    const parent = inherits ? resolvePreset(schema, type, inherits) : undefined;
    const parentCfg = parent?.config || base;
    const cfg = { ...parentCfg, ...user.config };
    delete cfg.inherits;
    const overrides: IniSection = {};
    for (const [k, v] of Object.entries(user.config)) {
      if (k === 'inherits') continue;
      if (parentCfg[k] !== v) overrides[k] = v;
    }
    return {
      type,
      name,
      system: false,
      inherits: inherits || undefined,
      vendorId: parent?.vendorId,
      vendorName: parent?.vendorName,
      printerModel: parent?.printerModel || cfg.printer_model,
      printerVariant: parent?.printerVariant || cfg.printer_variant,
      technology: type === 'printer' ? technologyOf(cfg) : undefined,
      config: cfg,
      overrides,
    };
  }
  return undefined;
}

export function saveUserPreset(type: PresetType, name: string, cfg: IniSection, inherits?: string): void {
  const file = userPresetFile(type, name);
  const out: IniSection = { ...cfg };
  delete out.inherits;
  if (inherits) out.inherits = inherits;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, serializeIni(out, `generated by WebSlicer on ${new Date().toISOString()}`));
}

export function deleteUserPreset(type: PresetType, name: string): boolean {
  const file = userPresetFile(type, name);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

export function userPresetExists(type: PresetType, name: string): boolean {
  return fs.existsSync(userPresetFile(type, name));
}

// ---------------------------------------------------------------------------
// Installed printers (vendor models + variants selected by the user)
// ---------------------------------------------------------------------------

function installedFile(): string {
  return path.join(config.dataDir, 'installed_printers.json');
}

export function getInstalledPrinters(): InstalledPrinter[] {
  try {
    return JSON.parse(fs.readFileSync(installedFile(), 'utf8')) as InstalledPrinter[];
  } catch {
    return [];
  }
}

export function setInstalledPrinters(list: InstalledPrinter[]): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(installedFile(), JSON.stringify(list, null, 2));
}

// ---------------------------------------------------------------------------
// Listing with compatibility filtering
// ---------------------------------------------------------------------------

function makeLookup(cfg: IniSection) {
  return (key: string) => cfg[key];
}

export function isCompatibleWithPrinter(preset: IniSection, printerName: string, printerCfg: IniSection): boolean {
  const list = preset.compatible_printers ? unescapeStringsCstyle(preset.compatible_printers).filter(Boolean) : [];
  if (list.length) return list.includes(printerName);
  return evaluateCondition(preset.compatible_printers_condition, makeLookup(printerCfg));
}

export function isCompatibleWithPrint(preset: IniSection, printName: string, printCfg: IniSection, printerCfg: IniSection): boolean {
  const list = preset.compatible_prints ? unescapeStringsCstyle(preset.compatible_prints).filter(Boolean) : [];
  if (list.length) return list.includes(printName);
  // Conditions may reference both print and printer options
  const merged = { ...printerCfg, ...printCfg };
  return evaluateCondition(preset.compatible_prints_condition, makeLookup(merged));
}

export interface ListOptions {
  printerName?: string;
  printerConfig?: IniSection;
  printName?: string;
  printConfig?: IniSection;
  /** include system presets whose printer model isn't installed */
  all?: boolean;
}

export function listPresets(schema: Schema, type: PresetType, opts: ListOptions = {}): PresetSummary[] {
  const bundles = loadBundles();
  const installed = getInstalledPrinters();
  const out: PresetSummary[] = [];

  const visibleSystem = (p: SystemPreset): boolean => {
    if (opts.all) return true;
    if (type === 'printer') {
      return installed.some((i) => i.vendorId === p.vendorId && i.modelId === p.printerModel && i.variant === p.printerVariant);
    }
    // print/filament/sla presets: show if vendor has any installed printer
    return installed.some((i) => i.vendorId === p.vendorId);
  };

  const compat = (cfg: IniSection): boolean | undefined => {
    if (type === 'printer' || type === 'sla_material' && !opts.printerConfig) return undefined;
    if (!opts.printerConfig || !opts.printerName) return undefined;
    if (!isCompatibleWithPrinter(cfg, opts.printerName, opts.printerConfig)) return false;
    if (type === 'filament' && opts.printName && opts.printConfig) {
      return isCompatibleWithPrint(cfg, opts.printName, opts.printConfig, opts.printerConfig);
    }
    return true;
  };

  out.push({ type, name: DEFAULT_NAMES[type], system: true, compatible: true, technology: type === 'printer' ? 'FFF' : undefined });
  if (type === 'printer') {
    out.push({ type, name: '- default SLA -', system: true, compatible: true, technology: 'SLA' });
  }

  for (const p of bundles.presets[type]) {
    if (!visibleSystem(p)) continue;
    const tech = type === 'printer' ? technologyOf(p.config) : undefined;
    const c = compat(p.config);
    out.push({
      type,
      name: p.name,
      system: true,
      vendorId: p.vendorId,
      vendorName: p.vendorName,
      alias: p.alias,
      printerModel: p.printerModel,
      printerVariant: p.printerVariant,
      technology: tech,
      compatible: c,
    });
  }
  for (const u of listUserPresets(type)) {
    const r = resolvePreset(schema, type, u.name);
    if (!r) continue;
    out.push({
      type,
      name: u.name,
      system: false,
      inherits: r.inherits,
      vendorId: r.vendorId,
      vendorName: r.vendorName,
      printerModel: r.printerModel,
      printerVariant: r.printerVariant,
      technology: r.technology,
      compatible: compat(r.config),
    });
  }
  return out;
}

/** Number of extruders defined by a printer config */
export function extruderCount(printerCfg: IniSection): number {
  return Math.max(1, splitVector(printerCfg.nozzle_diameter || '0.4').length);
}
