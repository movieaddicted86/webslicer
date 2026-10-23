import express, { type Request, type Response } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { getSlicerVersion } from '../slicer/cli.js';
import { loadBundles, resolveModelAsset } from '../slicer/bundles.js';
import { activeSchema } from '../services/schema.js';
import { appVersion } from '../services/version.js';
import { updateStatus } from '../services/updateCheck.js';
import { deleteModel, saveModel, saveModelFile } from '../services/models.js';
import { deleteAutosave, findAutosave, isAutosaveClientId, readAutosaveInfo, writeAutosave } from '../services/autosave.js';
import { build3mfForRequest, validateConfigLimits, validateSliceRequest } from '../services/slice.js';
import { mergeConfigs } from '../services/configMerge.js';
import {
  listPresets,
  resolvePreset,
  saveUserPreset,
  deleteUserPreset,
  getInstalledPrinters,
  setInstalledPrinters,
  defaultPresetName,
  userPresetExists,
} from '../slicer/presets.js';
import { parseStl, read3mfProject } from '../slicer/threemf/index.js';
import { convertStepFile, createStepTempDir, isStepFile } from '../slicer/step.js';
import { cutMesh } from '../slicer/cut.js';
import { parseCutRequest } from '../validation/cut.js';
import { createJob, getJob, listJobs, subscribe, cancelJob, deleteJob, jobOutputPath, readJobLog } from '../jobs.js';
import { isPresetType, type CutPart, type PhysicalPrinter, type PresetType, type SliceRequest } from '@webslicer/shared';
import { listPrinters, upsertPrinter, deletePrinter, getPrinter, testPrinter } from '../services/printers.js';
import { sendJobOutput } from '../services/sendGate.js';
import { API_KEY_MASK, installedPrintersOf, jobSendSchema, parsePrinter, parsePrinterTest, printerHost } from '../validation/printers.js';
import { presetBodySchema, presetListSchema } from '../validation/presets.js';
import { firstIssueMessage } from '../validation/common.js';
import { ValidationError } from '../errors.js';
import { libraryRouter } from './library.js';
import { projectsRouter } from './projects.js';
import { receiveToFile, withReceivedFile } from './uploads.js';
import type { IniSection } from '../slicer/ini.js';

function badRequest(res: Response, msg: string) {
  res.status(400).json({ error: msg });
}

function presetType(req: Request, res: Response): PresetType | undefined {
  const t = req.params.type as PresetType;
  if (!isPresetType(t)) {
    badRequest(res, `Unknown preset type ${t}`);
    return undefined;
  }
  return t;
}

/**
 * The REST surface.
 *
 * The async handlers are plain `async` functions: Express 5 forwards a rejected promise to the error
 * handler, so the `asyncHandler` wrapper every route used to be passed through is gone (T-023). What
 * the wrapper also did – widen `req.params` values to `string | string[]` – is handled by the router
 * types now, which read a single `:id` as the `string` it is.
 */
