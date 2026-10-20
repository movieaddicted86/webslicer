/**
 * MCP tool catalogue (concept `docs/MCP-Concept.md` §4, phase 1).
 *
 * Deliberately transport-free: `server.ts` binds these definitions to the Streamable HTTP endpoint,
 * and the stdio wrapper of phase 4 can reuse the very same list. Every tool works on the modules the
 * browser uses (presets, library, `plater/project.ts`, the job queue) and is scoped to the owner of
 * the token that called it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { createJob, getJob, jobDir } from '../jobs.js';
import { loadBundles } from '../slicer/bundles.js';
import { getSchema, type OptionDef, type PresetType, type Schema } from '../slicer/schema.js';
import { defaultPresetName, getInstalledPrinters, listPresets, resolvePreset } from '../slicer/presets.js';
import { listLibrary } from '../routes/library.js';
import { validateSliceRequest } from '../routes/api.js';
import { PROJECT_TTL_HOURS, addModelFromLibrary, arrange, createProject, listProjects, loadProject, toSliceRequest, touchProject, type Project } from '../plater/project.js';

/** live projects a single token may own */
export const MAX_PROJECTS_PER_OWNER = 20;

export interface ToolContext {
  /** owner of the token that called the tool – projects of other owners are invisible */
  owner: string;
  tokenId: string;
}

/**
 * A tool as the transport sees it: the input schema is a zod object (the SDK turns it into JSON
 * Schema and validates calls against it), the handler works on already validated arguments.
 */
export interface AnyTool {
  name: string;
  title: string;
  description: string;
  readOnly: boolean;
  input: z.ZodObject<z.ZodRawShape>;
  handler: (raw: unknown, ctx: ToolContext) => Promise<unknown>;
}

function toolError(message: string, status = 400): Error {
  return Object.assign(new Error(message), { status });
}

