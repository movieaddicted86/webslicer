/**
 * Shared pieces of the server payload schemas (R-10).
 *
 * `stage` is what makes the rule *order* expressible: the schemas chain their rule groups with
 * `.pipe()`, and a stage reports its issues only when the stage before it passed. That reproduces the
 * "throw at the first failure" of the hand-written checks the schemas replace, whose first message is
 * what the API shows.
 */
import { z } from 'zod';

/**
 * Chain rule groups of one payload so that a group reports its issues only when the group before it
 * passed – the "throw at the first failure" of the hand-written checks the schemas replace.
 *
 * The cast is the price of zod's structural pipe types: the payloads are `looseObject`s and the
 * services read the raw body afterwards, so the parsed type of a stage is of no interest here.
 */
export function ordered(...stages: z.ZodType[]): z.ZodType<unknown> {
  let chained = stages[0];
  for (const next of stages.slice(1)) chained = chained.pipe(next as never);
  return chained as z.ZodType<unknown>;
}

/**
 * A single schema as an untyped pipe stage – for the cases where only one more rule group follows and
 * the structural pipe types of zod would reject it.
 */
export function stage(schema: z.ZodType): z.ZodType<unknown> {
  return schema as unknown as z.ZodType<unknown>;
}

/** The message of the first issue – the one the API shows. */
export function firstIssueMessage(error: z.ZodError, fallback: string): string {
  return error.issues[0]?.message || fallback;
}
