/**
 * Physical-printer payloads as zod schemas (R-10).
 *
 * The field set is `PhysicalPrinter` from `@webslicer/shared`; the schema says which of those fields a
 * client may send and how they are read. It exists once, for the routes that create, update and test a
 * printer, instead of the three `String(body.host || '')`-style reads they had.
 *
 * Two deliberate limits, both to keep the API what it was:
 *
 * - **No new requirements.** The store has always tolerated a missing host or name (it falls back to
 *   the host, then `'Printer'`), and `POST /api/printers`/`POST /api/printers/test` are reachable
 *   without a body. The schema therefore checks *types*, not presence – a body that stores a useless
 *   printer still stores it, exactly as before.
 * - **Only the fields a client owns.** Everything else of a stored record is the store's business.
 */
import { z } from 'zod';
import { firstIssueMessage } from './common.js';
import type { HostType } from '@webslicer/shared';

/** Every print host the server can talk to. */
export const HOST_TYPES: HostType[] = ['octoprint', 'moonraker', 'prusalink'];

/** The stored API-key mask; sending it back means "keep the stored key". */
export const API_KEY_MASK = '••••••••';

const host = z
  .string({ error: () => 'invalid host' })
  .max(500, 'invalid host')
  .optional();
const name = z
  .string({ error: () => 'invalid printer name' })
  .max(200, 'invalid printer name')
  .optional();
const type = z
  .enum(HOST_TYPES, { error: (iss) => `invalid printer type ${String((iss as unknown as { input: unknown }).input)}` })
  .optional();
const apiKey = z
  .string({ error: () => 'invalid API key' })
  .max(500, 'invalid API key')
  .optional();

/**
 * The safety limits of the machine (S1-d): the hottest hotend and bed the target printer may see.
 *
 * Both are optional and a limit of `0` or less means "not set" – the same way PrusaSlicer reads a
 * temperature of 0 as off. A value above the global catcher (450 °C hotend, 150 °C bed) is itself a
 * typo, so the schema refuses it rather than letting it disable the send gate.
 */
const safetyLimit = (max: number, label: string) =>
  z
    .number({ error: () => `invalid ${label}` })
    .finite(`invalid ${label}`)
    .max(max, `${label} must be at most ${max} °C`)
    .optional();

const safety = z
  .object(
    {
      maxHotend: safetyLimit(450, 'maxHotend'),
      maxBed: safetyLimit(150, 'maxBed'),
    },
    { error: () => 'invalid safety' },
  )
  .optional();

/** A printer as the client sends it. */
export const printerInputSchema = z.looseObject({
  id: z
    .string({ error: () => 'invalid printer id' })
    .max(100, 'invalid printer id')
    .optional(),
  name,
  type,
  host,
  apiKey,
  presetName: z
    .string({ error: () => 'invalid preset name' })
    .max(200, 'invalid preset name')
    .optional(),
  ignoreTls: z.boolean({ error: () => 'invalid ignoreTls' }).optional(),
  safety,
});

/** `POST /api/printers/test` takes the same fields, minus the ones only a stored printer has. */
export const printerTestSchema = z.looseObject({
  host,
  type,
  apiKey,
  ignoreTls: z.boolean({ error: () => 'invalid ignoreTls' }).optional(),
});

export type PrinterInput = z.output<typeof printerInputSchema>;

/** Parse a printer body; the first issue's message is the one the client shows. */
export function parsePrinter(body: unknown): { ok: true; printer: PrinterInput } | { ok: false; message: string } {
  const parsed = printerInputSchema.safeParse(body ?? {});
  if (!parsed.success) return { ok: false, message: firstIssueMessage(parsed.error, 'invalid printer') };
  return { ok: true, printer: parsed.data };
}

/** Parse a `POST /api/printers/test` body. */
export function parsePrinterTest(body: unknown): { ok: true; printer: PrinterInput } | { ok: false; message: string } {
  const parsed = printerTestSchema.safeParse(body ?? {});
  if (!parsed.success) return { ok: false, message: firstIssueMessage(parsed.error, 'invalid printer') };
  return { ok: true, printer: parsed.data };
}

/**
 * The host of a printer as the client means it: a scheme is added when it is missing, trailing slashes
 * go. (The network path stays part of the host, as before – the routes under it are appended.)
 */
export function printerHost(value: string | undefined): string {
  const host = String(value || '')
    .trim()
    .replace(/\/+$/, '');
  return /^https?:\/\//i.test(host) ? host : `http://${host}`;
}

/**
 * The body of `POST /api/jobs/:id/send`: which printer the output goes to, under which name, whether
 * the print starts right away, and – when the send gate blocked the upload – the override.
 *
 * `printerId` is only usable when it is a string – anything else means "no printer", which the route
 * answers with its 400. A `filename` that is not a string falls back to the output name of the job
 * (the old code called `.replace` on it and crashed with a 500). A field of the wrong type is *dropped*
 * rather than kept as `undefined`, so the parsed body only carries what the route can use.
 *
 * The override (S1-b) is `override: true` plus a written `reason` – a string, non-empty after
 * trimming, at most 500 characters. The reason is required as soon as `override` is set: an override
 * nobody had to explain is not an audit entry.
 */
export const OVERRIDE_REASON_MAX = 500;

export const jobSendSchema = z.preprocess(
  (v) => {
    const body = (v && typeof v === 'object' ? { ...(v as Record<string, unknown>) } : {}) as Record<string, unknown>;
    for (const key of ['printerId', 'filename', 'reason'] as const) if (key in body && typeof body[key] !== 'string') delete body[key];
    // `override` is a flag: the booleans and the forms a form or a script sends; anything else drops
    if ('override' in body) {
      const flag = body.override;
      if (flag === true || flag === 'true' || flag === 1 || flag === '1') body.override = true;
      else delete body.override;
    }
    return body;
  },
  z
    .looseObject({
      printerId: z.string().optional(),
      filename: z.string().optional(),
      startPrint: z
        .unknown()
        .optional()
        .transform((v) => !!v),
      override: z.boolean().optional(),
      reason: z.string().max(OVERRIDE_REASON_MAX, `invalid override reason (at most ${OVERRIDE_REASON_MAX} characters)`).optional(),
    })
    .superRefine((body, ctx) => {
      if (!body.override) return;
      if (!body.reason?.trim()) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'an override needs a reason' });
    }),
);

/** One entry of the installed-printer list (`PUT /api/installed-printers`). */
const installedPrinterSchema = z.object({
  vendorId: z.string({ error: () => 'vendorId required' }),
  modelId: z.string({ error: () => 'modelId required' }),
  variant: z.unknown().optional(),
});

/**
 * The list of installed printer models.
 *
 * The route tolerated anything that was not an array (it installed nothing) and skipped single entries
 * without a vendor and model – both preserved here, so one bad entry does not drop the others.
 */
export function installedPrintersOf(body: unknown): Array<{ vendorId: string; modelId: string; variant: string }> {
  const list = Array.isArray(body) ? body : [];
  const out: Array<{ vendorId: string; modelId: string; variant: string }> = [];
  for (const entry of list) {
    const parsed = installedPrinterSchema.safeParse(entry);
    if (!parsed.success) continue;
    out.push({ vendorId: parsed.data.vendorId, modelId: parsed.data.modelId, variant: String(parsed.data.variant ?? '') });
  }
  return out;
}
