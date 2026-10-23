/**
 * `POST /api/cut` as a zod schema (T-044).
 *
 * The payload is small and self-contained, so the rules are one object: a model id, one instance
 * transform, the plane and the keep options. The messages are the API contract, like the slice
 * schema's.
 */
import { z } from 'zod';
import { firstIssueMessage } from './common.js';
import type { CutKeep, CutRequest, Vec3 } from '@webslicer/shared';

const MODEL_ID = 'invalid modelId';
const TRANSFORM = 'transform must contain 16 finite numbers';
const POINT = 'plane point must be 3 finite numbers';
const NORMAL = 'plane normal must be 3 finite numbers';
const NORMAL_DIRECTION = 'plane normal must not be zero';
const KEEP = 'invalid keep (both, upper or lower)';

const finiteTriple = (message: string) =>
  z
    .array(z.number({ error: () => message }), { error: () => message })
    .length(3, message)
    // the three entries *are* a `Vec3` of the contract; the cast is zod's array -> tuple narrowing
    .transform((v): Vec3 => [v[0], v[1], v[2]]);

/** The three parts the user may keep. */
export const CUT_KEEP_VALUES: CutKeep[] = ['both', 'upper', 'lower'];

const cutRequestShape = z.looseObject({
  modelId: z.string({ error: () => MODEL_ID }).regex(/^[0-9a-f-]{36}$/i, MODEL_ID),
  transform: z.array(z.number({ error: () => TRANSFORM }), { error: () => TRANSFORM }).length(16, TRANSFORM),
  plane: z.looseObject(
    {
      point: finiteTriple(POINT),
      normal: finiteTriple(NORMAL).refine((v) => Math.hypot(v[0], v[1], v[2]) > 1e-9, NORMAL_DIRECTION),
    },
    { error: () => 'plane required' },
  ),
  keep: z.enum(CUT_KEEP_VALUES as [CutKeep, ...CutKeep[]], { error: () => KEEP }).default('both'),
  placeOnCut: z.boolean({ error: () => 'invalid placeOnCut' }).optional(),
  flipUpper: z.boolean({ error: () => 'invalid flipUpper' }).optional(),
});

/** The cut payload as the `CutRequest` contract – assignment checked, not cast. */
export const cutRequestSchema: z.ZodType<CutRequest> = cutRequestShape;

/** Parse a cut request; `ok: false` carries the message the route answers with (400). */
export function parseCutRequest(body: unknown): { ok: true; request: CutRequest } | { ok: false; message: string } {
  const parsed = cutRequestSchema.safeParse(body ?? {});
  if (!parsed.success) return { ok: false, message: firstIssueMessage(parsed.error, 'invalid cut request') };
  return { ok: true, request: parsed.data };
}
