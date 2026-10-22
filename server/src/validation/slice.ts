/**
 * The slice request as a zod schema (R-10).
 *
 * Port of the hand-written `validateSliceRequest` of R-9, rule for rule and wording for wording. Two
 * properties of the old function are load-bearing and are reproduced by the *shape* of the schema:
 *
 * 1. **Order.** The old function threw at the first failure, and the client shows that one message, so
 *    which rule wins is part of the contract. The schema keeps the same order by chaining the rule
 *    groups with `.pipe()`: a stage reports its issues only when the stage before it passed. Inside a
 *    stage the issues come in property order, which is the order of the checks they replace.
 * 2. **No strictness beyond the rules.** The payloads carry fields no rule looks at (and that the
 *    services read later), so every object is a `looseObject` – unknown keys are *kept*, not stripped.
 *
 * On top of the rules the old function *normalised* two fields: the first instance overwrites the
 * legacy `transform`, and a missing `filaments` becomes `[]`. `parseSliceRequest` does that on the
 * parsed copy, and `services/slice.ts` writes the two fields back into the caller's request.
 */
import { z } from 'zod';
import { CUSTOM_GCODE_TYPES, VOLUME_TYPES, invalidConfigKeyMessage } from '@webslicer/shared';
import { invalidKeyInRequest } from './config.js';
import { firstIssueMessage, ordered } from './common.js';

// The messages are the API contract – pinned by `services/slice.test.ts`.
const BODY_REQUIRED = 'body required';
const OBJECT_REQUIRED = 'at least one object required';
const MODEL_ID = 'invalid modelId';
const TRANSFORM_COUNT = 'transform must have 16 entries';
const TRANSFORM_FINITE = 'transform must contain 16 finite numbers';
const INSTANCES_COUNT = 'instances must have 1-1000 entries';
const INSTANCE_TRANSFORM = 'every instance must be a transform with 16 finite numbers';
const RANGES = 'invalid ranges';
const RANGE = 'invalid range';
const RANGE_CONFIG = 'range config required';
const VOLUMES = 'invalid volumes';
const VOLUME_MODEL_ID = 'invalid volume modelId';
const VOLUME_TRANSFORM = 'volume transform must have 16 entries';
const CONFIG_REQUIRED = 'print and printer config required';
const CUSTOM_GCODES = 'at most 500 custom G-codes';
const GCODE_HEIGHT = 'invalid custom G-code height';
const GCODE_COLOR = 'invalid custom G-code colour';
const GCODE_TEXT = 'invalid custom G-code text';
const GCODE_EXTRUDER = 'invalid custom G-code extruder';
const THUMBNAILS = 'at most 8 thumbnails';
const THUMBNAIL_FORMAT = 'invalid thumbnail format';
const THUMBNAIL_SIZE = 'invalid thumbnail size';
const THUMBNAIL_DATA = 'invalid thumbnail data';

const UUID = /^[0-9a-f-]{36}$/i;

/** A complete 4x4 transform: exactly 16 numbers, none of them NaN or infinite. */
const finiteTransform = z
  .array(z.number({ error: () => TRANSFORM_FINITE }), { error: () => TRANSFORM_FINITE })
  .length(16, TRANSFORM_FINITE);

/** The legacy `transform` of an object, where the shape and the contents have their own messages. */
const transformShape = z.array(z.unknown(), { error: () => TRANSFORM_COUNT }).length(16, TRANSFORM_COUNT);

/** A volume transform: shape and contents share one message, so one schema says both. */
const volumeTransformShape = z
  .array(z.number({ error: () => VOLUME_TRANSFORM }), { error: () => VOLUME_TRANSFORM })
  .length(16, VOLUME_TRANSFORM);

/** Is this a complete transform? `finiteTransform` answers it – no second implementation of the rule. */
function isCompleteTransform(v: unknown): boolean {
  return finiteTransform.safeParse(v).success;
}

/** `type` of a custom G-code or a volume: the message names the value, as the old checks did. */
function enumOf(values: readonly string[], message: (input: unknown) => string) {
  return z.enum(values as [string, ...string[]], { error: (iss) => message((iss as unknown as { input: unknown }).input) });
}

// ---------------------------------------------------------------------------
// objects
// ---------------------------------------------------------------------------

