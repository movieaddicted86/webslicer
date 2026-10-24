/**
 * Preset transfer use cases: rename a user preset, export every user preset as a PrusaSlicer config
 * bundle, and import a bundle or a G-code config block.
 *
 * Two rules are the whole point of this module:
 * - **An import can never widen what a preset save can do.** Every key and value takes the same
 *   validation as `PUT /api/presets/:type/:name`: the key has to be a well-formed config key (SEC-2),
 *   known to the installed slicer and not server-only (SEC-1), and the value must not carry a lone
 *   carriage return. Refused keys are *dropped and reported* – never written, never executed.
 * - **An import writes user presets only.** A name clash is answered explicitly, a system (vendor)
 *   preset is never overwritten or renamed.
 *
 * Both input formats are re-read on import instead of trusting the preview: the client echoes the
 * bundle text back, and a text that changed since the preview must still obey the rules.
 */
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { config } from '../config.js';
import { ConflictError, ValidationError } from '../errors.js';
import { writeTextSync } from '../storage/jsonStore.js';
import { findSystemPreset } from '../slicer/bundles.js';
import { isValidConfigKey, invalidConfigKeyMessage, invalidConfigValueMessage, hasLoneCarriageReturn, safeName } from '@webslicer/shared';
import { SERVER_ONLY_KEYS, serverOnlyReason } from './serverOnly.js';
import { listUserPresets, saveUserPreset, userPresetExists } from '../slicer/presets.js';
import { parsePresetBundle, serializePresetBundle, type BundlePreset, type ParsedPresetBundle } from '../slicer/presetBundle.js';
import { listPrinters, upsertPrinter } from './printers.js';
import { listProjects, loadProject, saveProject, withProjectLock, type Project } from './projects.js';
import type { IniSection } from '../slicer/ini.js';
import type { Schema } from '@webslicer/shared';
import type {
  ImportedPreset,
  PresetClash,
  PresetClashAnswer,
  PresetImportPreview,
  PresetImportResult,
  PresetRenameResult,
  PresetType,
  RejectedConfigKey,
  RejectedPreset,
} from '@webslicer/shared';

/** The most bundle text one import accepts (a real bundle of every user preset is far below it). */
export const MAX_BUNDLE_CHARS = 4 * 1024 * 1024;

/** Refuse a bundle that is not a string or is larger than the cap – a 400, not a memory problem. */
export function assertBundleText(value: unknown): string {
  if (typeof value !== 'string') throw new ValidationError('bundle required');
  if (value.length > MAX_BUNDLE_CHARS) throw new ValidationError(`bundle too large (limit ${MAX_BUNDLE_CHARS} characters)`);
  return value;
}

/**
 * Filter one imported preset config. The order of the rules is the one the API shows: a malformed
 * key first (SEC-2), then a server-only key (SEC-1), then a key this slicer does not know, then a
 * value with a lone carriage return (q6-preflight).
 */
export function filterImportedConfig(
  schema: Schema,
  type: PresetType,
  name: string,
  config: IniSection,
): { config: IniSection; rejected: RejectedConfigKey[] } {
  const known = new Set(schema.presetKeys[type]);
  const out: IniSection = {};
  const rejected: RejectedConfigKey[] = [];
  for (const [key, value] of Object.entries(config)) {
    const reject = (reason: string) => rejected.push({ type, name, key, reason });
    if (!isValidConfigKey(key)) {
      reject(invalidConfigKeyMessage(key));
      continue;
    }
    if (SERVER_ONLY_KEYS.has(key)) {
      reject(`not imported: ${serverOnlyReason(key)}`);
      continue;
    }
    if (!known.has(key)) {
      reject('not imported: unknown option for this slicer');
      continue;
    }
    if (hasLoneCarriageReturn(String(value))) {
      reject(invalidConfigValueMessage(key));
      continue;
    }
    out[key] = String(value);
  }
  return { config: out, rejected };
}

