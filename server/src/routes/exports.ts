/**
 * Exports: parse an uploaded 3MF project and build the two downloads (3MF project, PrusaSlicer
 * config INI). `/projects/parse` is mounted here and has to stay **before** `projectsRouter`, whose
 * `/projects/:id` would otherwise catch it.
 */
import express from 'express';
import { config } from '../config.js';
import { configExport, project3mfExport, readProjectUpload } from '../services/exports.js';
import { sendJson } from './common.js';

/** The export routes of the REST surface. */
export function exportsRouter(): express.Router {
  const r = express.Router();
  const json = express.json({ limit: '64mb' });

  // ---- projects (3MF) ----------------------------------------------------
  // A 3MF is read by JSZip, which needs the whole archive; `express.raw` keeps its limit (413).
  const raw = express.raw({ type: () => true, limit: config.maxUploadBytes });
  r.post('/projects/parse', raw, async (req, res) => {
    sendJson(res, await readProjectUpload(req.body));
  });

  r.post('/export/3mf', json, async (req, res) => {
    const { buf, name } = await project3mfExport(req.body);
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.type('model/3mf').send(buf);
  });

  r.post('/export/config', json, async (req, res) => {
    const ini = await configExport(req.body);
    res.setHeader('Content-Disposition', 'attachment; filename="config.ini"');
    res.type('text/plain').send(ini);
  });

  return r;
}
