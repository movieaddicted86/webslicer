/**
 * REST surface of the file library (`services/library.ts` does the file work).
 *
 * The library is a mounted directory with models (STL/OBJ/3MF/AMF), projects (3MF) and G-code, so
 * users can pick files that were copied in via NAS/SMB without a browser upload and store projects
 * and sliced G-code next to them.
 */
import express from 'express';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { copyJobOutput, libraryProject3mf } from '../services/library.js';
import { libraryGcodeSchema, libraryMkdirSchema, libraryProjectSchema } from '../validation/library.js';
import { firstIssueMessage } from '../validation/common.js';
import {
  deleteLibraryEntry,
  libraryRelativePath,
  libraryTargetChecked,
  listLibrary,
  makeLibraryDir,
  resolveInsideLibrary,
  resolveLibraryFile,
  writeLibraryData,
} from '../services/library.js';
import { receiveToFile } from './uploads.js';

/** The routes of this router are `async` throughout: Express 5 answers a rejected promise itself. */
export function libraryRouter(): express.Router {
  const r = express.Router();
  const json = express.json({ limit: '64mb' });

  r.get('/', async (req, res) => {
    res.json({ root: config.libraryDir, ...(await listLibrary(String(req.query.path || ''))) });
  });

  r.get('/file', async (req, res) => {
    const abs = await resolveLibraryFile(String(req.query.path || ''));
    if (req.query.download !== undefined)
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(path.basename(abs))}"`);
    res.type('application/octet-stream').sendFile(abs);
  });

  // upload from the browser into the library (raw body)
  // S7: streamed to a temp file next to the target, size limit enforced while streaming, then renamed
  r.put('/file', async (req, res) => {
    const target = await resolveInsideLibrary(String(req.query.path || ''));
    const tmp = `${target}.upload-${process.pid}-${Date.now()}`;
    let bytes = 0;
    try {
      bytes = await receiveToFile(req, tmp);
      if (!bytes) return res.status(400).json({ error: 'empty body' });
      await fsp.rename(tmp, target);
    } finally {
      await fsp.rm(tmp, { force: true }).catch(() => undefined);
    }
    res.json({ ok: true, path: libraryRelativePath(target), size: bytes });
  });

  r.post('/mkdir', json, async (req, res) => {
    const body = libraryMkdirSchema.parse(req.body ?? {});
    res.json({ ok: true, ...(await makeLibraryDir(body.path, body.name)) });
  });

  r.delete('/file', async (req, res) => {
    await deleteLibraryEntry(String(req.query.path || ''));
    res.json({ ok: true });
  });

  // save the current plater as a 3MF project into the library
  r.post('/project', json, async (req, res) => {
    const parsed = libraryProjectSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: firstIssueMessage(parsed.error, 'no objects') });
    const buf = await libraryProject3mf(req.body);
    const target = await libraryTargetChecked(String(req.query.path || ''), String(req.query.name || 'project'), '.3mf');
    res.json({ ok: true, ...(await writeLibraryData(target, buf)) });
  });

  // copy a job's output (G-code) into the library
  r.post('/gcode', json, async (req, res) => {
    const body = libraryGcodeSchema.parse(req.body ?? {});
    res.json({ ok: true, ...(await copyJobOutput(body.jobId, body.path, body.name)) });
  });

  return r;
}
