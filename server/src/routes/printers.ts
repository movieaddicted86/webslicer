/**
 * Physical printers: list, create, update, delete and test a print host. The API key never goes back
 * to the client – `services/printers.ts` masks it, and sending the mask back means "keep the key".
 */
import express from 'express';
import {
  createPrinter,
  deletePrinter,
  getPrinter,
  listPrinterViews,
  testPrinter,
  testPrinterInput,
  updatePrinter,
} from '../services/printers.js';
import { parsePrinter, parsePrinterTest } from '../validation/printers.js';
import { ValidationError } from '../errors.js';
import { sendJson } from './common.js';
import type { PhysicalPrinter } from '@webslicer/shared';

/** The printer routes of the REST surface. */
export function printersRouter(): express.Router {
  const r = express.Router();
  const json = express.json({ limit: '64mb' });

  // ---- physical printers ---------------------------------------------------
  // The printer store reads its JSON with `fs/promises` (N-7), so these handlers are async now.
  // The bodies are validated by `validation/printers.ts` (R-10), the same schema the MCP tools use.
  r.get('/printers', async (_req, res) => sendJson<PhysicalPrinter[]>(res, await listPrinterViews()));
  r.post('/printers', json, async (req, res) => {
    const parsed = parsePrinter(req.body);
    if (!parsed.ok) throw new ValidationError(parsed.message);
    sendJson<PhysicalPrinter>(res, await createPrinter(parsed.printer));
  });
  r.put('/printers/:id', json, async (req, res) => {
    if (!(await getPrinter(req.params.id))) return res.status(404).json({ error: 'printer not found' });
    const parsed = parsePrinter(req.body);
    if (!parsed.ok) throw new ValidationError(parsed.message);
    const updated = await updatePrinter(req.params.id, parsed.printer);
    if (!updated) return res.status(404).json({ error: 'printer not found' });
    sendJson<PhysicalPrinter>(res, updated);
  });
  r.delete('/printers/:id', async (req, res) => {
    if (!(await deletePrinter(req.params.id))) return res.status(404).json({ error: 'printer not found' });
    sendJson(res, { ok: true });
  });
  r.post('/printers/:id/test', async (req, res) => {
    const p = await getPrinter(req.params.id);
    if (!p) return res.status(404).json({ error: 'printer not found' });
    sendJson<Awaited<ReturnType<typeof testPrinter>>>(res, await testPrinter(p));
  });
  r.post('/printers/test', json, async (req, res) => {
    const parsed = parsePrinterTest(req.body);
    if (!parsed.ok) throw new ValidationError(parsed.message);
    sendJson<Awaited<ReturnType<typeof testPrinter>>>(res, await testPrinterInput(parsed.printer));
  });

  return r;
}