/** The volume of an object (a modifier, an enforcer, …). */
const volumeSchema = ordered(
  z
    .looseObject(
      {
        modelId: z.string({ error: () => VOLUME_MODEL_ID }).regex(UUID, VOLUME_MODEL_ID),
        transform: volumeTransformShape,
      },
      { error: () => VOLUME_MODEL_ID },
    )
    // contents and shape report the same message here, so one transform schema answers both
    .superRefine((v, ctx) => {
      if (v.transform.every((x) => typeof x === 'number' && Number.isFinite(x))) return;
      ctx.addIssue({ code: 'custom', path: ['transform'], message: VOLUME_TRANSFORM });
    }),
  z.looseObject({ type: enumOf(VOLUME_TYPES, (t) => `invalid volume type ${String(t)}`) }, { error: () => VOLUME_MODEL_ID }),
);

/**
 * A height range of an object with its own config.
 *
 * The heights are one compound condition, as they were before: they have to be numbers and the range
 * has to be a real interval above the bed (`maxZ > minZ`, `minZ >= 0`). Deliberately *not* four zod
 * checks: the old condition accepted an infinite `maxZ` and rejected everything non-numeric with the
 * same message, and a refactoring may not turn a body that worked into a 400.
 */
const rangeSchema = ordered(
  z.unknown().superRefine((v, ctx) => {
    const r = v as { minZ?: unknown; maxZ?: unknown } | undefined;
    if (typeof r?.minZ !== 'number' || typeof r?.maxZ !== 'number' || !(r.maxZ > r.minZ) || r.minZ < 0)
      ctx.addIssue({ code: 'custom', message: RANGE });
  }),
  z.looseObject(
    { config: z.unknown().refine((v) => !!v && typeof v === 'object', { error: () => RANGE_CONFIG }) },
    { error: () => RANGE_CONFIG },
  ),
);

/** `instances`: 1-1000 transforms, each of them complete and finite. */
const instancesSchema = ordered(
  z.unknown().superRefine((v, ctx) => {
    // only a well-sized array can get this far; the shape stage names the other failures
    if (Array.isArray(v) && v.length >= 1 && v.length <= 1000 && v.some((t) => !isCompleteTransform(t)))
      ctx.addIssue({ code: 'custom', message: INSTANCE_TRANSFORM });
  }),
  z
    .array(finiteTransform, { error: () => INSTANCES_COUNT })
    .min(1, INSTANCES_COUNT)
    .max(1000, INSTANCES_COUNT),
);

const objectSchema = ordered(
  z
    .looseObject(
      {
        modelId: z.string({ error: () => MODEL_ID }).regex(UUID, MODEL_ID),
        transform: transformShape,
      },
      { error: () => MODEL_ID },
    )
    // the legacy transform is only inspected when no `instances` replace it
    .superRefine((o, ctx) => {
      if (o.instances !== undefined) return;
      if (!isCompleteTransform(o.transform)) ctx.addIssue({ code: 'custom', path: ['transform'], message: TRANSFORM_FINITE });
    }),
  z.looseObject({
    instances: instancesSchema.optional(),
    supportPaint: z
      .string({ error: () => 'invalid supportPaint' })
      .max(2_000_000, 'invalid supportPaint')
      .regex(/^[048]*$/, 'invalid supportPaint')
      .optional(),
    seamPaint: z
      .string({ error: () => 'invalid seamPaint' })
      .max(2_000_000, 'invalid seamPaint')
      .regex(/^[048]*$/, 'invalid seamPaint')
      .optional(),
    mmuPaint: z
      .string({ error: () => 'invalid mmuPaint' })
      .max(2_000_000, 'invalid mmuPaint')
      .regex(/^[0-9a-f]*$/i, 'invalid mmuPaint')
      .optional(),
    // `ranges` is checked when the key is present at all, `volumes` only when it is truthy – as before
    ranges: z
      .array(rangeSchema, { error: () => RANGES })
      .max(64, RANGES)
      .optional(),
    volumes: z.preprocess((v) => (v ? v : undefined), z.array(volumeSchema, { error: () => VOLUMES }).optional()),
  }),
);

// ---------------------------------------------------------------------------
// the body
// ---------------------------------------------------------------------------

