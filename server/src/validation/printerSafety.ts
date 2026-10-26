/**
 * The payloads around the printer-safety profile (T-085): the answer the wizard stores, and the
 * acknowledgement of the risk notice (which carries no fields – it is the fact of the click).
 *
 * The answer is read the way the wizard offers it – PTFE, all-metal or a typed number – and the
 * **limit is derived here**, not trusted from the client: a PTFE hotend is 240 °C, an all-metal one
 * 450 °C, "other" the typed number inside the global window. A record can therefore never claim a
 * wider limit than its answer means.
 */
import { z } from 'zod';
import { ALL_METAL_MAX_HOTEND, HOTEND_TYPES, MAX_BED_LIMIT, OTHER_HOTEND_MAX, OTHER_HOTEND_MIN, PTFE_MAX_HOTEND } from '@webslicer/shared';
import { firstIssueMessage } from './common.js';
import type { HotendType, PrinterSafetyProfile } from '@webslicer/shared';

export const printerSafetySchema = z.object(
  {
    hotendType: z.enum(HOTEND_TYPES as [HotendType, ...HotendType[]], { error: () => 'invalid hotendType' }),
    /** only read for "other": the number the owner typed */
    maxHotend: z
      .number({ error: () => 'invalid maxHotend' })
      .finite('invalid maxHotend')
      .optional(),
    maxBed: z
      .number({ error: () => 'invalid maxBed' })
      .finite('invalid maxBed')
      .min(0, `maxBed must be between 0 and ${MAX_BED_LIMIT} °C`)
      .max(MAX_BED_LIMIT, `maxBed must be between 0 and ${MAX_BED_LIMIT} °C`)
      .optional(),
  },
  { error: () => 'invalid printer safety' },
);

export type PrinterSafetyInput = z.output<typeof printerSafetySchema>;

/**
 * Parse an answer into the profile that is stored, or the message the client shows.
 *
 * An "other" answer needs a number in 150–450 °C; a PTFE/all-metal answer ignores whatever number was
 * sent, so the stored limit always follows the answer. A bed temperature of `0` is "not set".
 */
export function parsePrinterSafety(body: unknown): { ok: true; profile: PrinterSafetyProfile } | { ok: false; message: string } {
  const parsed = printerSafetySchema.safeParse(body);
  if (!parsed.success) return { ok: false, message: firstIssueMessage(parsed.error, 'invalid printer safety') };
  const { hotendType, maxHotend, maxBed } = parsed.data;
  let limit: number;
  if (hotendType === 'ptfe') limit = PTFE_MAX_HOTEND;
  else if (hotendType === 'all-metal') limit = ALL_METAL_MAX_HOTEND;
  else {
    if (maxHotend === undefined || !Number.isFinite(maxHotend) || maxHotend < OTHER_HOTEND_MIN || maxHotend > OTHER_HOTEND_MAX) {
      return { ok: false, message: `maxHotend must be between ${OTHER_HOTEND_MIN} and ${OTHER_HOTEND_MAX} °C for "other"` };
    }
    limit = Math.round(maxHotend);
  }
  return {
    ok: true,
    profile: { hotendType, maxHotend: limit, ...(maxBed !== undefined && maxBed > 0 && { maxBed: Math.round(maxBed) }) },
  };
}
