/**
 * Meta endpoints: health, build/slicer info, the cached update status, the option schema, the vendor
 * bundles and their assets, the installed printer models, and the vendor profile updates (check,
 * install, revert, install from a file).
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
import { profileUpdater } from '../services/profileUpdate.js';
import { config } from '../config.js';
import { withReceivedFile } from './uploads.js';
import { sendJson } from './common.js';
import type { InstalledPrinter, Schema, ServerInfo, UpdateStatus, VendorUpdateList, VendorUpdateResult } from '@webslicer/shared';

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

  // ---- vendor profile updates -------------------------------------------
  // A check runs at most once a day (or on `?refresh=1`); with `WEBSLICER_UPDATE_CHECK=off` the
  // answer says so and nothing is requested.
  r.get('/vendors/updates', async (req, res) => {
    sendJson<VendorUpdateList>(res, await (await profileUpdater()).list(req.query.refresh === '1'));
  });

  r.post('/vendors/:vendor/update', async (req, res) => {
    sendJson<VendorUpdateResult>(res, await (await profileUpdater()).install(req.params.vendor));
  });

  r.post('/vendors/:vendor/revert', async (req, res) => {
    sendJson<VendorUpdateResult>(res, await (await profileUpdater()).revert(req.params.vendor));
  });

  // the same validation as an online install, for an air-gapped one: the vendor comes from the file
  r.post('/vendors/install', async (req, res) => {
    const updater = await profileUpdater();
    const result = await withReceivedFile(req, config.cacheDir, (file) => updater.installFromFile(file));
    sendJson<VendorUpdateResult>(res, result);
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
