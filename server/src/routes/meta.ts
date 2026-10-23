/**
 * Meta endpoints: health, build/slicer info, the cached update status, the option schema, the vendor
 * bundles and their assets, and the installed printer models.
 */
import express from 'express';
import {
  installedPrinters,
  optionSchema,
  replaceInstalledPrinters,
  serverInfo,
  updateInfo,
  vendorAsset,
  vendorList,
} from '../services/meta.js';
import { sendJson } from './common.js';
import type { InstalledPrinter, Schema, ServerInfo, UpdateStatus } from '@webslicer/shared';

/** The meta routes of the REST surface. */
export function metaRouter(): express.Router {
  const r = express.Router();
  const json = express.json({ limit: '64mb' });

  r.get('/health', (_req, res) => sendJson<{ ok: true }>(res, { ok: true }));

  r.get('/info', async (_req, res) => {
    sendJson<ServerInfo>(res, await serverInfo());
  });

  // T-058: the server's answer to "has the repository moved on?" – cached, never blocks, silent on failure
  r.get('/update-status', async (_req, res) => {
    sendJson<UpdateStatus>(res, await updateInfo());
  });

  r.get('/schema', async (_req, res) => {
    sendJson<Schema>(res, await optionSchema());
  });

  // ---- vendors / printer models -----------------------------------------
  r.get('/vendors', (_req, res) => {
    sendJson(res, vendorList());
  });

  r.get('/vendors/:vendor/asset/:file', (req, res) => {
    const p = vendorAsset(req.params.vendor, req.params.file);
    if (!p) return res.status(404).json({ error: 'asset not found' });
    res.sendFile(p);
  });

  r.get('/installed-printers', (_req, res) => sendJson<InstalledPrinter[]>(res, installedPrinters()));
  r.put('/installed-printers', json, (req, res) => {
    sendJson<InstalledPrinter[]>(res, replaceInstalledPrinters(req.body));
  });

  return r;
}
