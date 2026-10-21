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

const host = z.string({ error: () => 'invalid host' }).max(500, 'invalid host').optional();
const name = z.string({ error: () => 'invalid printer name' }).max(200, 'invalid printer name').optional();
const type = z.enum(HOST_TYPES, { error: (iss) => `invalid printer type ${String((iss as unknown as { input: unknown }).input)}` }).optional();
const apiKey = z.string({ error: () => 'invalid API key' }).max(500, 'invalid API key').optional();

/** A printer as the client sends it. */
export const printerInputSchema = z.looseObject({
  id: z.string({ error: () => 'invalid printer id' }).max(100, 'invalid printer id').optional(),
  name,
  type,
  host,
  apiKey,
  presetName: z.string({ error: () => 'invalid preset name' }).max(200, 'invalid preset name').optional(),
  ignoreTls: z.boolean({ error: () => 'invalid ignoreTls' }).optional(),
});

/** `POST /api/printers/test` takes the same fields, minus the ones only a stored printer has. */
export const printerTestSchema = z.looseObject({ host, type, apiKey, ignoreTls: z.boolean({ error: () => 'invalid ignoreTls' }).optional() });

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
 * the print starts right away.
 *
 * `printerId` is only usable when it is a string – anything else means "no printer", which the route
 * answers with its 400. A `filename` that is not a string falls back to the output name of the job
 * (the old code called `.replace` on it and crashed with a 500).
 */
export const jobSendSchema = z.looseObject({
  printerId: z
    .unknown()
    .optional()
    .transform((v) => (typeof v === 'string' ? v : undefined)),
  filename: z
    .unknown()
    .optional()
    .transform((v) => (typeof v === 'string' ? v : undefined)),
  startPrint: z
    .unknown()
    .optional()
    .transform((v) => !!v),
});

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
