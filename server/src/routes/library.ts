/**
 * File library: a mounted directory with models (STL/OBJ/3MF/AMF), projects (3MF) and G-code.
 * Lets users pick files that were copied in via NAS/SMB without a browser upload, and store
 * projects and sliced G-code next to them.
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getJob, jobOutputPath, build3mfForRequest, mergeConfigs, type SliceRequest } from '../jobs.js';
import { getSchema } from '../slicer/schema.js';
import { loadBundles } from '../slicer/bundles.js';

export const MODEL_EXT = new Set(['.stl', '.obj', '.3mf', '.amf']);
export const GCODE_EXT = new Set(['.gcode', '.bgcode', '.gco', '.g']);

export interface LibraryEntry {
  name: string;
  path: string;
  dir: boolean;
  size?: number;
  mtime?: string;
  kind?: 'model' | 'project' | 'gcode' | 'other';
}

/** Resolve a user supplied relative path inside the library; rejects escapes. */
export function resolveLibraryPath(rel: string | undefined): string {
  const clean = String(rel || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (clean.split('/').some((p) => p === '..')) throw Object.assign(new Error('invalid path'), { status: 400 });
  const abs = path.resolve(config.libraryDir, clean);
  const root = path.resolve(config.libraryDir);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw Object.assign(new Error('invalid path'), { status: 400 });
  return abs;
}

function kindOf(name: string): LibraryEntry['kind'] {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.3mf') return 'project';
  if (MODEL_EXT.has(ext)) return 'model';
  if (GCODE_EXT.has(ext)) return 'gcode';
  return 'other';
}

export function listLibrary(rel: string): { path: string; entries: LibraryEntry[] } {
  const abs = resolveLibraryPath(rel);
  const root = path.resolve(config.libraryDir);
  const relPath = path.relative(root, abs).replace(/\\/g, '/');
  const entries: LibraryEntry[] = [];
  let names: fs.Dirent[] = [];
  try {
    names = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    throw Object.assign(new Error('directory not found'), { status: 404 });
  }
  for (const d of names) {
    if (d.name.startsWith('.')) continue;
    const p = path.join(abs, d.name);
    const relEntry = relPath ? `${relPath}/${d.name}` : d.name;
    if (d.isDirectory()) {
      entries.push({ name: d.name, path: relEntry, dir: true });
    } else if (d.isFile()) {
      let st: fs.Stats | undefined;
      try {
        st = fs.statSync(p);
      } catch {
        continue;
      }
      entries.push({ name: d.name, path: relEntry, dir: false, size: st.size, mtime: st.mtime.toISOString(), kind: kindOf(d.name) });
    }
  }
  entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.dir ? -1 : 1));
  return { path: relPath, entries };
}

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

function safeName(name: string): string {
  const n = path.basename(String(name || '')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
  if (!n || n === '.' || n === '..') throw Object.assign(new Error('invalid name'), { status: 400 });
  return n;
}

export function libraryRouter(): express.Router {
  const r = express.Router();
  const json = express.json({ limit: '64mb' });
  const raw = express.raw({ type: () => true, limit: config.maxUploadBytes });

  r.get('/', (req, res) => {
    res.json({ root: config.libraryDir, ...listLibrary(String(req.query.path || '')) });
  });

  r.get('/file', (req, res) => {
    const abs = resolveLibraryPath(String(req.query.path || ''));
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return res.status(404).json({ error: 'file not found' });
    if (req.query.download !== undefined) res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(path.basename(abs))}"`);
    res.type('application/octet-stream').sendFile(abs);
  });

  // upload from the browser into the library (raw body)
  r.put('/file', raw, (req, res) => {
    const abs = resolveLibraryPath(String(req.query.path || ''));
    const buf = req.body as Buffer;
    if (!buf || !buf.length) return res.status(400).json({ error: 'empty body' });
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buf);
    res.json({ ok: true, path: path.relative(config.libraryDir, abs).replace(/\\/g, '/'), size: buf.length });
  });

  r.post('/mkdir', json, (req, res) => {
    const parent = resolveLibraryPath(String(req.body?.path || ''));
    const abs = path.join(parent, safeName(req.body?.name));
    fs.mkdirSync(abs, { recursive: true });
    res.json({ ok: true, path: path.relative(config.libraryDir, abs).replace(/\\/g, '/') });
  });

  r.delete('/file', (req, res) => {
    const abs = resolveLibraryPath(String(req.query.path || ''));
    if (abs === path.resolve(config.libraryDir)) return res.status(400).json({ error: 'cannot delete the library root' });
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'not found' });
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      if (fs.readdirSync(abs).length) return res.status(400).json({ error: 'directory not empty' });
      fs.rmdirSync(abs);
    } else fs.unlinkSync(abs);
    res.json({ ok: true });
  });

  // save the current plater as a 3MF project into the library
  r.post(
    '/project',
    json,
    asyncHandler(async (req, res) => {
      const dir = resolveLibraryPath(String(req.query.path || ''));
      const name = safeName(String(req.query.name || 'project')).replace(/\.3mf$/i, '') + '.3mf';
      const body = req.body as SliceRequest;
      if (!body?.objects?.length) return res.status(400).json({ error: 'no objects' });
      const schema = await getSchema(loadBundles().keys);
      const merged = mergeConfigs(schema, body, { forProject: true });
      const buf = await build3mfForRequest(body, merged);
      fs.mkdirSync(dir, { recursive: true });
      const abs = path.join(dir, name);
      fs.writeFileSync(abs, buf);
      res.json({ ok: true, path: path.relative(config.libraryDir, abs).replace(/\\/g, '/'), size: buf.length });
    }),
  );

  // copy a job's output (G-code) into the library
  r.post('/gcode', json, (req, res) => {
    const job = getJob(String(req.body?.jobId || ''));
    if (!job || job.status !== 'done') return res.status(404).json({ error: 'job output not available' });
    const dir = resolveLibraryPath(String(req.body?.path || ''));
    const ext = path.extname(job.outputName);
    const name = safeName(String(req.body?.name || job.outputName)).replace(new RegExp(`${ext.replace('.', '\\.')}$`, 'i'), '') + ext;
    fs.mkdirSync(dir, { recursive: true });
    const abs = path.join(dir, name);
    fs.copyFileSync(jobOutputPath(job), abs);
    res.json({ ok: true, path: path.relative(config.libraryDir, abs).replace(/\\/g, '/'), size: fs.statSync(abs).size });
  });

  return r;
}
