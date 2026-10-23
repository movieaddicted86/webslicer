/**
 * Models: streamed STL upload, reading and deleting a stored model, STEP conversion and the cut tool.
 * The upload bodies are streamed to disk (`./uploads`) – no route buffers a model in RAM.
 */
import express from 'express';
import path from 'node:path';
import { config } from '../config.js';
import { convertStepUpload, cutModel, deleteModel, isStepUpload, saveModelFile } from '../services/models.js';
import { parseCutRequest } from '../validation/cut.js';
import { ValidationError } from '../errors.js';
import { receiveToFile, withReceivedFile } from './uploads.js';
import { badRequest, disconnectSignal, resolveExistingFile, sendJson } from './common.js';
import type { CutResult } from '@webslicer/shared';

/** The model routes of the REST surface. */
export function modelsRouter(): express.Router {
  const r = express.Router();
  const json = express.json({ limit: '64mb' });

  // ---- models --------------------------------------------------------------
  // S7: no `express.raw` here – the body is streamed to a temp file and the size limit is enforced
  // while streaming, so a large upload never sits in RAM (and an oversize one is a 413 right away)
  r.post('/models', async (req, res) => {
    // B11: `decodeURIComponent` throws a URIError on a lone `%` escape, which became a 500
    let filename: string;
    try {
      filename = decodeURIComponent(String(req.header('x-filename') || 'model.stl'));
    } catch {
      return badRequest(res, 'invalid file name');
    }
    const stored = await withReceivedFile(req, config.modelsDir, async (file, bytes) => {
      if (!bytes) throw new ValidationError('empty body');
      try {
        return await saveModelFile(file, filename, bytes);
      } catch (e) {
        if (e instanceof ValidationError) throw e;
        throw new ValidationError(`cannot parse STL: ${(e as Error).message}`);
      }
    });
    res.json(stored);
  });

  // ---- STEP conversion (T-009) --------------------------------------------
  // The CLI reads STEP, the browser cannot: the uploaded file is written to a temp dir, converted to
  // a binary STL and sent back, so the client can take the normal STL path. The file name only
  // decides the format (and has to be .step/.stp: the CLI goes by the extension), the body is raw
  // like `POST /api/models` and streamed to disk with the same size limit.
  r.post('/convert/step', async (req, res) => {
    let filename: string;
    try {
      filename = decodeURIComponent(String(req.header('x-filename') || 'model.step'));
    } catch {
      return badRequest(res, 'invalid file name');
    }
    if (!isStepUpload(filename)) return badRequest(res, `not a STEP file: ${filename}`);
    const stl = await convertStepUpload(filename, (input) => receiveToFile(req, input), disconnectSignal(res));
    res.type('application/octet-stream').send(stl);
  });

  r.get('/models/:id', async (req, res) => {
    // the existence check is what turns a missing model into a 404 before `sendFile` runs
    const f = await resolveExistingFile(path.join(config.modelsDir, `${path.basename(req.params.id)}.stl`));
    if (!f) return res.status(404).json({ error: 'model not found' });
    res.type('application/octet-stream').sendFile(f);
  });

  r.delete('/models/:id', async (req, res) => {
    await deleteModel(path.basename(req.params.id));
    res.json({ ok: true });
  });

  // ---- cut (T-044) ---------------------------------------------------------
  // The CLI does the cutting, so the endpoint receives the model id, the instance transform and the
  // plane only. The parts come back as models of their own, already at their world position (or on
  // the cut face with "place on cut"); a side the plane leaves no material of is absent.
  r.post('/cut', json, async (req, res) => {
    const parsed = parseCutRequest(req.body);
    if (!parsed.ok) return badRequest(res, parsed.message);
    sendJson<CutResult>(res, await cutModel(parsed.request, disconnectSignal(res)));
  });

  return r;
}
