import express, { type Request, type Response, type NextFunction } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { getSlicerVersion } from '../slicer/cli.js';
import { loadBundles, resolveModelAsset } from '../slicer/bundles.js';
import { activeSchema } from '../services/schema.js';
import { appVersion } from '../services/version.js';
import { deleteModel, saveModel } from '../services/models.js';
import { deleteAutosave, findAutosave, isAutosaveClientId, readAutosaveInfo, writeAutosave } from '../services/autosave.js';
import { build3mfForRequest, validateSliceRequest } from '../services/slice.js';
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
import { parseStl, read3mfProject } from '../slicer/threemf.js';
import { createJob, getJob, listJobs, subscribe, cancelJob, deleteJob, jobOutputPath, readJobLog } from '../jobs.js';
import type { PresetType, SliceRequest } from '@webslicer/shared';
import { listPrinters, upsertPrinter, deletePrinter, getPrinter, testPrinter, uploadToPrinter } from '../services/printers.js';
import { libraryRouter } from './library.js';
import { projectsRouter } from './projects.js';
import type { IniSection } from '../slicer/ini.js';

const PRESET_TYPES: PresetType[] = ['print', 'filament', 'printer', 'sla_print', 'sla_material'];

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

function badRequest(res: Response, msg: string) {
  res.status(400).json({ error: msg });
}

function presetType(req: Request, res: Response): PresetType | undefined {
  const t = req.params.type as PresetType;
  if (!PRESET_TYPES.includes(t)) {
    badRequest(res, `Unknown preset type ${t}`);
    return undefined;
  }
  return t;
}

