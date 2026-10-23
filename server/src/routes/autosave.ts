/**
 * The autosave slot of the plater (per browser client): write the current plater as a 3MF, read it
 * back (or only its metadata) and delete it.
 */
import express from 'express';
import { buildAutosave, deleteAutosave, findAutosave, isAutosaveClientId, readAutosaveInfo, writeAutosave } from '../services/autosave.js';
import { badRequest, sendJson } from './common.js';

/** The autosave routes of the REST surface. */
export function autosaveRouter(): express.Router {
  const r = express.Router();
  const json = express.json({ limit: '64mb' });

  r.put('/autosave/:client', json, async (req, res) => {
    const id = isAutosaveClientId(req.params.client);
    if (!id) return badRequest(res, 'invalid client id');
    const buf = await buildAutosave(req.body);
    await writeAutosave(id, buf);
    sendJson<{ ok: true; savedAt: string; size: number }>(res, { ok: true, savedAt: new Date().toISOString(), size: buf.length });
  });
  r.get('/autosave/:client', async (req, res) => {
    const id = isAutosaveClientId(req.params.client);
    if (!id) return badRequest(res, 'invalid client id');
    if (req.query.info !== undefined) {
      const info = await readAutosaveInfo(id);
      if (!info) return res.status(404).json({ error: 'no autosave' });
      return sendJson<{ savedAt: string; size: number }>(res, info);
    }
    const saved = await findAutosave(id);
    if (!saved) return res.status(404).json({ error: 'no autosave' });
    res.setHeader('X-Saved-At', saved.savedAt);
    res.type('model/3mf').sendFile(saved.file);
  });
  r.delete('/autosave/:client', async (req, res) => {
    const id = isAutosaveClientId(req.params.client);
    if (!id) return badRequest(res, 'invalid client id');
    await deleteAutosave(id);
    sendJson(res, { ok: true });
  });

  return r;
}
