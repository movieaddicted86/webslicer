/**
 * The setting tools – `set_settings`, `check_settings` and `quick_settings` (S1-a, T-025).
 *
 * `set_settings` used to accept every key of every scope and only type-coerce the value, so a model
 * could park printer options (`start_gcode`, `z_offset`, `bed_shape`) in a project whose G-code a
 * human later starts without reading it. Every value now passes two rules before anything is written
 * (`@webslicer/shared` `safety/mcpPolicy.ts`):
 *
 * - the **allowlist**: process and material options only, nothing from the printer scope, no G-code,
 *   text or coordinate option and none of the server-only keys;
 * - the **band**: temperatures may move ±25 °C, speeds ×0.5–×1.5, `extrusion_multiplier` ±0.1 and
 *   `filament_retract_length` ±1 mm around the value the resolved preset already has.
 *
 * The check runs against the **would-be** config, so one failing key rejects the whole call and the
 * project stays as it was. `check_settings` is the dry run of the same check: it answers the issues
 * (or `ok`) and writes nothing.
 */
import { z } from 'zod';
import { mcpAllowlistOf, mcpBandIssue, mcpKeyVerdict, type McpSettingIssue, type PresetType, type Schema } from '@webslicer/shared';
import { ValidationError } from '../errors.js';
import { touchProject, type Project, type ProjectPresetRef } from '../services/projects.js';
import { activeSchema } from '../services/schema.js';
import { defaultPresetName, resolvePreset } from '../slicer/presets.js';
import { coerceOptionValue } from './optionValues.js';
import { loadOwnedProject } from './projectAccess.js';
import { defineTool, type AnyTool } from './toolTypes.js';

const schemaOf = activeSchema;

/** `print`, `printer`, `filament` or `filament[<index>]` -> preset type and filament index. */
export function scopeOf(scope: string): { type: PresetType; index: number } {
  const s = String(scope || '').trim();
  if (s === 'print' || s === 'printer') return { type: s, index: 0 };
  const m = /^filament(?:\[(\d+)\])?$/.exec(s);
  if (!m) throw new ValidationError(`scope must be "print", "printer", "filament" or "filament[<index>]" (got "${scope}")`);
  return { type: 'filament', index: m[1] ? Number(m[1]) : 0 };
}

/** The values a client may send for one option. */
export type SettingValues = Record<string, string | number | boolean>;

/** One refused setting: what was sent, why, and what would have been accepted. */
export interface SettingIssue extends McpSettingIssue {
  scope: string;
}

/** The verdict of a settings call against the would-be config. */
export interface SettingsCheck {
  issues: SettingIssue[];
  changed: Record<string, string>;
}

/** The preset slot a scope addresses, with the filament list grown to the requested index. */
function slotOf(project: Project, type: PresetType, index: number): ProjectPresetRef {
  if (type === 'print') return project.print;
  if (type === 'printer') return project.printer;
  const slots = project.filaments.length ? project.filaments : [{ name: '- default FFF -', config: {} }];
  while (slots.length <= index) slots.push({ ...slots[slots.length - 1], config: { ...slots[slots.length - 1].config } });
  project.filaments = slots;
  return slots[index];
}

/**
 * The preset values a band is measured against – the *preset*, not the project's own overrides.
 *
 * Anchoring on the preset matters: the resolved config already carries the overrides of earlier
 * calls, so a band measured there would move along with every accepted change and a client could
 * walk a temperature out of the band 25 °C per call ("ratchet"). The preset value stays put.
 */
function baseConfigOf(project: Project, type: PresetType, index: number, schema: Schema): Record<string, string> {
  const slot =
    type === 'filament' ? (project.filaments[index] ?? project.filaments[0]) : type === 'print' ? project.print : project.printer;
  return resolvePreset(schema, type, slot?.name ?? defaultPresetName(type))?.config ?? {};
}

/** A short note where the accepted keys are, instead of pasting the whole allowlist into an error. */
function allowlistHint(schema: Schema, type: PresetType): string {
  const keys = mcpAllowlistOf(schema, type);
  return `allowed: ${keys.length} ${type} process/material options, e.g. ${keys.slice(0, 8).join(', ')} (get_option_schema lists them)`;
}

/** The issues of one key: allowlist and schema shape first, then the band around the preset value. */
function issuesOf(
  schema: Schema,
  type: PresetType,
  key: string,
  value: string | number | boolean,
  base: Record<string, string>,
): McpSettingIssue[] {
  const verdict = mcpKeyVerdict(schema, type, key);
  if (verdict.allowed === false) {
    // a key that is not on the allowlist gets the hint; a wrong type or scope explains itself
    const hint = /allowlist/i.test(verdict.reason) ? allowlistHint(schema, type) : '';
    return [{ key, value: String(value), reason: verdict.reason, allowed: hint }];
  }
  let stored: string;
  try {
    stored = coerceOptionValue(schema, type, key, value);
  } catch (e) {
    return [{ key, value: String(value), reason: (e as Error).message, allowed: '' }];
  }
  const band = mcpBandIssue(key, stored, base[key]);
  if (!band) return [];
  return [{ ...band, allowed: band.allowed ? `allowed: ${band.allowed}` : '' }];
}

/**
 * Check a settings call against the would-be config without writing anything.
 *
 * Every key is checked, and every issue is reported – an agent that sent three bad values learns all
 * three in one answer. The coerced values come back only when nothing failed.
 */
