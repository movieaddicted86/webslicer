/**
 * Physical printers: list, create, update, delete and test a print host. The API key never goes back
 * to the client – it is replaced by the mask, and sending the mask back means "keep the stored key".
 */
import express from 'express';
import { listPrinters, upsertPrinter, deletePrinter, getPrinter, testPrinter } from '../services/printers.js';
import { API_KEY_MASK, parsePrinter, parsePrinterTest, printerHost } from '../validation/printers.js';
import { ValidationError } from '../errors.js';
import { sendJson } from './common.js';
import type { PhysicalPrinter } from '@webslicer/shared';

function maskPrinter(p: PhysicalPrinter): PhysicalPrinter {
  return { ...p, apiKey: p.apiKey ? API_KEY_MASK : undefined, hasApiKey: !!p.apiKey };
}

/** The printer routes of the REST surface. */
export function printersRouter(): express.Router {
  const r = express.Router();
  const json = express.json({ limit: '64mb' });

  // ---- physical printers ---------------------------------------------------
  // The printer store reads its JSON with `fs/promises` (N-7), so these handlers are async now.
  // The bodies are validated by `validation/printers.ts` (R-10), the same schema the MCP tools use.
  r.get('/printers', async (_req, res) => sendJson<PhysicalPrinter[]>(res, (await listPrinters()).map(maskPrinter)));
  r.post('/printers', json, async (req, res) => {
    const parsed = parsePrinter(req.body);
    if (!parsed.ok) throw new ValidationError(parsed.message);
    sendJson<PhysicalPrinter>(res, maskPrinter(await upsertPrinter(parsed.printer)));
  });
  r.put('/printers/:id', json, async (req, res) => {
    const existing = await getPrinter(req.params.id);
    if (!existing) return res.status(404).json({ error: 'printer not found' });
    const parsed = parsePrinter(req.body);
    if (!parsed.ok) throw new ValidationError(parsed.message);
    // the mask means "keep the stored key"; an empty key clears it (the store turns `''` into "no key")
    const apiKey = parsed.printer.apiKey === undefined || parsed.printer.apiKey === API_KEY_MASK ? existing.apiKey : parsed.printer.apiKey;
    sendJson<PhysicalPrinter>(res, maskPrinter(await upsertPrinter({ ...existing, ...parsed.printer, apiKey, id: existing.id })));
  });
  r.delete('/printers/:id', async (req, res) => {
    if (!(await deletePrinter(req.params.id))) return res.status(404).json({ error: 'printer not found' });
    res.json({ ok: true });
  });
  r.post('/printers/:id/test', async (req, res) => {
    const p = await getPrinter(req.params.id);
    if (!p) return res.status(404).json({ error: 'printer not found' });
    sendJson<Awaited<ReturnType<typeof testPrinter>>>(res, await testPrinter(p));
  });
  r.post('/printers/test', json, async (req, res) => {
    const parsed = parsePrinterTest(req.body);
    if (!parsed.ok) throw new ValidationError(parsed.message);
    sendJson<Awaited<ReturnType<typeof testPrinter>>>(
      res,
      await testPrinter({
        id: 'tmp',
        name: 'tmp',
        type: parsed.printer.type || 'octoprint',
        host: printerHost(parsed.printer.host),
        apiKey: parsed.printer.apiKey || undefined,
        ignoreTls: !!parsed.printer.ignoreTls,
      }),
    );
  });

  return r;
}
