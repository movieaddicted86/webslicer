import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

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
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || '0.0.0.0',
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
  /** model / project / G-code library, meant to be mounted (NAS, SMB, …) */
  libraryDir: path.resolve(process.env.LIBRARY_DIR || path.join(dataDir, 'library')),
  slicerBin,
  slicerResources: resolveResources(slicerBin),
  webDist: process.env.WEB_DIST || path.resolve(process.cwd(), 'web', 'dist'),
  maxJobs: Math.max(1, Number(process.env.MAX_JOBS || Math.min(2, os.cpus().length))),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 500 * 1024 * 1024),
  jobRetention: Number(process.env.JOB_RETENTION || 50),
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
  for (const t of ['print', 'filament', 'printer', 'sla_print', 'sla_material']) {
    fs.mkdirSync(path.join(config.presetsDir, t), { recursive: true });
  }
}
