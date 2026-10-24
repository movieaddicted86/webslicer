import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { PRESET_TYPES } from '@webslicer/shared';
import { envIntegerAtLeast } from './env.js';

function firstExisting(candidates: string[]): string | undefined {
  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

const dataDir = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));

const slicerBin =
  process.env.PRUSASLICER_BIN ||
  firstExisting([
    '/opt/prusaslicer/AppRun',
    '/opt/prusaslicer/usr/bin/prusa-slicer',
    '/usr/bin/prusa-slicer',
    '/usr/local/bin/prusa-slicer',
    'C:\\Program Files\\Prusa3D\\PrusaSlicer\\prusa-slicer-console.exe',
    '/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer',
  ]) ||
  'prusa-slicer';

function resolveResources(bin: string): string | undefined {
  if (process.env.PRUSASLICER_RESOURCES) return process.env.PRUSASLICER_RESOURCES;
  const binDir = path.dirname(bin);
  return firstExisting([
    path.join(binDir, 'usr', 'resources'),
    path.join(binDir, 'usr', 'bin', 'resources'),
    path.join(binDir, 'usr', 'share', 'PrusaSlicer'),
    path.join(binDir, 'resources'),
    path.join(binDir, '..', 'resources'),
    path.join(binDir, '..', 'share', 'PrusaSlicer'),
    path.join(binDir, '..', 'Resources'),
    '/usr/share/PrusaSlicer',
    '/usr/share/prusa-slicer',
  ]);
}

export const config = {
  // W5: a typo in an environment number is a logged warning and the default, never NaN
  port: envIntegerAtLeast('PORT', 0, 8080),
  host: process.env.HOST || '0.0.0.0',
  /** host names and IPs (with or without port) a request may name in `Host`/`Origin` (SEC-2) */
  allowedHosts: String(process.env.ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
  dataDir,
  modelsDir: path.join(dataDir, 'models'),
  jobsDir: path.join(dataDir, 'jobs'),
  presetsDir: path.join(dataDir, 'presets'),
  projectsDir: path.join(dataDir, 'projects'),
  cacheDir: path.join(dataDir, 'cache'),
  autosaveDir: path.join(dataDir, 'autosave'),
  /** MCP bearer tokens (hashes) and the audit log of the MCP endpoint */
  mcpTokensFile: path.join(dataDir, 'mcp-tokens.json'),
  auditLog: path.join(dataDir, 'audit.log'),
  /** T-058: the last observation of the update check (kept across restarts) */
  updateStatusFile: path.join(dataDir, 'update-status.json'),
  /** the last observation of the vendor profile check (installed → available versions) */
  vendorUpdatesFile: path.join(dataDir, 'vendor-updates.json'),
  /** T-058: the branch this build follows (`GIT_BRANCH` build arg), `main` by default */
  gitBranch: process.env.GIT_BRANCH || 'main',
  /** T-058: the raw `WEBSLICER_UPDATE_CHECK` value; `off` disables every outbound call */
  updateCheck: process.env.WEBSLICER_UPDATE_CHECK,
  /** model / project / G-code library, meant to be mounted (NAS, SMB, …) */
  libraryDir: path.resolve(process.env.LIBRARY_DIR || path.join(dataDir, 'library')),
  slicerBin,
  slicerResources: resolveResources(slicerBin),
  webDist: process.env.WEB_DIST || path.resolve(process.cwd(), 'web', 'dist'),
  maxJobs: envIntegerAtLeast('MAX_JOBS', 1, Math.min(2, os.cpus().length)),
  /** q2-slicer-cli: how many PrusaSlicer processes may run at once across jobs, STEP and cut */
  maxCliProcesses: envIntegerAtLeast('MAX_CLI_PROCESSES', 1, envIntegerAtLeast('MAX_JOBS', 1, Math.min(2, os.cpus().length))),
  maxUploadBytes: envIntegerAtLeast('MAX_UPLOAD_BYTES', 1, 500 * 1024 * 1024),
  jobRetention: envIntegerAtLeast('JOB_RETENTION', 0, 50),
};

export function ensureDirs() {
  for (const d of [
    config.dataDir,
    config.modelsDir,
    config.jobsDir,
    config.presetsDir,
    config.projectsDir,
    config.cacheDir,
    config.autosaveDir,
    config.libraryDir,
  ]) {
    fs.mkdirSync(d, { recursive: true });
  }
  for (const t of PRESET_TYPES) {
    fs.mkdirSync(path.join(config.presetsDir, t), { recursive: true });
  }
}