export function apiRouter(): express.Router {
  const r = express.Router();
  const json = express.json({ limit: '64mb' });
  const schemaOf = activeSchema;

  r.get('/health', (_req, res) => res.json({ ok: true }));

  r.get(
    '/info',
    asyncHandler(async (_req, res) => {
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
    }),
  );

  r.get(
    '/schema',
    asyncHandler(async (_req, res) => {
      res.json(await schemaOf());
    }),
  );

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
    const list = Array.isArray(req.body) ? req.body : [];
    setInstalledPrinters(
      list
        .filter((x: Record<string, unknown>) => x && typeof x.vendorId === 'string' && typeof x.modelId === 'string')
        .map((x: Record<string, string>) => ({ vendorId: x.vendorId, modelId: x.modelId, variant: String(x.variant ?? '') })),
    );
    res.json(getInstalledPrinters());
  });

  // ---- presets -----------------------------------------------------------
  r.post(
    '/presets/:type/list',
    json,
    asyncHandler(async (req, res) => {
      const t = presetType(req, res);
      if (!t) return;
      const s = await schemaOf();
      const body = (req.body || {}) as {
        printerName?: string;
        printerConfig?: IniSection;
        printName?: string;
        printConfig?: IniSection;
        all?: boolean;
      };
      let printerConfig = body.printerConfig;
      if (!printerConfig && body.printerName) printerConfig = resolvePreset(s, 'printer', body.printerName)?.config;
      let printConfig = body.printConfig;
      if (!printConfig && body.printName) printConfig = resolvePreset(s, 'print', body.printName)?.config;
      res.json(
        listPresets(s, t, {
          printerName: body.printerName,
          printerConfig,
          printName: body.printName,
          printConfig,
          all: !!body.all,
        }),
      );
    }),
  );

  r.get(
    '/presets/:type/default',
    asyncHandler(async (req, res) => {
      const t = presetType(req, res);
      if (!t) return;
      const s = await schemaOf();
      res.json(resolvePreset(s, t, defaultPresetName(t)));
    }),
  );

  r.get(
    '/presets/:type/:name',
    asyncHandler(async (req, res) => {
      const t = presetType(req, res);
      if (!t) return;
      const s = await schemaOf();
      const p = resolvePreset(s, t, req.params.name);
      if (!p) return res.status(404).json({ error: 'preset not found' });
      res.json(p);
    }),
  );

  r.put(
    '/presets/:type/:name',
    json,
    asyncHandler(async (req, res) => {
      const t = presetType(req, res);
      if (!t) return;
      const name = String(req.params.name || '').trim();
      if (!name || name.startsWith('-') || name.includes('/') || name.includes('\\')) return badRequest(res, 'invalid preset name');
      const body = (req.body || {}) as { config?: IniSection; inherits?: string };
      if (!body.config || typeof body.config !== 'object') return badRequest(res, 'config required');
      const s = await schemaOf();
      const allowed = new Set(s.presetKeys[t]);
      const cfg: IniSection = {};
      for (const [k, v] of Object.entries(body.config)) if (allowed.has(k) && typeof v === 'string') cfg[k] = v;
      saveUserPreset(t, name, cfg, body.inherits);
      res.json(resolvePreset(s, t, name));
    }),
  );

  r.delete('/presets/:type/:name', (req, res) => {
    const t = presetType(req, res);
    if (!t) return;
    if (!userPresetExists(t, req.params.name)) return res.status(404).json({ error: 'user preset not found' });
    deleteUserPreset(t, req.params.name);
    res.json({ ok: true });
  });

  // ---- models --------------------------------------------------------------
  const raw = express.raw({ type: () => true, limit: config.maxUploadBytes });

  r.post(
    '/models',
    raw,
    asyncHandler(async (req, res) => {
      const buf = req.body as Buffer;
      if (!buf || !buf.length) return badRequest(res, 'empty body');
      let mesh;
      try {
        mesh = parseStl(buf);
      } catch (e) {
        return badRequest(res, `cannot parse STL: ${(e as Error).message}`);
      }
      if (!mesh.indices.length) return badRequest(res, 'mesh has no triangles');
      const { id, name, triangles, vertices } = await saveModel(mesh, decodeURIComponent(String(req.header('x-filename') || 'model.stl')));
      res.json({ id, name, triangles, vertices });
    }),
  );

  r.get(
    '/models/:id',
    asyncHandler(async (req, res) => {
      // the existence check is what turns a missing model into a 404 before `sendFile` runs
      const f = await resolveExistingFile(path.join(config.modelsDir, `${path.basename(req.params.id)}.stl`));
      if (!f) return res.status(404).json({ error: 'model not found' });
      res.type('application/octet-stream').sendFile(f);
    }),
  );

  r.delete(
    '/models/:id',
    asyncHandler(async (req, res) => {
      await deleteModel(path.basename(req.params.id));
      res.json({ ok: true });
    }),
  );

  // ---- projects (3MF) ----------------------------------------------------
  r.post(
    '/projects/parse',
    raw,
    asyncHandler(async (req, res) => {
      const buf = req.body as Buffer;
      if (!buf || !buf.length) return badRequest(res, 'empty body');
      try {
        res.json(await read3mfProject(buf));
      } catch (e) {
        badRequest(res, `cannot read 3MF: ${(e as Error).message}`);
      }
    }),
  );

  r.post(
    '/export/3mf',
    json,
    asyncHandler(async (req, res) => {
      const body = req.body as SliceRequest;
      const s = await schemaOf();
      validateSliceRequest(body);
      const merged = mergeConfigs(s, body, { forProject: true });
      const buf = await build3mfForRequest(body, merged);
      const name = (body.outputName || 'project').replace(/[^A-Za-z0-9._ -]/g, '_') + '.3mf';
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      res.type('model/3mf').send(buf);
    }),
  );

  r.post(
    '/export/config',
    json,
    asyncHandler(async (req, res) => {
      const body = req.body as SliceRequest;
      const s = await schemaOf();
      const merged = mergeConfigs(s, { ...body, objects: body.objects || [] });
      const { serializeIni } = await import('../slicer/ini.js');
      res.setHeader('Content-Disposition', 'attachment; filename="config.ini"');
      res.type('text/plain').send(serializeIni(merged, 'generated by WebSlicer'));
    }),
  );

  // ---- slicing jobs --------------------------------------------------------
  r.post(
    '/slice',
    json,
    asyncHandler(async (req, res) => {
      const body = req.body as SliceRequest;
      try {
        validateSliceRequest(body);
      } catch (e) {
        return badRequest(res, (e as Error).message);
      }
      const s = await schemaOf();
      const job = await createJob(body, s);
      res.status(202).json(job);
    }),
  );

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
      send({ type: j.status === 'done' ? 'done' : 'error', job: j, message: j.error });
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

  r.get(
    '/jobs/:id/gcode',
    asyncHandler(async (req, res) => {
      const j = getJob(req.params.id);
      if (!j || j.status !== 'done') return res.status(404).json({ error: 'output not available' });
      const f = await resolveExistingFile(jobOutputPath(j));
      if (!f) return res.status(404).json({ error: 'output missing' });
      if (req.query.download !== undefined)
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(j.outputName)}"`);
      res.type(j.outputName.endsWith('.gcode') ? 'text/plain' : 'application/octet-stream').sendFile(f);
    }),
  );

  r.get(
    '/jobs/:id/log',
    asyncHandler(async (req, res) => {
      const j = getJob(req.params.id);
      if (!j) return res.status(404).json({ error: 'job not found' });
      res.type('text/plain').send(await readJobLog(j.id));
    }),
  );

  r.post('/jobs/:id/cancel', (req, res) => {
    if (!cancelJob(req.params.id)) return res.status(404).json({ error: 'job not cancellable' });
    res.json({ ok: true });
  });

  r.delete(
    '/jobs/:id',
    asyncHandler(async (req, res) => {
      if (!(await deleteJob(req.params.id))) return res.status(404).json({ error: 'job not found' });
      res.json({ ok: true });
    }),
  );

  r.post(
    '/jobs/:id/send',
    json,
    asyncHandler(async (req, res) => {
      const j = getJob(req.params.id);
      if (!j || j.status !== 'done') return res.status(404).json({ error: 'output not available' });
      const body = (req.body || {}) as { printerId?: string; filename?: string; startPrint?: boolean };
      const p = body.printerId ? getPrinter(body.printerId) : undefined;
      if (!p) return badRequest(res, 'printerId required');
      const filename = (body.filename || j.outputName).replace(/[\\/]/g, '_');
      const result = await uploadToPrinter(p, jobOutputPath(j), filename, !!body.startPrint);
      res.status(result.ok ? 200 : 502).json(result);
    }),
  );

  // ---- physical printers ---------------------------------------------------
  r.get('/printers', (_req, res) => res.json(listPrinters().map(maskPrinter)));
  r.post('/printers', json, (req, res) => res.json(maskPrinter(upsertPrinter(req.body || {}))));
  r.put('/printers/:id', json, (req, res) => {
    const existing = getPrinter(req.params.id);
    if (!existing) return res.status(404).json({ error: 'printer not found' });
    const body = req.body || {};
    if (body.apiKey === '••••••••' || body.apiKey === undefined) body.apiKey = existing.apiKey;
    res.json(maskPrinter(upsertPrinter({ ...existing, ...body, id: existing.id })));
  });
  r.delete('/printers/:id', (req, res) => {
    if (!deletePrinter(req.params.id)) return res.status(404).json({ error: 'printer not found' });
    res.json({ ok: true });
  });
  r.post(
    '/printers/:id/test',
    asyncHandler(async (req, res) => {
      const p = getPrinter(req.params.id);
      if (!p) return res.status(404).json({ error: 'printer not found' });
      res.json(await testPrinter(p));
    }),
  );
  r.post(
    '/printers/test',
    json,
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      const host = String(body.host || '').replace(/\/+$/, '');
      res.json(
        await testPrinter({
          id: 'tmp',
          name: 'tmp',
          type: body.type || 'octoprint',
          host: /^https?:\/\//i.test(host) ? host : `http://${host}`,
          apiKey: body.apiKey || undefined,
          ignoreTls: !!body.ignoreTls,
        }),
      );
    }),
  );

  // ---- file library (mounted directory) ------------------------------------
  r.use('/library', libraryRouter());

  // ---- server-side projects (headless plater, MCP phase 0) ------------------
  // Mounted after `/projects/parse` above, so that 3MF upload keeps its route.
  r.use('/projects', projectsRouter());

  // ---- autosave of the plater (per browser client) -------------------------
  r.put(
    '/autosave/:client',
    json,
    asyncHandler(async (req, res) => {
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
    }),
  );
  r.get(
    '/autosave/:client',
    asyncHandler(async (req, res) => {
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
    }),
  );
  r.delete(
    '/autosave/:client',
    asyncHandler(async (req, res) => {
      const id = isAutosaveClientId(req.params.client);
      if (!id) return badRequest(res, 'invalid client id');
      await deleteAutosave(id);
      res.json({ ok: true });
    }),
  );

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

function maskPrinter(p: ReturnType<typeof listPrinters>[number]) {
  return { ...p, apiKey: p.apiKey ? '••••••••' : undefined, hasApiKey: !!p.apiKey };
}
