/**
 * Meta endpoints: health, build/slicer info, the cached update status, the option schema, the vendor
 * bundles and their assets, and the installed printer models.
 */
import express from 'express';
import path from 'node:path';
import { config } from '../config.js';
import { getSlicerVersion } from '../slicer/cli.js';
import { loadBundles, resolveModelAsset } from '../slicer/bundles.js';
import { activeSchema } from '../services/schema.js';
import { appVersion } from '../services/version.js';
import { updateStatus } from '../services/updateCheck.js';
import { getInstalledPrinters, setInstalledPrinters } from '../slicer/presets.js';
import { installedPrintersOf } from '../validation/printers.js';
import { sendJson } from './common.js';
import type { InstalledPrinter, ServerInfo, UpdateStatus, Vendor } from '@webslicer/shared';

/** The vendor list as `/api/vendors` hands it out – the bundle file stays server-side bookkeeping. */
export type VendorListEntry = Omit<Vendor, 'file'>;

/** The meta routes of the REST surface. */
export function metaRouter(): express.Router {
  const r = express.Router();
  const json = express.json({ limit: '64mb' });

  r.get('/health', (_req, res) => res.json({ ok: true }));

  r.get('/info', async (_req, res) => {
    const bundles = loadBundles();
    sendJson<ServerInfo>(res, {
      version: await appVersion(),
      slicerVersion: await getSlicerVersion(),
      slicerBin: config.slicerBin,
      resourcesDir: bundles.resourcesDir,
      vendors: bundles.vendors.length,
      maxJobs: config.maxJobs,
      maxUploadBytes: config.maxUploadBytes,
    });
  });

  // T-058: the server's answer to "has the repository moved on?" – cached, never blocks, silent on failure
  r.get('/update-status', async (_req, res) => {
    sendJson<UpdateStatus>(res, await updateStatus());
  });

  r.get('/schema', async (_req, res) => {
    res.json(await activeSchema());
  });

  // ---- vendors / printer models -----------------------------------------
  r.get('/vendors', (_req, res) => {
    const b = loadBundles();
    sendJson<VendorListEntry[]>(
      res,
      b.vendors.map((v) => ({
        id: v.id,
        name: v.name,
        configVersion: v.configVersion,
        models: v.models,
      })),
    );
  });

  r.get('/vendors/:vendor/asset/:file', (req, res) => {
    const file = path.basename(req.params.file);
    const p = resolveModelAsset(path.basename(req.params.vendor), file);
    if (!p) return res.status(404).json({ error: 'asset not found' });
    res.sendFile(p);
  });

  r.get('/installed-printers', (_req, res) => sendJson<InstalledPrinter[]>(res, getInstalledPrinters()));
  r.put('/installed-printers', json, (req, res) => {
    setInstalledPrinters(installedPrintersOf(req.body));
    sendJson<InstalledPrinter[]>(res, getInstalledPrinters());
  });

  return r;
}
