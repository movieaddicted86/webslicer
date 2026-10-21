/**
 * The server-side project payloads as zod schemas (R-10).
 *
 * Used by the REST routes under `/api/projects` **and** the MCP project tools, so "a preset slot is
 * either a bare name or `{ name, config }`" is declared once. The messages are the ones the API has
 * shown since the routes were written (`routes/http.test.ts` pins three of them).
 */
import { z } from 'zod';
import { firstIssueMessage, ordered } from './common.js';
import type { IniSection } from '../slicer/ini.js';
import type { ProjectPresetRef } from '../services/projects.js';

/** The label of a preset slot in a message: `printer`, `print`, `filaments[0]`. */
export type SlotLabel = string;

/**
 * A preset slot: `"MK4S"` or `{ name, config }`.
 *
 * The rule and the order are those of the old `presetRef`: a string is a name, an object may carry a
 * config – which has to be an object, not an array – and anything else is neither.
 */
export function presetSlotSchema(label: SlotLabel) {
  return z.unknown().superRefine((v, ctx) => {
    if (typeof v === 'string') return;
    if (v && typeof v === 'object') {
      const config = (v as { config?: unknown }).config;
      if (config !== undefined && (typeof config !== 'object' || config === null || Array.isArray(config)))
        ctx.addIssue({ code: 'custom', message: `${label}.config must be an object` });
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
 * `POST /api/projects`: preset slots for printer, print and the filaments, plus an optional owner.
 *
 * The body itself became `{}` when it was falsy (`req.body || {}`), and an unknown key is ignored –
 * the coordinate the setup wizard sends, for instance. So the body stage only rejects a value that
 * cannot carry keys at all.
 */
const projectCreateSchema = ordered(
  z.custom<Record<string, unknown>>((v) => !!v && typeof v === 'object', { error: () => 'printer must be a preset name or { name, config }' }),
  z.looseObject({ filaments: filamentsSurfaceSchema.optional() }),
  z.looseObject({ printer: presetSlotSchema('printer'), print: presetSlotSchema('print') }),
  z.looseObject({
    filaments: z.array(presetSlotSchema('filaments')).optional(),
    owner: z.unknown().optional(),
  }),
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

/** `POST /api/projects/:id/models`: a library path and how many copies of each model. */
export const projectModelsSchema = z.looseObject({
  libraryPath: z
    .string({ error: () => 'libraryPath required' })
    .refine((v) => !!v.trim(), { error: () => 'libraryPath required' }),
  copies: z.unknown().optional(),
});

/** `copies` of the models route: the store validates the range, the route only coerces, as it did. */
export function copiesOf(value: unknown): number {
  return value === undefined ? 1 : Number(value);
}

/** The body of `POST /api/projects/:id/slice` – both fields are optional overrides. */
export const projectSliceSchema = z.looseObject({
  binaryGcode: z.unknown().optional(),
  outputName: z.unknown().optional(),
});
