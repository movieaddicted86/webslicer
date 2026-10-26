/**
 * The printer-safety routes (T-085): the profile of every printer preset, the answer for one preset,
 * and the one-time risk notice.
 *
 * The profile is keyed by the printer preset name (`/api/printer-safety/:preset`), which is what the
 * slice request carries and what the wizard knows the moment the printer exists.
 */
import express from 'express';
import {
  acknowledgeRiskNotice,
  forgetRiskNotice,
  printerSafetyRecord,
  riskNoticeStatus,
  setPrinterSafety,
} from '../services/printerSafety.js';
import { parsePrinterSafety } from '../validation/printerSafety.js';
import { ValidationError } from '../errors.js';
import { sendJson } from './common.js';
import type { PrinterSafetyRecord, RiskNoticeStatus } from '@webslicer/shared';

/** The safety routes of the REST surface. */
export function printerSafetyRouter(): express.Router {
  const r = express.Router();
  const json = express.json({ limit: '64kb' });

  r.get('/printer-safety', async (_req, res) => {
    sendJson<PrinterSafetyRecord>(res, await printerSafetyRecord());
  });

  // one answer; the limit is derived from it (PTFE 240, all-metal 450, "other" the typed number)
  r.put('/printer-safety/:preset', json, async (req, res) => {
    const parsed = parsePrinterSafety(req.body);
    if (!parsed.ok) throw new ValidationError(parsed.message);
    sendJson<PrinterSafetyRecord>(res, await setPrinterSafety(req.params.preset, parsed.profile));
  });

  // "Ask me later": nothing is stored, so the warning keeps showing
  r.delete('/printer-safety/:preset', async (req, res) => {
    sendJson<PrinterSafetyRecord>(res, await setPrinterSafety(req.params.preset, undefined));
  });

  // ---- the one-time risk notice -----------------------------------------
  r.get('/risk-notice', async (_req, res) => {
    sendJson<RiskNoticeStatus>(res, await riskNoticeStatus());
  });

  r.post('/risk-notice/ack', async (_req, res) => {
    sendJson<RiskNoticeStatus>(res, await acknowledgeRiskNotice());
  });

  // the About dialog's "show it again" – it never shows on its own twice per major version
  r.delete('/risk-notice/ack', async (_req, res) => {
    sendJson<RiskNoticeStatus>(res, await forgetRiskNotice());
  });

  return r;
}
