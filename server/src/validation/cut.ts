/**
 * `POST /api/cut` as a zod schema (T-044).
 *
 * The payload is small and self-contained, so the rules are one object: a model id, one instance
 * transform, the plane and the keep options. The messages are the API contract, like the slice
 * schema's.
 */
import { z } from 'zod';
import { firstIssueMessage } from './common.js';
import type { CutKeep, CutRequest } from '@webslicer/shared';

const MODEL_ID = 'invalid modelId';
const TRANSFORM = 'transform must contain 16 finite numbers';
const POINT = 'plane point must be 3 finite numbers';
const NORMAL = 'plane normal must be 3 finite numbers';
const NORMAL_DIRECTION = 'plane normal must not be zero';
const KEEP = 'invalid keep (both, upper or lower)';

const finiteTriple = (message: string) => z.array(z.number({ error: () => message }), { error: () => message }).length(3, message);

/** The three parts the user may keep. */
export const CUT_KEEP_VALUES: CutKeep[] = ['both', 'upper', 'lower'];

export const cutRequestSchema = z.looseObject({
  modelId: z.string({ error: () => MODEL_ID }).regex(/^[0-9a-f-]{36}$/i, MODEL_ID),
  transform: z.array(z.number({ error: () => TRANSFORM }), { error: () => TRANSFORM }).length(16, TRANSFORM),
  plane: z.looseObject(
    {
      point: finiteTriple(POINT),
      normal: finiteTriple(NORMAL).refine((v) => Math.hypot(v[0], v[1], v[2]) > 1e-9, NORMAL_DIRECTION),
    },
    { error: () => 'plane required' },
  ),
  keep: z.enum(CUT_KEEP_VALUES as [CutKeep, ...CutKeep[]], { error: () => KEEP }).optional(),
  placeOnCut: z.boolean({ error: () => 'invalid placeOnCut' }).optional(),
  flipUpper: z.boolean({ error: () => 'invalid flipUpper' }).optional(),
});

/** Parse a cut request; `ok: false` carries the message the route answers with (400). */
export function parseCutRequest(body: unknown): { ok: true; request: CutRequest } | { ok: false; message: string } {
  const parsed = cutRequestSchema.safeParse(body ?? {});
  if (!parsed.success) return { ok: false, message: firstIssueMessage(parsed.error, 'invalid cut request') };
  const data = parsed.data;
  return {
    ok: true,
    request: {
      modelId: data.modelId,
      transform: data.transform,
      plane: { point: data.plane.point as [number, number, number], normal: data.plane.normal as [number, number, number] },
      keep: data.keep ?? 'both',
      placeOnCut: data.placeOnCut,
      flipUpper: data.flipUpper,
    },
  };
}