const customGcodeSchema = z.looseObject(
  {
    printZ: z
      .number({ error: () => GCODE_HEIGHT })
      .finite(GCODE_HEIGHT)
      .gt(0, GCODE_HEIGHT),
    type: enumOf(CUSTOM_GCODE_TYPES, (t) => `invalid custom G-code type ${String(t)}`),
    color: z
      .string({ error: () => GCODE_COLOR })
      .regex(/^#[0-9a-f]{6}$/i, GCODE_COLOR)
      .optional(),
    extra: z
      .string({ error: () => GCODE_TEXT })
      .max(20000, GCODE_TEXT)
      .optional(),
    extruder: z
      .number({ error: () => GCODE_EXTRUDER })
      .int(GCODE_EXTRUDER)
      .gt(0, GCODE_EXTRUDER)
      .lte(16, GCODE_EXTRUDER)
      .optional(),
  },
  { error: () => GCODE_HEIGHT },
);

const thumbnailSchema = z.looseObject(
  {
    format: z.enum(['PNG', 'JPG', 'QOI'], { error: () => THUMBNAIL_FORMAT }),
    width: z
      .number({ error: () => THUMBNAIL_SIZE })
      .int(THUMBNAIL_SIZE)
      .gt(0, THUMBNAIL_SIZE)
      .lte(2000, THUMBNAIL_SIZE),
    height: z
      .number({ error: () => THUMBNAIL_SIZE })
      .int(THUMBNAIL_SIZE)
      .gt(0, THUMBNAIL_SIZE)
      .lte(2000, THUMBNAIL_SIZE),
    data: z
      .string({ error: () => THUMBNAIL_DATA })
      .max(4_000_000, THUMBNAIL_DATA)
      .regex(/^[A-Za-z0-9+/=\s]*$/, THUMBNAIL_DATA),
  },
  { error: () => THUMBNAIL_FORMAT },
);

/**
 * A slice request, in the order the old checks ran: the body itself, its objects, the two required
 * configs, the two lists.
 */
export const sliceRequestSchema = ordered(
  z.custom<Record<string, unknown>>((v) => !!v && typeof v === 'object', { error: () => BODY_REQUIRED }),
  z.looseObject(
    { objects: z.array(objectSchema, { error: () => OBJECT_REQUIRED }).min(1, OBJECT_REQUIRED) },
    { error: () => OBJECT_REQUIRED },
  ),
  z.looseObject(
    {
      print: z.unknown().refine((v) => !!(v as { config?: unknown } | undefined)?.config, { error: () => CONFIG_REQUIRED }),
      printer: z.unknown().refine((v) => !!(v as { config?: unknown } | undefined)?.config, { error: () => CONFIG_REQUIRED }),
      // not an array at all: the slicer gets an empty list (the old function assigned `[]`)
      filaments: z.array(z.unknown(), { error: () => 'filaments must be an array' }).catch([]),
      customGcodes: z
        .array(customGcodeSchema, { error: () => CUSTOM_GCODES })
        .max(500, CUSTOM_GCODES)
        .optional(),
      thumbnails: z
        .array(thumbnailSchema, { error: () => THUMBNAILS })
        .max(8, THUMBNAILS)
        .optional(),
    },
    { error: () => OBJECT_REQUIRED },
  ),
  // SEC-2: the config keys are part of the INI file the slicer loads, so they are validated as input.
  // Last stage: the messages above keep precedence, and a body without configs is caught there.
  z.unknown().superRefine((v, ctx) => {
    const key = invalidKeyInRequest(v as Parameters<typeof invalidKeyInRequest>[0]);
    if (key !== undefined) ctx.addIssue({ code: 'custom', message: invalidConfigKeyMessage(key) });
  }),
);

export interface ParsedSliceRequest {
  objects: Array<{ transform: unknown[]; instances?: unknown[][] } & Record<string, unknown>>;
  filaments: unknown[];
  print: unknown;
  printer: unknown;
  customGcodes?: unknown[];
  thumbnails?: unknown[];
  [key: string]: unknown;
}

/** Parse a slice request; the message of the first issue is the one the API shows. */
export function parseSliceRequest(body: unknown): { ok: true; request: ParsedSliceRequest } | { ok: false; message: string } {
  const parsed = sliceRequestSchema.safeParse(body);
  if (!parsed.success) return { ok: false, message: firstIssueMessage(parsed.error, BODY_REQUIRED) };
  const request = parsed.data as ParsedSliceRequest;
  // the normalisation the old validator did: the first instance owns the legacy transform
  for (const o of request.objects) if (o.instances?.length) o.transform = o.instances[0];
  return { ok: true, request };
}