function defineTool<S extends z.ZodObject<z.ZodRawShape>>(def: {
  name: string;
  title: string;
  description: string;
  readOnly: boolean;
  input: S;
  handler: (args: z.output<S>, ctx: ToolContext) => Promise<unknown>;
}): AnyTool {
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    readOnly: def.readOnly,
    input: def.input,
    handler: (raw, ctx) => {
      // the SDK has validated the call already; this is the typed view of the same arguments
      const parsed = def.input.safeParse(raw ?? {});
      if (!parsed.success) {
        throw toolError(`Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'arguments'}: ${i.message}`).join('; ')}`);
      }
      return def.handler(parsed.data, ctx);
    },
  };
}

let cachedSchema: Schema | undefined;
async function schemaOf(): Promise<Schema> {
  if (!cachedSchema) cachedSchema = await getSchema(loadBundles().keys);
  return cachedSchema;
}

// ---------------------------------------------------------------------------
// projects
// ---------------------------------------------------------------------------

/** Load a project of this owner; everything else looks like it does not exist. */
export function loadOwnedProject(id: unknown, owner: string): Project {
  const project = loadProject(String(id ?? ''));
  if (!project || project.owner !== owner) throw toolError(`Project "${String(id)}" not found`, 404);
  return project;
}

function sizeOf(project: Project, index: number): number[] {
  const b = project.objects[index]?.bounds;
  if (!b) return [0, 0, 0];
  return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]].map((v) => Math.round(v * 100) / 100);
}

/** Compact view of a project – the full file (instance matrices) is not useful to an agent. */
function summary(project: Project): Record<string, unknown> {
  return {
    project_id: project.id,
    owner: project.owner,
    printer: project.printer.name,
    print: project.print.name,
    filaments: project.filaments.map((f) => f.name),
    objects: project.objects.map((o, i) => ({
      object_id: o.id,
      name: o.name,
      instances: o.instances.length,
      size_mm: sizeOf(project, i),
    })),
    expires_at: project.expiresAt,
  };
}

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------

/** `print`, `printer`, `filament` or `filament[<index>]` -> preset type and filament index. */
export function scopeOf(scope: string): { type: PresetType; index: number } {
  const s = String(scope || '').trim();
  if (s === 'print' || s === 'printer') return { type: s, index: 0 };
  const m = /^filament(?:\[(\d+)\])?$/.exec(s);
  if (!m) throw toolError(`scope must be "print", "printer", "filament" or "filament[<index>]" (got "${scope}")`);
  return { type: 'filament', index: m[1] ? Number(m[1]) : 0 };
}

const INT = /^-?\d+$/;
const FLOAT = /^-?\d+(\.\d+)?$/;
const PERCENT = /^-?\d+(\.\d+)?%?$/;
const BOOL = /^(0|1|true|false|yes|no|on|off)$/i;

/** Per-extruder options carry one value per extruder, separated by commas. */
function everyPart(text: string, part: RegExp): boolean {
  return text.split(',').every((p) => part.test(p.trim()));
}

/**
 * Check a setting against the option schema and return the value as PrusaSlicer stores it. Unknown
 * keys, keys of another preset type and values outside an enum are rejected (concept §4).
 */
export function coerceOptionValue(schema: Schema, type: PresetType, key: string, value: string | number | boolean): string {
  const opt = schema.options[key];
  if (!opt) throw toolError(`Unknown option "${key}"`);
  if (!opt.presetTypes.includes(type)) throw toolError(`Option "${key}" is not a ${type} preset option`);
  if (typeof value === 'boolean') return value ? '1' : '0';
  const text = String(value).trim();
  if (text === '') throw toolError(`Option "${key}" needs a value`);
  switch (opt.type) {
    case 'bool':
      if (!BOOL.test(text)) throw toolError(`Option "${key}" expects 0/1`);
      return /^(1|true|yes|on)$/i.test(text) ? '1' : '0';
    case 'bools':
      if (!everyPart(text, BOOL)) throw toolError(`Option "${key}" expects 0/1 values`);
      return text;
    case 'enum':
      if (opt.enumValues?.length && !opt.enumValues.includes(text)) throw toolError(`Option "${key}" must be one of: ${opt.enumValues.join(', ')}`);
      return text;
    case 'int':
      if (!INT.test(text)) throw toolError(`Option "${key}" expects an integer`);
      return text;
    case 'ints':
      if (!everyPart(text, INT)) throw toolError(`Option "${key}" expects integers (one per extruder, comma separated)`);
      return text;
    case 'float':
      if (!FLOAT.test(text)) throw toolError(`Option "${key}" expects a number`);
      return text;
    case 'floats':
      if (!everyPart(text, FLOAT)) throw toolError(`Option "${key}" expects numbers (one per extruder, comma separated)`);
      return text;
    case 'percent':
    case 'float_or_percent':
      if (!PERCENT.test(text)) throw toolError(`Option "${key}" expects a number, percents may end with "%"`);
      return text;
    case 'percents':
    case 'floats_or_percents':
      if (!everyPart(text, PERCENT)) throw toolError(`Option "${key}" expects numbers (one per extruder, comma separated, percents may end with "%")`);
      return text;
    default:
      return text; // strings, points, points3
  }
}

/** Apply validated values to a preset slot of the project (they become the project's overrides). */
export function applySettings(schema: Schema, project: Project, scope: string, values: Record<string, string | number | boolean>): Record<string, string> {
  const { type, index } = scopeOf(scope);
  const keys = Object.keys(values);
  if (!keys.length) throw toolError('values must not be empty');
  const applied: Record<string, string> = {};
  for (const key of keys) applied[key] = coerceOptionValue(schema, type, key, values[key]);
  if (type === 'print') Object.assign(project.print.config, applied);
  else if (type === 'printer') Object.assign(project.printer.config, applied);
  else {
    const slots = project.filaments.length ? project.filaments : [{ name: defaultPresetName('filament'), config: {} }];
    while (slots.length <= index) slots.push({ ...slots[slots.length - 1], config: { ...slots[slots.length - 1].config } });
    project.filaments = slots;
    Object.assign(slots[index].config, applied);
  }
  return applied;
}

// ---------------------------------------------------------------------------
// jobs
// ---------------------------------------------------------------------------

/** Warnings and errors of a finished job, from the slicer log. */
function warningsOf(jobId: string): string[] {
  let text = '';
  try {
    text = fs.readFileSync(path.join(jobDir(jobId), 'log.txt'), 'utf8');
  } catch {
    return [];
  }
  return text
    .split('\n')
    .filter((l) => /warn|error|critical|invalid/i.test(l))
    .slice(-20)
    .map((l) => (l.length > 300 ? `${l.slice(0, 300)}…` : l.trim()));
}

// ---------------------------------------------------------------------------
// catalogue
// ---------------------------------------------------------------------------

export const TOOLS: AnyTool[] = [
  defineTool({
    name: 'webslicer.list_printers',
    title: 'List printers',
    description: 'Installed printers of this WebSlicer and the printer presets that can be used for a project.',
    readOnly: true,
    input: z.object({}),
    handler: async () => {
      const schema = await schemaOf();
      const presets = listPresets(schema, 'printer');
      return {
        printers: getInstalledPrinters().map((i) => ({
          vendor: i.vendorId,
          model: i.modelId,
          variant: i.variant,
          presets: presets.filter((p) => p.printerModel === i.modelId && p.printerVariant === i.variant).map((p) => p.name),
        })),
        default_printer: defaultPresetName('printer'),
        default_print: defaultPresetName('print'),
        default_filament: defaultPresetName('filament'),
      };
    },
  }),

  defineTool({
    name: 'webslicer.list_presets',
    title: 'List presets',
    description: 'Print, filament and printer presets. Give a printer (and print) preset to get the compatibility flag.',
    readOnly: true,
    input: z.object({
      type: z.enum(['print', 'filament', 'printer']).describe('preset type'),
      printer: z.string().optional().describe('printer preset name; filament/print compatibility is checked against it'),
      print: z.string().optional().describe('print preset name; used for filament compatibility'),
    }),
    handler: async (args) => {
      const schema = await schemaOf();
      const printerCfg = args.printer === undefined ? undefined : resolvePreset(schema, 'printer', args.printer)?.config;
      if (args.printer !== undefined && !printerCfg) throw toolError(`Unknown printer preset "${args.printer}"`, 404);
      const printCfg = args.print === undefined ? undefined : resolvePreset(schema, 'print', args.print)?.config;
      if (args.print !== undefined && !printCfg) throw toolError(`Unknown print preset "${args.print}"`, 404);
      const list = listPresets(schema, args.type, { printerName: args.printer, printerConfig: printerCfg, printName: args.print, printConfig: printCfg });
      return {
        type: args.type,
        count: list.length,
        presets: list.map((p) => ({
          name: p.name,
          system: p.system,
          compatible: p.compatible ?? null,
          vendor: p.vendorName ?? null,
          model: p.printerModel ?? null,
          variant: p.printerVariant ?? null,
          technology: p.technology ?? null,
        })),
      };
    },
  }),

  defineTool({
    name: 'webslicer.get_option_schema',
    title: 'Get option schema',
    description: 'Slicer options with label, type, default and allowed values – the options set_settings accepts.',
    readOnly: true,
    input: z.object({
      query: z.string().optional().describe('substring of the key, label, category or tooltip'),
      type: z.enum(['print', 'filament', 'printer']).optional().describe('only options of this preset type'),
      limit: z.number().int().min(1).max(200).optional().describe('maximum number of options (default 50)'),
    }),
    handler: async (args) => {
      const schema = await schemaOf();
      const needle = (args.query || '').trim().toLowerCase();
      const limit = args.limit ?? 50;
      // the key is what set_settings needs, so a key match ranks before a tooltip that only mentions it
      const rank = (o: OptionDef): number => {
        const key = o.key.toLowerCase();
        if (key === needle) return 0;
        if (key.includes(needle)) return 1;
        if (String(o.label || '').toLowerCase().includes(needle)) return 2;
        return 3;
      };
      const all = Object.values(schema.options).filter((o) => {
        if (args.type && !o.presetTypes.includes(args.type)) return false;
        if (!needle) return true;
        return [o.key, o.label, o.category, o.tooltip].some((f) => String(f || '').toLowerCase().includes(needle));
      });
      if (needle) all.sort((a, b) => rank(a) - rank(b));
      return {
        count: Math.min(all.length, limit),
        total_matches: all.length,
        options: all.slice(0, limit).map((o) => ({
          key: o.key,
          label: o.label,
          type: o.type,
          default: o.default,
          enum_values: o.enumValues ?? null,
          category: o.category,
          preset_types: o.presetTypes,
          per_extruder: !!o.perExtruder,
          tooltip: o.tooltip.length > 300 ? `${o.tooltip.slice(0, 300)}…` : o.tooltip,
        })),
      };
    },
  }),

  defineTool({
    name: 'webslicer.list_library',
    title: 'List library',
    description: 'Files and folders of the model library (models, 3MF projects, G-code).',
    readOnly: true,
    input: z.object({ path: z.string().optional().describe('folder relative to the library root (default: root)') }),
    handler: async (args) => {
      const listing = listLibrary(args.path || '');
      return {
        path: listing.path,
        entries: listing.entries.map((e) => ({ name: e.name, path: e.path, dir: e.dir, kind: e.kind ?? null, size_bytes: e.size ?? null, modified: e.mtime ?? null })),
      };
    },
  }),

  defineTool({
    name: 'webslicer.create_project',
    title: 'Create project',
    description: `Start a server-side project (a plater without a browser) for a printer, print and filament preset. It expires ${PROJECT_TTL_HOURS} h after its last use.`,
    readOnly: false,
    input: z.object({
      printer: z.string().describe('printer preset name, e.g. from list_printers'),
      print: z.string().describe('print preset name'),
      filaments: z.array(z.string()).optional().describe('filament preset names, one per extruder'),
    }),
    handler: async (args, ctx) => {
      const schema = await schemaOf();
      const live = listProjects().filter((p) => p.owner === ctx.owner);
      if (live.length >= MAX_PROJECTS_PER_OWNER) {
        throw toolError(`Too many live projects (${MAX_PROJECTS_PER_OWNER}); one of them expires ${PROJECT_TTL_HOURS} h after its last use`);
      }
      const project = createProject({
        schema,
        printer: { name: args.printer, config: {} },
        print: { name: args.print, config: {} },
        filaments: args.filaments?.map((name) => ({ name, config: {} })),
        owner: ctx.owner,
      });
      return summary(project);
    },
  }),

  defineTool({
    name: 'webslicer.add_model',
    title: 'Add model',
    description: 'Add a model from the library to the project (STL or 3MF; a 3MF keeps its objects and their places). `copies` repeats each model.',
    readOnly: false,
    input: z.object({
      project_id: z.string(),
      library_path: z.string().describe('path relative to the library root, e.g. "samples/calibration_cube_20mm.stl"'),
      copies: z.number().int().min(1).max(1000).optional().describe('number of copies (default 1)'),
    }),
    handler: async (args, ctx) => {
      const project = loadOwnedProject(args.project_id, ctx.owner);
      await addModelFromLibrary(project, args.library_path, args.copies ?? 1);
      return summary(project);
    },
  }),

  defineTool({
    name: 'webslicer.arrange',
    title: 'Arrange',
    description: 'Place every instance of the project on the bed (the same shelf packing the browser uses).',
    readOnly: false,
    input: z.object({ project_id: z.string() }),
    handler: async (args, ctx) => summary(arrange(loadOwnedProject(args.project_id, ctx.owner), await schemaOf())),
  }),

  defineTool({
    name: 'webslicer.set_settings',
    title: 'Set settings',
    description: 'Change slicer settings of a project: scope "print", "printer", "filament" or "filament[<index>]". Keys and values are validated against the slicer schema (see get_option_schema).',
    readOnly: false,
    input: z.object({
      project_id: z.string(),
      scope: z.string().describe('"print", "printer", "filament" or "filament[<index>]" (0-based)'),
      values: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
        .describe('option key -> value, e.g. { "fill_density": "30%" }'),
    }),
    handler: async (args, ctx) => {
      const project = loadOwnedProject(args.project_id, ctx.owner);
      const applied = applySettings(await schemaOf(), project, args.scope, args.values);
      touchProject(project);
      return { project_id: project.id, scope: args.scope, changed: applied, expires_at: project.expiresAt };
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
        throw toolError('Give at least one of supports, infill, brim');
      }
      const project = loadOwnedProject(args.project_id, ctx.owner);
      const schema = await schemaOf();
      const applied: Record<string, string> = {};
      // exactly the values the browser's quick settings write (web/src/components/Sidebar.tsx)
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
      for (const [key, value] of Object.entries(applied)) coerceOptionValue(schema, 'print', key, value);
      Object.assign(project.print.config, applied);
      touchProject(project);
      return { project_id: project.id, changed: applied, print: project.print.name, expires_at: project.expiresAt };
    },
  }),

  defineTool({
    name: 'webslicer.slice',
    title: 'Slice',
    description: 'Slice the project. Answers a job id; poll it with get_job (headless slices carry no thumbnails).',
    readOnly: false,
    input: z.object({ project_id: z.string() }),
    handler: async (args, ctx) => {
      const project = loadOwnedProject(args.project_id, ctx.owner);
      const schema = await schemaOf();
      const request = toSliceRequest(project, schema);
      validateSliceRequest(request);
      const job = createJob(request, schema);
      touchProject(project);
      return {
        job_id: job.id,
        status: job.status,
        output_name: job.outputName,
        technology: job.technology,
        objects: job.objectNames,
        print: job.presets.print,
        printer: job.presets.printer,
        filaments: job.presets.filaments,
      };
    },
  }),

  defineTool({
    name: 'webslicer.get_job',
    title: 'Get job',
    description: 'State and result of a slicing job: status, progress, print time, filament, layers and the slicer warnings.',
    readOnly: true,
    input: z.object({ job_id: z.string() }),
    handler: async (args) => {
      const job = getJob(args.job_id);
      if (!job) throw toolError(`Job "${args.job_id}" not found`, 404);
      const info = job.info;
      return {
        job_id: job.id,
        status: job.status,
        percent: job.percent,
        message: job.message,
        error: job.error ?? null,
        output_name: job.outputName,
        technology: job.technology,
        objects: job.objectNames,
        created_at: job.createdAt,
        finished_at: job.finishedAt ?? null,
        result:
          job.status === 'done'
            ? {
                time: info?.estimatedTime ?? null,
                time_seconds: info?.estimatedTimeSeconds ?? null,
                layers: info?.layers ?? null,
                max_z: info?.maxZ ?? null,
                filament_mm: info?.filamentUsedMm ?? null,
                filament_g: info?.totalFilamentG ?? info?.filamentUsedG ?? null,
                filament_cost: info?.totalFilamentCost ?? null,
                size_bytes: info?.sizeBytes ?? null,
              }
            : null,
        warnings: warningsOf(job.id),
      };
    },
  }),
];

/** Tool names in catalogue order (used by the E2E script and the docs). */
export const TOOL_NAMES: string[] = TOOLS.map((t) => t.name);
