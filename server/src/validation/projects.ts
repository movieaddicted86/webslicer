/**
 * The server-side project payloads as zod schemas (R-10).
 *
 * Used by the REST routes under `/api/projects` **and** the MCP project tools, so "a preset slot is
 * either a bare name or `{ name, config }`" is declared once. The messages are the ones the API has
 * shown since the routes were written (`routes/http.test.ts` pins three of them).
 */
import { z } from 'zod';
import { invalidConfigKeyMessage } from '@webslicer/shared';
import { invalidKeyOf } from './config.js';
import { firstIssueMessage, ordered } from './common.js';
import type { IniSection } from '../slicer/ini.js';

/** A preset slot of a project: a preset name plus the options that differ from it. */
export interface ProjectPresetRef {
  name: string;
  /** options that differ from the preset (merged over the resolved preset at slice time) */
  config: IniSection;
}

/** The label of a preset slot in a message: `printer`, `print`, `filaments[0]`. */
export type SlotLabel = string;

/**
 * A preset slot: `"MK4S"` or `{ name, config }`.
 *
 * The rule and the order are those of the old `presetRef`: a string is a name, an object may carry a
 * config – which has to be an object, not an array – and anything else is neither. The config keys are
 * a rule since SEC-2: a project config is written into the INI/3MF the slicer loads.
 */
export function presetSlotSchema(label: SlotLabel) {
  return z.unknown().superRefine((v, ctx) => {
    if (typeof v === 'string') return;
    if (v && typeof v === 'object') {
      const config = (v as { config?: unknown }).config;
      if (config !== undefined && (typeof config !== 'object' || config === null || Array.isArray(config)))
        ctx.addIssue({ code: 'custom', message: `${label}.config must be an object` });
      const key = invalidKeyOf(config);
      if (key !== undefined) ctx.addIssue({ code: 'custom', message: `${label}: ${invalidConfigKeyMessage(key)}` });
      return;
    }
    ctx.addIssue({ code: 'custom', message: `${label} must be a preset name or { name, config }` });
  });
}

/**
 * Turn an already validated slot into a preset reference.
 *
 * Shared by the REST route and the MCP tools: the conversion (trim the name, default the config) has
 * one owner, and it behaves exactly like the hand-written helper it replaces.
 */
export function toPresetRef(value: unknown): ProjectPresetRef {
  if (typeof value === 'string') return { name: value.trim(), config: {} };
  const v = (value || {}) as { name?: unknown; config?: unknown };
  return { name: String(v.name ?? '').trim(), config: (v.config as IniSection) || {} };
}

/**
 * The `filaments` key of a project body: an array when it is there at all.
 *
 * That check ran before the slots were read (it was the first line of the route), and the message is
 * pinned by `routes/http.test.ts` – so it is the first stage of `parseProjectCreate`.
 */
const filamentsSurfaceSchema = z.unknown().superRefine((v, ctx) => {
  if (v !== undefined && !Array.isArray(v)) ctx.addIssue({ code: 'custom', message: 'filaments must be an array' });
});

/**
 * The `filaments` of a project body: an array of slots, each named in a message by its index
 * (`filaments[0] …`), plus an optional owner.
 *
 * The slots are checked here and not by `z.array(presetSlotSchema(…))` because the label differs per
 * element – and the rule itself still comes from `presetSlotSchema`, so there is one owner of it.
 */
const projectSlotsSchema = z.looseObject({
  filaments: z
    .unknown()
    .optional()
    .superRefine((v, ctx) => {
      if (!Array.isArray(v)) return; // the surface stage above names that failure
      v.forEach((element, i) => {
        const slot = presetSlotSchema(`filaments[${i}]`).safeParse(element);
        if (!slot.success) for (const issue of slot.error.issues) ctx.addIssue({ code: 'custom', message: issue.message });
      });
    }),
  owner: z.unknown().optional(),
});