/** The preview of a parsed bundle: what would be imported, what clashes, what is refused. */
export function previewOfBundle(parsed: ParsedPresetBundle, schema: Schema, bundle: string): PresetImportPreview {
  const presets: ImportedPreset[] = [];
  const rejected: RejectedConfigKey[] = [];
  const clashes: PresetClash[] = [];
  const invalid: RejectedPreset[] = [...parsed.invalid];
  for (const p of parsed.presets) {
    // web slicer has no SLA plater yet: an SLA preset is shown as not importable, not silently saved
    if (!isUserPresetType(p.type)) {
      invalid.push({ type: p.type, name: p.name, reason: 'not a user preset type' });
      continue;
    }
    const unusable = unusablePresetName(p.name);
    if (unusable) {
      invalid.push({ type: p.type, name: p.name, reason: unusable });
      continue;
    }
    const filtered = filterImportedConfig(schema, p.type, p.name, p.config);
    presets.push({ type: p.type, name: p.name, config: filtered.config });
    rejected.push(...filtered.rejected);
    if (findSystemPreset(p.type, p.name)) clashes.push({ type: p.type, name: p.name, system: true });
    else if (userPresetExists(p.type, p.name)) clashes.push({ type: p.type, name: p.name, system: false });
  }
  return { bundle, presets, invalid, clashes, rejected, physicalPrinters: parsed.physicalPrinters };
}

/**
 * Why a preset name cannot be imported as it stands, or undefined when it can. The bundle is parsed
 * as text, so a name can hold what the store would have to rewrite (`safeName`); rewriting it would
 * make the import store a preset under a name the preview did not show.
 */
function unusablePresetName(name: string): string | undefined {
  if (!name.trim()) return 'empty preset name';
  // PrusaSlicer's own "no preset" marker; the store refuses it as well
  if (name.startsWith('-')) return 'unusable preset name';
  if (safeName(name) !== name) return 'preset name contains characters a file name cannot carry';
  return undefined;
}

/** Parse bundle text and preview it; the entry point of both the preview route and an import. */
export function previewBundle(text: string, schema: Schema): PresetImportPreview {
  const bundle = assertBundleText(text);
  if (!bundle.trim()) throw new ValidationError('bundle is empty');
  return previewOfBundle(parsePresetBundle(bundle), schema, bundle);
}

/** A user preset name that is free in its type; `base`, else `base (imported)`, `base (imported 2)`, … */
export function freePresetName(type: PresetType, base: string, reserved: ReadonlySet<string> = new Set()): string {
  const taken = (name: string) => !!findSystemPreset(type, name) || userPresetExists(type, name) || reserved.has(name);
  if (!taken(base)) return base;
  const first = `${base} (imported)`;
  if (!taken(first)) return first;
  for (let i = 2; ; i++) {
    const name = `${base} (imported ${i})`;
    if (!taken(name)) return name;
  }
}

/**
 * Import a bundle: every preset that passes the validation is written as a user preset, under the
 * answer the client gave for a clash. A clash without an answer, or "overwrite" on a system preset,
 * is a 400 – nothing is written in that case.
 */
