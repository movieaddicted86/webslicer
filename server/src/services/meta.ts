/**
 * Meta use cases: build/slicer info, the update notice, the option schema, the vendor bundles and
 * their assets, and the installed printer models. No Express types – the meta routes only respond.
 */
import path from 'node:path';
import { config } from '../config.js';
import { getSlicerVersion } from '../slicer/cli.js';
import { loadBundles, resolveModelAsset } from '../slicer/bundles.js';
import { activeSchema } from './schema.js';
import { appVersion } from './version.js';
import { updateStatus } from './updateCheck.js';
import { getInstalledPrinters, setInstalledPrinters } from '../slicer/presets.js';
import { installedPrintersOf } from '../validation/printers.js';
import type { InstalledPrinter, Schema, ServerInfo, UpdateStatus, Vendor } from '@webslicer/shared';

/** The vendor list as `/api/vendors` hands it out – the bundle file stays server-side bookkeeping. */
export type VendorListEntry = Omit<Vendor, 'file'>;

/** What `GET /api/info` answers. */
export async function serverInfo(): Promise<ServerInfo> {
  const bundles = loadBundles();
  return {
    version: await appVersion(),
    slicerVersion: await getSlicerVersion(),
    slicerBin: config.slicerBin,
    resourcesDir: bundles.resourcesDir,
    vendors: bundles.vendors.length,
    maxJobs: config.maxJobs,
    maxUploadBytes: config.maxUploadBytes,
  };
}

/** What `GET /api/update-status` answers (cached, never blocks, silent on failure). */
export async function updateInfo(): Promise<UpdateStatus> {
  return updateStatus();
}

/** The option schema, built on first use from the installed slicer. */
export async function optionSchema(): Promise<Schema> {
  return activeSchema();
}

/** The vendor bundles without the server-side bundle file. */
export function vendorList(): VendorListEntry[] {
  return loadBundles().vendors.map((v) => ({
    id: v.id,
    name: v.name,
    configVersion: v.configVersion,
    models: v.models,
  }));
}

/** The path of a bundle asset, or undefined when the vendor or file is unknown. */
export function vendorAsset(vendor: string, file: string): string | undefined {
  return resolveModelAsset(path.basename(vendor), path.basename(file));
}

/** The installed printer models. */
export function installedPrinters(): InstalledPrinter[] {
  return getInstalledPrinters();
}

/** Replace the installed printer models from a raw request body; the body is validated here. */
export function replaceInstalledPrinters(body: unknown): InstalledPrinter[] {
  setInstalledPrinters(installedPrintersOf(body));
  return getInstalledPrinters();
}