export function checkSettings(schema: Schema, project: Project, scope: string, values: SettingValues): SettingsCheck {
  const { type, index } = scopeOf(scope);
  const keys = Object.keys(values);
  if (!keys.length) throw new ValidationError('values must not be empty');
  const base = baseConfigOf(project, type, index, schema);
  const issues: SettingIssue[] = [];
  const changed: Record<string, string> = {};
  for (const key of keys) {
    const found = issuesOf(schema, type, key, values[key], base);
    if (found.length) issues.push(...found.map((i) => ({ ...i, scope })));
    else changed[key] = coerceOptionValue(schema, type, key, values[key]);
  }
  return { issues, changed: issues.length ? {} : changed };
}

/** Apply validated values to a preset slot of the project (they become the project's overrides). */
export function applySettings(schema: Schema, project: Project, scope: string, values: SettingValues): Record<string, string> {
  const check = checkSettings(schema, project, scope, values);
  if (check.issues.length) throw new ValidationError(issueText(check.issues));
  const { type, index } = scopeOf(scope);
  Object.assign(slotOf(project, type, index).config, check.changed);
  return check.changed;
}

/** The tool error: one line per issue – `key: value – reason (allowed …)` – so a model can correct it. */
export function issueText(issues: SettingIssue[]): string {
  const lines = issues.map((i) => {
    const where = i.scope && i.scope !== 'print' ? ` [${i.scope}]` : '';
    return `${i.key}: ${i.value} – ${i.reason}${i.allowed ? ` (${i.allowed})` : ''}${where}`;
  });
  return `Settings rejected, nothing was changed:\n${lines.join('\n')}`;
}

const settingsInput = z.object({
  project_id: z.string(),
  scope: z.string().describe('"print", "filament" or "filament[<index>]" (0-based)'),
  values: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .describe('option key -> value, e.g. { "fill_density": "30%" }'),
});

const SET_SETTINGS_HELP =
  'Change slicer settings of a project: scope "print", "filament" or "filament[<index>]". Only process and material options are allowed (no printer options, no G-code or text options), and a value has to stay near the preset: temperatures ±25 °C, speeds ×0.5–×1.5, extrusion multiplier ±0.1, retraction length ±1 mm.';

/** The quick settings as the keys the browser writes (web/src/components/Sidebar.tsx). */
function quickSettingsValues(
  project: Project,
  args: { supports?: string; infill?: string | number; brim?: boolean },
): Record<string, string> {
  const applied: Record<string, string> = {};
  if (args.supports !== undefined) {
    applied.support_material = args.supports === 'none' ? '0' : '1';
    if (args.supports !== 'none') {
      applied.support_material_auto = args.supports === 'enforcers' ? '0' : '1';
      applied.support_material_buildplate_only = args.supports === 'buildplate' ? '1' : '0';
    }
  }
  if (args.infill !== undefined) {
    const text = String(args.infill).trim();
    applied.fill_density = text.endsWith('%') ? text : `${text}%`;
  }
  if (args.brim !== undefined) {
    applied.brim_type = args.brim ? 'outer_only' : 'no_brim';
    if (args.brim && !(Number(project.print.config.brim_width) > 0)) applied.brim_width = '5';
  }
  return applied;
}

export const settingsTools: AnyTool[] = [
  defineTool({
    name: 'webslicer.set_settings',
    title: 'Set settings',
    description: `${SET_SETTINGS_HELP} One refused key rejects the whole call; the answer then lists every issue.`,
    readOnly: false,
    input: settingsInput,
    handler: async (args, ctx) => {
      const project = await loadOwnedProject(args.project_id, ctx.owner);
      const applied = applySettings(await schemaOf(), project, args.scope, args.values);
      await touchProject(project);
      return { project_id: project.id, scope: args.scope, changed: applied, expires_at: project.expiresAt };
    },
  }),

  defineTool({
    name: 'webslicer.check_settings',
    title: 'Check settings',
    description:
      'Dry run of set_settings: same arguments, nothing is changed. Answers ok: true for a call that would be applied, or the issues (key, value, reason, allowed range) that would reject it. Use it when a value is uncertain.',
    readOnly: true,
    input: settingsInput,
    handler: async (args, ctx) => {
      const project = await loadOwnedProject(args.project_id, ctx.owner);
      const check = checkSettings(await schemaOf(), project, args.scope, args.values);
      return {
        project_id: project.id,
        scope: args.scope,
        ok: check.issues.length === 0,
        issues: check.issues,
        would_change: check.changed,
      };
    },
  }),

  defineTool({
    name: 'webslicer.quick_settings',
    title: 'Quick settings',
    description: 'The three plater quick settings (like the browser): supports, infill density and brim.',
    readOnly: false,
    input: z.object({
      project_id: z.string(),
      supports: z.enum(['none', 'buildplate', 'enforcers', 'everywhere']).optional(),
      infill: z.union([z.string(), z.number()]).optional().describe('infill density, e.g. 30 or "30%"'),
      brim: z.boolean().optional(),
    }),
    handler: async (args, ctx) => {
      if (args.supports === undefined && args.infill === undefined && args.brim === undefined) {
        throw new ValidationError('Give at least one of supports, infill, brim');
      }
      const project = await loadOwnedProject(args.project_id, ctx.owner);
      // the same apply path as set_settings, so the quick settings cannot bypass the allowlist
      const applied = applySettings(await schemaOf(), project, 'print', quickSettingsValues(project, args));
      await touchProject(project);
      return { project_id: project.id, changed: applied, print: project.print.name, expires_at: project.expiresAt };
    },
  }),
];
