/**
 * PrusaSlicer preset bundles: the `[print:Name]` / `[filament:Name]` / `[printer:Name]` sections of
 * an exported config bundle, plus the `[presets]` section that records the selection.
 *
 * Reading and writing are separate from the import rules (which keys survive, what a clash means):
 * this module only knows the file format. It is pure, so the round trip is a unit test.
 */
import { escapeStringsCstyle, isPresetType, PRESET_TYPES, unescapeStringsCstyle } from '@webslicer/shared';
import { parseIni, serializeIni, type IniSection } from './ini.js';
import type { PresetType, RejectedPreset } from '@webslicer/shared';

/** One preset of a bundle, as its section reads. */
export interface BundlePreset {
  type: PresetType;
  name: string;
  /** the section values without `inherits` (the writer stores that one itself) */
  config: IniSection;
  inherits?: string;
}

/** What a bundle file holds: its presets, the physical printers it names and sections it cannot use. */
export interface ParsedPresetBundle {
  presets: BundlePreset[];
  /** names of `[physical_printer:…]` sections – reported, never imported (credentials do not travel) */
  physicalPrinters: string[];
  invalid: RejectedPreset[];
  /** the `[presets]` selection, one name list per type */
  selection: Partial<Record<PresetType, string[]>>;
}

/** A physical printer as the bundle writer takes it (no credentials, no host address). */
export interface BundlePhysicalPrinter {
  name: string;
  hostType: string;
  presetName?: string;
}

/** The type of a section header (`print`, `filament`, …), or undefined for `[presets]`/`[vendor]`. */
function sectionOf(header: string): { type?: PresetType; name?: string } {
  const colon = header.indexOf(':');
  if (colon < 0) return {};
  const type = header.slice(0, colon).trim();
  if (!isPresetType(type)) return {};
  return { type, name: header.slice(colon + 1).trim() };
}

/**
 * Parse a bundle. A section whose name is unusable is reported in `invalid` instead of becoming a
 * preset: an abstract vendor section (`*name`) and an empty name cannot be a user preset either.
 */
export function parsePresetBundle(text: string): ParsedPresetBundle {
  const doc = parseIni(text);
  const out: ParsedPresetBundle = { presets: [], physicalPrinters: [], invalid: [], selection: {} };

  for (const [header, values] of doc.sections) {
    if (header === 'presets') {
      for (const type of PRESET_TYPES) {
        const raw = values[type];
        if (raw === undefined) continue;
        const names = unescapeStringsCstyle(raw).filter(Boolean);
        if (names.length) out.selection[type] = names;
      }
      continue;
    }
    if (header.startsWith('physical_printer:')) {
      const name = header.slice('physical_printer:'.length).trim();
      if (name) out.physicalPrinters.push(name);
      continue;
    }
    const { type, name } = sectionOf(header);
    if (!type || name === undefined) continue; // [vendor], [printer_model:…], …

    if (!name || name.startsWith('*')) {
      out.invalid.push({ type, name, reason: name.startsWith('*') ? 'abstract preset section' : 'empty preset name' });
      continue;
    }
    const config: IniSection = {};
    let inherits: string | undefined;
    for (const [key, value] of Object.entries(values)) {
      if (key === 'inherits') inherits = value;
      else config[key] = value;
    }
    out.presets.push({ type, name, config, ...(inherits ? { inherits } : {}) });
  }
  return out;
}

/**
 * Write a bundle in PrusaSlicer's format: one section per preset, then `[physical_printer:…]` and the
 * `[presets]` selection.
 *
 * Values go through `serializeIni`, so a key that could change the meaning of the file is refused
 * (SEC-2) and a lone carriage return never leaves as a line end.
 */
export function serializePresetBundle(
  presets: BundlePreset[],
  opts: { physicalPrinters?: BundlePhysicalPrinter[]; selection?: Partial<Record<PresetType, string[]>> } = {},
): string {
  const order = (p: BundlePreset) => [PRESET_TYPES.indexOf(p.type), p.name] as const;
  const parts: string[] = ['# PrusaSlicer config bundle exported by WebSlicer'];
  for (const p of [...presets].sort((a, b) => {
    const [ta, na] = order(a);
    const [tb, nb] = order(b);
    return ta - tb || na.localeCompare(nb);
  })) {
    const values: IniSection = { ...p.config };
    if (p.inherits) values.inherits = p.inherits;
    parts.push(`[${p.type}:${p.name}]\n${serializeIni(values)}`);
  }
  for (const p of opts.physicalPrinters ?? []) {
    // No host address and no API key: a bundle is made to be shared, and a print host's credentials
    // are not settings of a preset (the UI text says so).
    const values: IniSection = { host_type: p.hostType };
    if (p.presetName) values.printer_preset = p.presetName;
    parts.push(`[physical_printer:${p.name}]\n${serializeIni(values)}`);
  }
  const selection = opts.selection ?? {};
  const lines: string[] = [];
  for (const type of PRESET_TYPES) {
    const names = selection[type];
    if (names?.length) lines.push(`${type} = ${escapeStringsCstyle(names)}`);
  }
  if (lines.length) parts.push(`[presets]\n${lines.join('\n')}\n`);
  return parts.join('\n');
}