export function apiRouter(): express.Router {
  const r = express.Router();
  const json = express.json({ limit: '64mb' });
  const schemaOf = activeSchema;

  r.get('/health', (_req, res) => res.json({ ok: true }));

  r.get('/info', async (_req, res) => {
    const bundles = loadBundles();
    res.json({
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
    res.json(await updateStatus());
  });

  r.get('/schema', async (_req, res) => {
    res.json(await schemaOf());
  });

  // ---- vendors / printer models -----------------------------------------
  r.get('/vendors', (_req, res) => {
    const b = loadBundles();
    res.json(
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

  r.get('/installed-printers', (_req, res) => res.json(getInstalledPrinters()));
  r.put('/installed-printers', json, (req, res) => {
    setInstalledPrinters(installedPrintersOf(req.body));
    res.json(getInstalledPrinters());
  });

  // ---- presets -----------------------------------------------------------
  r.post('/presets/:type/list', json, async (req, res) => {
    const t = presetType(req, res);
    if (!t) return;
    const s = await schemaOf();
    const body = presetListSchema.parse(req.body ?? {});
    let printerConfig = body.printerConfig as IniSection | undefined;
    if (!printerConfig && body.printerName) printerConfig = resolvePreset(s, 'printer', body.printerName)?.config;
    let printConfig = body.printConfig as IniSection | undefined;
    if (!printConfig && body.printName) printConfig = resolvePreset(s, 'print', body.printName)?.config;
    res.json(
      listPresets(s, t, {
        printerName: body.printerName,
        printerConfig,
        printName: body.printName,
        printConfig,
        all: body.all,
      }),
    );
  });

  r.get('/presets/:type/default', async (req, res) => {
    const t = presetType(req, res);
    if (!t) return;
    const s = await schemaOf();
    res.json(resolvePreset(s, t, defaultPresetName(t)));
  });

  r.get('/presets/:type/:name', async (req, res) => {
    const t = presetType(req, res);
    if (!t) return;
    const s = await schemaOf();
    const p = resolvePreset(s, t, req.params.name);
    if (!p) return res.status(404).json({ error: 'preset not found' });
    res.json(p);
  });

  r.put('/presets/:type/:name', json, async (req, res) => {
    const t = presetType(req, res);
    if (!t) return;
    const name = req.params.name.trim();
    if (!name || name.startsWith('-') || name.includes('/') || name.includes('\\')) return badRequest(res, 'invalid preset name');
    const parsed = presetBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return badRequest(res, firstIssueMessage(parsed.error, 'config required'));
    const s = await schemaOf();
    const allowed = new Set(s.presetKeys[t]);
    const cfg: IniSection = {};
    for (const [k, v] of Object.entries(parsed.data.config)) if (allowed.has(k)) cfg[k] = v;
    saveUserPreset(t, name, cfg, parsed.data.inherits);
    res.json(resolvePreset(s, t, name));
  });

  r.delete('/presets/:type/:name', (req, res) => {
    const t = presetType(req, res);
    if (!t) return;
    if (!userPresetExists(t, req.params.name)) return res.status(404).json({ error: 'user preset not found' });
    deleteUserPreset(t, req.params.name);
    res.json({ ok: true });
  });

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
    if (!isStepFile(filename)) return badRequest(res, `not a STEP file: ${filename}`);
    const dir = await createStepTempDir();
    let stl: Buffer;
    try {
      const input = path.join(dir, `input${path.extname(filename).toLowerCase()}`);
      const bytes = await receiveToFile(req, input);
      if (!bytes) throw new ValidationError('empty body');
      stl = await convertStepFile(input, { workDir: dir });
    } finally {
      // the temp directory is gone before the answer goes out: a client sees no state of the conversion
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
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
    const cut = parsed.request;
    const file = await resolveExistingFile(path.join(config.modelsDir, `${path.basename(cut.modelId)}.stl`));
    if (!file) return res.status(404).json({ error: 'model not found' });
    const mesh = parseStl(await fs.readFile(file));
    if (!mesh.indices.length) return badRequest(res, 'cannot cut: the model has no triangles');
    const { parts } = await cutMesh({
      mesh,
      transform: cut.transform,
      point: cut.plane.point,
      normal: cut.plane.normal,
      keep: cut.keep,
      placeOnCut: cut.placeOnCut,
      flipUpper: cut.flipUpper,
    });
    const answer: { upper?: CutPart; lower?: CutPart } = {};
    for (const part of parts) {
      const stored = await saveModel(part.mesh, `cut-${part.side}`);
      answer[part.side] = { modelId: stored.id, name: stored.name, position: part.position };
    }
    res.json(answer);
  });

  // ---- projects (3MF) ----------------------------------------------------
  // A 3MF is read by JSZip, which needs the whole archive; `express.raw` keeps its limit (413).
  const raw = express.raw({ type: () => true, limit: config.maxUploadBytes });
  r.post('/projects/parse', raw, async (req, res) => {
    const buf = req.body as Buffer;
    if (!buf || !buf.length) return badRequest(res, 'empty body');
    try {
      res.json(await read3mfProject(buf));
    } catch (e) {
      badRequest(res, `cannot read 3MF: ${(e as Error).message}`);
    }
  });

  r.post('/export/3mf', json, async (req, res) => {
    const body = req.body as SliceRequest;
    // B11: this used to fall through to the 500 handler; the request is client input, so its
    // validation failure is a 400 carrying the validator's message
    try {
      validateSliceRequest(body);
    } catch (e) {
      return badRequest(res, (e as Error).message);
    }
    const s = await schemaOf();
    const merged = mergeConfigs(s, body, { forProject: true });
    const buf = await build3mfForRequest(body, merged);
    const name = (body.outputName || 'project').replace(/[^A-Za-z0-9._ -]/g, '_') + '.3mf';
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.type('model/3mf').send(buf);
  });

  r.post('/export/config', json, async (req, res) => {
    const body = req.body as SliceRequest;
    // B11: the body was not checked at all – `{}` died on `body.objects` as a 500
    try {
      validateSliceRequest(body);
    } catch (e) {
      return badRequest(res, (e as Error).message);
    }
    const s = await schemaOf();
    const merged = mergeConfigs(s, { ...body, objects: body.objects || [] });
    const { serializeIni } = await import('../slicer/ini.js');
    res.setHeader('Content-Disposition', 'attachment; filename="config.ini"');
    res.type('text/plain').send(serializeIni(merged, 'generated by WebSlicer'));
  });

  // ---- slicing jobs --------------------------------------------------------
  r.post('/slice', json, async (req, res) => {
    const body = req.body as SliceRequest;
    try {
      validateSliceRequest(body);
    } catch (e) {
      return badRequest(res, (e as Error).message);
    }
    // S1-d: a typo in a temperature, a nozzle or the layer height is a 400 with its issues; a soft
    // range only warns and travels with the job
    const configIssues = validateConfigLimits(body);
    const s = await schemaOf();
    const job = await createJob(body, s, configIssues);
    res.status(202).json(job);
  });

  r.get('/jobs', (_req, res) => res.json(listJobs()));

  r.get('/jobs/:id', (req, res) => {
    const j = getJob(req.params.id);
    if (!j) return res.status(404).json({ error: 'job not found' });
    res.json(j);
  });

  r.get('/jobs/:id/events', (req, res) => {
    const j = getJob(req.params.id);
    if (!j) return res.status(404).json({ error: 'job not found' });
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const send = (ev: unknown) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
    send({ type: 'status', job: j });
    if (j.status === 'done' || j.status === 'error' || j.status === 'cancelled') {
      // a cancelled job is a status, not an error – the stream used to replay it as `error`, which the
      // browser showed as "Slicing failed" after a cancel (B6)
      if (j.status === 'cancelled') send({ type: 'status', job: j });
      else send({ type: j.status === 'done' ? 'done' : 'error', job: j, message: j.error });
      res.end();
      return;
    }
    const unsub = subscribe(j.id, (ev) => {
      send(ev);
      if (ev.type === 'done' || ev.type === 'error' || (ev.type === 'status' && ev.job?.status === 'cancelled')) {
        unsub();
        res.end();
      }
    });
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => {
      clearInterval(ping);
      unsub();
    });
  });

  r.get('/jobs/:id/gcode', async (req, res) => {
    const j = getJob(req.params.id);
    if (!j || j.status !== 'done') return res.status(404).json({ error: 'output not available' });
    const f = await resolveExistingFile(jobOutputPath(j));
    if (!f) return res.status(404).json({ error: 'output missing' });
    if (req.query.download !== undefined)
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(j.outputName)}"`);
    res.type(j.outputName.endsWith('.gcode') ? 'text/plain' : 'application/octet-stream').sendFile(f);
  });

  r.get('/jobs/:id/log', async (req, res) => {
    const j = getJob(req.params.id);
    if (!j) return res.status(404).json({ error: 'job not found' });
    res.type('text/plain').send(await readJobLog(j.id));
  });

  r.post('/jobs/:id/cancel', (req, res) => {
    if (!cancelJob(req.params.id)) return res.status(404).json({ error: 'job not cancellable' });
    res.json({ ok: true });
  });

  r.delete('/jobs/:id', async (req, res) => {
    if (!(await deleteJob(req.params.id))) return res.status(404).json({ error: 'job not found' });
    res.json({ ok: true });
  });

  r.post('/jobs/:id/send', json, async (req, res) => {
    const j = getJob(req.params.id);
    if (!j || j.status !== 'done') return res.status(404).json({ error: 'output not available' });
    const parsed = jobSendSchema.safeParse(req.body ?? {});
    if (!parsed.success) return badRequest(res, firstIssueMessage(parsed.error, 'invalid send request'));
    const body = parsed.data;
    const p = body.printerId ? await getPrinter(body.printerId) : undefined;
    if (!p) return badRequest(res, 'printerId required');
    const filename = (body.filename || j.outputName).replace(/[\\/]/g, '_');
    // S1-b: the job's printer preset has to be the one the host is set up for; a block is a 409 with
    // the issues, and only an override with a written reason gets past it (and into the audit log).
    const result = await sendJobOutput({
      job: j,
      printer: p,
      gcodePath: jobOutputPath(j),
      filename,
      startPrint: body.startPrint,
      override: body.override,
      reason: body.reason?.trim(),
    });
    res.status(result.ok ? 200 : 502).json(result);
  });

  // ---- physical printers ---------------------------------------------------
  // The printer store reads its JSON with `fs/promises` (N-7), so these handlers are async now.
  // The bodies are validated by `validation/printers.ts` (R-10), the same schema the MCP tools use.
  r.get('/printers', async (_req, res) => res.json((await listPrinters()).map(maskPrinter)));
  r.post('/printers', json, async (req, res) => {
    const parsed = parsePrinter(req.body);
    if (!parsed.ok) throw new ValidationError(parsed.message);
    res.json(maskPrinter(await upsertPrinter(parsed.printer)));
  });
  r.put('/printers/:id', json, async (req, res) => {
    const existing = await getPrinter(req.params.id);
    if (!existing) return res.status(404).json({ error: 'printer not found' });
    const parsed = parsePrinter(req.body);
    if (!parsed.ok) throw new ValidationError(parsed.message);
    // the mask means "keep the stored key"; an empty key clears it (the store turns `''` into "no key")
    const apiKey = parsed.printer.apiKey === undefined || parsed.printer.apiKey === API_KEY_MASK ? existing.apiKey : parsed.printer.apiKey;
    res.json(maskPrinter(await upsertPrinter({ ...existing, ...parsed.printer, apiKey, id: existing.id })));
  });
  r.delete('/printers/:id', async (req, res) => {
    if (!(await deletePrinter(req.params.id))) return res.status(404).json({ error: 'printer not found' });
    res.json({ ok: true });
  });
  r.post('/printers/:id/test', async (req, res) => {
    const p = await getPrinter(req.params.id);
    if (!p) return res.status(404).json({ error: 'printer not found' });
    res.json(await testPrinter(p));
  });
  r.post('/printers/test', json, async (req, res) => {
    const parsed = parsePrinterTest(req.body);
    if (!parsed.ok) throw new ValidationError(parsed.message);
    res.json(
      await testPrinter({
        id: 'tmp',
        name: 'tmp',
        type: parsed.printer.type || 'octoprint',
        host: printerHost(parsed.printer.host),
        apiKey: parsed.printer.apiKey || undefined,
        ignoreTls: !!parsed.printer.ignoreTls,
      }),
    );
  });

  // ---- file library (mounted directory) ------------------------------------
  r.use('/library', libraryRouter());

  // ---- server-side projects (headless plater, MCP phase 0) ------------------
  // Mounted after `/projects/parse` above, so that 3MF upload keeps its route.
  r.use('/projects', projectsRouter());

  // ---- autosave of the plater (per browser client) -------------------------
  r.put('/autosave/:client', json, async (req, res) => {
    const id = isAutosaveClientId(req.params.client);
    if (!id) return badRequest(res, 'invalid client id');
    const body = req.body as SliceRequest;
    try {
      validateSliceRequest(body);
    } catch (e) {
      return badRequest(res, (e as Error).message);
    }
    const s = await activeSchema();
    const merged = mergeConfigs(s, body, { forProject: true });
    const buf = await build3mfForRequest(body, merged);
    await writeAutosave(id, buf);
    res.json({ ok: true, savedAt: new Date().toISOString(), size: buf.length });
  });
  r.get('/autosave/:client', async (req, res) => {
    const id = isAutosaveClientId(req.params.client);
    if (!id) return badRequest(res, 'invalid client id');
    if (req.query.info !== undefined) {
      const info = await readAutosaveInfo(id);
      if (!info) return res.status(404).json({ error: 'no autosave' });
      return res.json(info);
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
    res.json({ ok: true });
  });

  return r;
}

/**
 * The path, if it exists as a file – `sendFile` would throw ENOENT otherwise, and the routes need to
 * answer 404 with their own message first.
 */
async function resolveExistingFile(file: string): Promise<string | undefined> {
  try {
    return (await fs.stat(file)).isFile() ? file : undefined;
  } catch {
    return undefined;
  }
}

function maskPrinter(p: PhysicalPrinter) {
  return { ...p, apiKey: p.apiKey ? '••••••••' : undefined, hasApiKey: !!p.apiKey };
}