/**
 * `POST /api/projects`: preset slots for printer, print and the filaments, plus an optional owner.
 *
 * The body itself became `{}` when it was falsy (`req.body || {}`), and an unknown key is ignored –
 * the coordinate the setup wizard sends, for instance. So the body stage only rejects a value that
 * cannot carry keys at all.
 */
const projectCreateSchema = ordered(
  z.custom<Record<string, unknown>>((v) => !!v && typeof v === 'object', {
    error: () => 'printer must be a preset name or { name, config }',
  }),
  z.looseObject({ filaments: filamentsSurfaceSchema.optional() }),
  z.looseObject({ printer: presetSlotSchema('printer'), print: presetSlotSchema('print') }),
  projectSlotsSchema,
);

/** Validate a project create body; the first issue's message is the one the client shows. */
export function parseProjectCreate(
  body: unknown,
):
  | { ok: true; printer: ProjectPresetRef; print: ProjectPresetRef; filaments?: ProjectPresetRef[]; owner?: string }
  | { ok: false; message: string } {
  const parsed = projectCreateSchema.safeParse(body);
  if (!parsed.success) return { ok: false, message: firstIssueMessage(parsed.error, 'invalid project') };
  const data = parsed.data as { printer: unknown; print: unknown; filaments?: unknown[]; owner?: unknown };
  return {
    ok: true,
    printer: toPresetRef(data.printer),
    print: toPresetRef(data.print),
    filaments: data.filaments?.map((f) => toPresetRef(f)),
    owner: data.owner === undefined ? undefined : String(data.owner),
  };
}

/**
 * `POST /api/projects/:id/models`: a library path and how many copies of each model.
 *
 * A body that cannot carry keys at all (the route read `req.body || {}`) is the empty body, so the
 * missing path is named – not the body type.
 */
export const projectModelsSchema = z.preprocess(
  (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}),
  z.looseObject({
    libraryPath: z.string({ error: () => 'libraryPath required' }).refine((v) => !!v.trim(), { error: () => 'libraryPath required' }),
    copies: z.unknown().optional(),
  }),
);

/**
 * How many copies of a model.
 *
 * The one rule, declared once: the MCP tool takes it as its client-visible input schema (where the
 * range is part of the tool contract) and the store refuses the same range at the other end.
 */
export const copiesSchema = z.number().int().min(1).max(1000);

/** `copies` of the models route: the store validates the range, the route only coerces, as it did. */
export function copiesOf(value: unknown): number {
  return value === undefined ? 1 : Number(value);
}

/**
 * The optional options of `POST /api/projects/:id/arrange` and the MCP arrange tool (T-043): the
 * same knobs the browser's Arrange settings have (spacing, rotations, alignment). Unknown keys are
 * ignored like on the other project routes; an empty body means "today's layout".
 */
export const arrangeOptionsSchema = z.looseObject({
  spacing: z.number().min(0).max(100).optional(),
  rotations: z.boolean().optional(),
  alignment: z.enum(['center', 'corner']).optional(),
});

/**
 * The body of `POST /api/projects/:id/slice` – both fields are optional overrides of the project.
 *
 * The rules are the ones the route applied by hand: `binaryGcode` is read as a flag, `outputName` only
 * counts when it is a non-empty string (anything else leaves the project's own name alone – such a
 * value is dropped, not kept as `undefined`).
 */
export const projectSliceSchema = z.preprocess(
  (v) => {
    const body = (v && typeof v === 'object' ? { ...(v as Record<string, unknown>) } : {}) as Record<string, unknown>;
    if ('outputName' in body && !(typeof body.outputName === 'string' && body.outputName.trim())) delete body.outputName;
    return body;
  },
  z.looseObject({
    binaryGcode: z
      .unknown()
      .optional()
      .transform((v) => (v === undefined ? undefined : !!v)),
    outputName: z
      .string()
      .optional()
      .transform((v) => (v === undefined ? undefined : v.trim())),
  }),
);