export function importBundle(text: string, answers: PresetClashAnswer[], schema: Schema): PresetImportResult {
  const bundle = assertBundleText(text);
  const parsed = parsePresetBundle(bundle);
  const answerOf = new Map(answers.map((a) => [`${a.type}\u0000${a.name}`, a.choice]));
  const result: PresetImportResult = { imported: [], skipped: [], rejected: [] };

  const plan: Array<{ preset: BundlePreset; storedAs: string; filtered: { config: IniSection; rejected: RejectedConfigKey[] } }> = [];
  const invalid: RejectedPreset[] = [...parsed.invalid];
  // names this import already claimed: two "keep both" answers must not land on the same new name
  const claimed = new Set<string>();
  for (const preset of parsed.presets) {
    const unusable = unusablePresetName(preset.name);
    if (unusable) {
      invalid.push({ type: preset.type, name: preset.name, reason: unusable });
      continue;
    }
    const clash = findSystemPreset(preset.type, preset.name)
      ? { system: true }
      : userPresetExists(preset.type, preset.name)
        ? { system: false }
        : undefined;
    let storedAs = preset.name;
    if (clash) {
      const choice = answerOf.get(`${preset.type}\u0000${preset.name}`);
      if (!choice) throw new ValidationError(`preset "${preset.name}" already exists – choose skip, overwrite or keep both`);
      if (choice === 'skip') {
        result.skipped.push({ type: preset.type, name: preset.name, system: clash.system });
        continue;
      }
      if (choice === 'overwrite') {
        if (clash.system) throw new ValidationError(`"${preset.name}" is a system preset and cannot be overwritten`);
        storedAs = preset.name;
      } else {
        storedAs = freePresetName(preset.type, preset.name, claimed);
      }
    }
    claimed.add(`${preset.type}\u0000${storedAs}`);
    const filtered = filterImportedConfig(schema, preset.type, storedAs, preset.config);
    plan.push({ preset, storedAs, filtered });
  }
  for (const item of plan) {
    saveUserPreset(item.preset.type, item.storedAs, item.filtered.config, item.preset.inherits);
    result.rejected.push(...item.filtered.rejected);
    result.imported.push({
      type: item.preset.type,
      name: item.preset.name,
      ...(item.storedAs !== item.preset.name ? { storedAs: item.storedAs } : {}),
    });
  }
  if (!result.imported.length && invalid.length) {
    // a bundle with nothing importable is a client error, not a silent no-op
    const first = invalid[0];
    throw new ValidationError(`nothing to import: ${first.type} "${first.name}" – ${first.reason}`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

/** Every user preset as a PrusaSlicer bundle; physical printers travel without host or credentials. */
export async function exportBundle(): Promise<string> {
  const presets: BundlePreset[] = [];
  for (const type of ['print', 'filament', 'printer', 'sla_print', 'sla_material'] as PresetType[]) {
    for (const p of listUserPresets(type)) {
      const { inherits, ...cfg } = p.config;
      presets.push({ type, name: p.name, config: cfg, inherits: inherits || undefined });
    }
  }
  const physicalPrinters = (await listPrinters()).map((p) => ({ name: p.name, hostType: p.type, presetName: p.presetName }));
  return serializePresetBundle(presets, { physicalPrinters });
}

// ---------------------------------------------------------------------------
// rename
// ---------------------------------------------------------------------------

/** The file of one user preset (the store's own rule: a safe base name under the type directory). */
function presetFile(type: PresetType, name: string): string {
  return path.join(config.presetsDir, type, `${safeName(name)}.ini`);
}

/** Whether a type is one the plater and the preset manager edit (SLA has no plater yet). */
function isUserPresetType(type: PresetType): type is 'print' | 'filament' | 'printer' {
  return type === 'print' || type === 'filament' || type === 'printer';
}

/**
 * Rename a user preset and update every reference the server owns: another user preset's `inherits`,
 * a physical printer's bound preset name and the preset names of stored server projects.
 *
 * Atomic: the rules are checked first (it exists, it is no system preset, the target is free), then the
 * old file content and every file that changes are snapshotted; if a write fails, the snapshots are put
 * back and the error travels on.
 */
export async function renameUserPreset(type: PresetType, from: string, to: string): Promise<PresetRenameResult> {
  // one name rule with the store (`safeName`): the names are what the files are called
  const source = safeName(from);
  const name = safeName(to);
  if (!name || name.startsWith('-')) throw new ValidationError('invalid preset name');
  if (name === source) return { type, from: source, to: name, inheritedBy: 0, printers: 0, projects: 0, autosaves: 0 };
  if (!userPresetExists(type, source)) throw new ValidationError(`user preset "${source}" not found`);
  if (findSystemPreset(type, name) || userPresetExists(type, name)) {
    throw new ConflictError(`a preset named "${name}" already exists`);
  }

  const oldFile = presetFile(type, source);
  const newFile = presetFile(type, name);
  const oldText = fs.readFileSync(oldFile, 'utf8');

  // user presets that inherit from the old name (the same type: inherits never crosses types)
  const inherited = listUserPresets(type).filter((p) => (p.config.inherits || '') === source);
  // physical printers bound to the old name
  const printers = (await listPrinters()).filter((p) => p.presetName === source);
  // stored server projects whose slots name the old preset
  const fffType = isUserPresetType(type) ? type : undefined;
  const projects = fffType ? (await listProjects()).filter((p) => projectUses(p, fffType, source)) : [];

  // snapshots for the rollback; the preset file is handled by the rename itself. The projects are
  // copied, because the rename below changes the very objects the snapshot would otherwise hold.
  const presetTexts = inherited.map((p) => ({ file: presetFile(type, p.name), text: fs.readFileSync(presetFile(type, p.name), 'utf8') }));
  const printerList = printers.length ? await listPrinters() : undefined;
  const projectCopies = projects.map((p) => structuredClone(p));

  try {
    writeTextSync(newFile, oldText); // temp + rename in the store helper
    fs.unlinkSync(oldFile);
    for (const p of inherited) {
      const cfg: IniSection = { ...p.config, inherits: name };
      saveUserPreset(type, p.name, cfg, name);
    }
    for (const p of printers) await updatePrinterPreset(p.id, name);
    for (const project of projects) {
      // under the project's lock, on the file as it is now: a concurrent MCP change must not be
      // written away by this rename
      await withProjectLock(project.id, async () => {
        const current = (await loadProject(project.id)) ?? project;
        if (fffType) renameInProject(current, fffType, source, name);
        await saveProject(current);
      });
    }
    const autosaves = fffType ? await renameInAutosaves(fffType, source, name) : 0;
    return {
      type,
      from: source,
      to: name,
      inheritedBy: inherited.length,
      printers: printers.length,
      projects: projects.length,
      autosaves,
    };
  } catch (e) {
    // put everything back; each step is best effort, the original error is what the client sees
    try {
      if (fs.existsSync(newFile)) fs.unlinkSync(newFile);
      writeTextSync(oldFile, oldText);
      for (const s of presetTexts) writeTextSync(s.file, s.text);
      if (printerList) await restorePrinterList(printerList);
      for (const project of projectCopies) await saveProject(project);
    } catch (rollbackError) {
      console.error('[webslicer] rollback of a preset rename failed:', (rollbackError as Error).message);
    }
    throw e;
  }
}

/** Whether one project slot names the preset. */
function projectUses(project: Project, type: 'print' | 'filament' | 'printer', name: string): boolean {
  if (type === 'print') return project.print.name === name;
  if (type === 'printer') return project.printer.name === name;
  return project.filaments.some((f) => f.name === name);
}

/** Point a project's slots at the new name (in memory; the caller saves it). */
function renameInProject(project: Project, type: 'print' | 'filament' | 'printer', from: string, to: string): void {
  if (type === 'print' && project.print.name === from) project.print = { ...project.print, name: to };
  if (type === 'printer' && project.printer.name === from) project.printer = { ...project.printer, name: to };
  project.filaments = project.filaments.map((f) => (f.name === from ? { ...f, name: to } : f));
}

/**
 * Rename the reference in every stored autosave (the 3MF a browser session left behind): its
 * `Metadata/Slic3r_PE.config` carries the settings ids the restore selects by. A file that cannot be
 * read is left alone – a stale autosave falls back to the compatible presets on restore.
 */
async function renameInAutosaves(type: 'print' | 'filament' | 'printer', from: string, to: string): Promise<number> {
  const key = `${type}_settings_id`;
  let files: string[] = [];
  try {
    files = fs.readdirSync(config.autosaveDir).filter((f) => f.endsWith('.3mf'));
  } catch {
    return 0;
  }
  let changed = 0;
  for (const file of files) {
    const filePath = path.join(config.autosaveDir, file);
    try {
      const zip = await JSZip.loadAsync(await fs.promises.readFile(filePath));
      const entry = zip.file('Metadata/Slic3r_PE.config');
      if (!entry) continue;
      const text = await entry.async('string');
      const next = text.replace(new RegExp(`(^;\\s*${key}\\s*=\\s*)(.*)$`, 'm'), (_all, head: string, value: string) => {
        const names = value.split(';');
        return head + names.map((v) => (v === from ? to : v)).join(';');
      });
      if (next === text) continue;
      zip.file('Metadata/Slic3r_PE.config', next);
      const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
      await fs.promises.writeFile(tmp, buf);
      await fs.promises.rename(tmp, filePath);
      changed++;
    } catch (e) {
      console.warn(`[webslicer] could not update autosave ${file}: ${(e as Error).message}`);
    }
  }
  return changed;
}

/** Set a printer's bound preset name (the store's own update path is not needed for one field). */
async function updatePrinterPreset(id: string, presetName: string): Promise<void> {
  const list = await listPrinters();
  const printer = list.find((p) => p.id === id);
  if (!printer) return;
  await upsertPrinter({ ...printer, presetName });
}

/** Put a printer list back after a failed rename (by id, so a concurrent addition survives). */
async function restorePrinterList(list: import('@webslicer/shared').PhysicalPrinter[]): Promise<void> {
  for (const p of list) await upsertPrinter(p);
}
