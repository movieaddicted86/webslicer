/**
 * Presets: list, read, add, rename and delete the presets of the four types (system bundles + user
 * presets), plus the config-bundle export/import and the import from a G-code file.
 *
 * The use cases – context resolution, key filtering, storage, bundle validation – are
 * `services/presets.ts` and `services/presetTransfer.ts`; this router only validates and answers.
 */
import express from 'express';
import { optionSchema } from '../services/meta.js';
import {
  defaultPreset,
  filamentCatalogue,
  hasUserPreset,
  listPresetsWithContext,
  presetOf,
  removeUserPreset,
  replaceVisibleFilaments,
  storeUserPreset,
  visibleFilaments,
} from '../services/presets.js';
import { exportBundle, importBundle, previewBundle, renameUserPreset } from '../services/presetTransfer.js';
import { forgetPrinterSafety } from '../services/printerSafety.js';
import { previewGcodeImport } from '../services/gcodeImport.js';
import { isPresetType, type FilamentCatalogEntry, type PresetType, type PresetSummary, type ResolvedPreset } from '@webslicer/shared';
import {
  presetBodySchema,
  presetBundleImportSchema,
  presetBundleSchema,
  presetListSchema,
  presetRenameSchema,
  visibleFilamentsSchema,
} from '../validation/presets.js';
import { firstIssueMessage } from '../validation/common.js';
import { config } from '../config.js';
import { withReceivedFile } from './uploads.js';
import { badRequest, sendJson } from './common.js';
import type { PresetImportPreview, PresetImportResult, PresetRenameResult } from '@webslicer/shared';

function presetType(req: express.Request, res: express.Response): PresetType | undefined {
  const t = req.params.type as PresetType;
  if (!isPresetType(t)) {
    badRequest(res, `Unknown preset type ${t}`);
    return undefined;
  }
  return t;
}

/** The preset routes of the REST surface. */
export function presetsRouter(): express.Router {
  const r = express.Router();
  const json = express.json({ limit: '64mb' });

  r.post('/presets/:type/list', json, async (req, res) => {
    const t = presetType(req, res);
    if (!t) return;
    const s = await optionSchema();
    const body = presetListSchema.parse(req.body ?? {});
    sendJson<PresetSummary[]>(res, listPresetsWithContext(s, t, body));
  });

  r.get('/presets/:type/default', async (req, res) => {
    const t = presetType(req, res);
    if (!t) return;
    const s = await optionSchema();
    sendJson<ResolvedPreset | undefined>(res, defaultPreset(s, t));
  });

  // ---- the configuration wizard's filament step ---------------------------
  // The whole system filament catalogue, for the step that chooses which of them the selector shows.
  // Static segments (`filaments`), mounted before `/:type/:name` for the same reason as bundles.
  r.get('/presets/filaments/catalog', async (req, res) => {
    const s = await optionSchema();
    const printerName = typeof req.query.printer === 'string' ? req.query.printer : undefined;
    sendJson<FilamentCatalogEntry[]>(res, filamentCatalogue(s, printerName));
  });

  r.get('/presets/filaments/visible', (_req, res) => {
    sendJson<{ names: string[] }>(res, { names: visibleFilaments() });
  });

  r.put('/presets/filaments/visible', json, (req, res) => {
    const parsed = visibleFilamentsSchema.safeParse(req.body ?? {});
    if (!parsed.success) return badRequest(res, firstIssueMessage(parsed.error, 'names required'));
    sendJson<{ names: string[] }>(res, { names: replaceVisibleFilaments(parsed.data.names) });
  });

  // ---- config bundles ------------------------------------------------------
  // Both routes carry their own name (`bundle`) and never reach `/:type/:name`, which the order of the
  // two static segments already prevents; they sit here, before the parameterised routes, to keep it
  // obvious.
  r.get('/presets/bundle', async (_req, res) => {
    const bundle = await exportBundle();
    res.setHeader('Content-Disposition', 'attachment; filename="WebSlicer config bundle.ini"');
    res.type('text/plain').send(bundle);
  });

  r.post('/presets/bundle/preview', json, async (req, res) => {
    const s = await optionSchema();
    const body = presetBundleSchema.safeParse(req.body ?? {});
    if (!body.success) return badRequest(res, firstIssueMessage(body.error, 'bundle required'));
    sendJson<PresetImportPreview>(res, previewBundle(body.data.bundle, s));
  });

  r.post('/presets/bundle/import', json, async (req, res) => {
    const s = await optionSchema();
    const parsed = presetBundleImportSchema.safeParse(req.body ?? {});
    if (!parsed.success) return badRequest(res, firstIssueMessage(parsed.error, 'bundle required'));
    sendJson<PresetImportResult>(
      res,
      importBundle(
        parsed.data.bundle,
        (parsed.data.choices ?? []).map((c) => ({ ...c, system: !!c.system })),
        s,
      ),
    );
  });

  // ---- import from a G-code file -------------------------------------------
  // The file is streamed to disk like a model upload (S7) and only its config block is read; the
  // answer is the preview of the bundle that block describes – nothing is stored until the client
  // imports it.
  r.post('/presets/gcode/preview', async (req, res) => {
    const s = await optionSchema();
    const preview = await withReceivedFile(req, config.cacheDir, (file) => previewGcodeImport(file, s));
    sendJson<PresetImportPreview>(res, preview);
  });

  r.get('/presets/:type/:name', async (req, res) => {
    const t = presetType(req, res);
    if (!t) return;
    const s = await optionSchema();
    const p = presetOf(s, t, req.params.name);
    if (!p) return res.status(404).json({ error: 'preset not found' });
    sendJson<ResolvedPreset>(res, p);
  });

  r.put('/presets/:type/:name', json, async (req, res) => {
    const t = presetType(req, res);
    if (!t) return;
    const name = req.params.name.trim();
    if (!name || name.startsWith('-') || name.includes('/') || name.includes('\\')) return badRequest(res, 'invalid preset name');
    const parsed = presetBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return badRequest(res, firstIssueMessage(parsed.error, 'config required'));
    const s = await optionSchema();
    sendJson<ResolvedPreset | undefined>(res, storeUserPreset(s, t, name, parsed.data.config, parsed.data.inherits));
  });

  r.patch('/presets/:type/:name', json, async (req, res) => {
    const t = presetType(req, res);
    if (!t) return;
    const parsed = presetRenameSchema.safeParse(req.body ?? {});
    if (!parsed.success) return badRequest(res, firstIssueMessage(parsed.error, 'new preset name required'));
    sendJson<PresetRenameResult>(res, await renameUserPreset(t, req.params.name, parsed.data.name));
  });

  r.delete('/presets/:type/:name', async (req, res) => {
    const t = presetType(req, res);
    if (!t) return;
    if (!hasUserPreset(t, req.params.name)) return res.status(404).json({ error: 'user preset not found' });
    removeUserPreset(t, req.params.name);
    // T-085: a deleted printer preset takes its safety answer with it – a later preset of the same
    // name is a different machine and must answer again (no stale profile, no silent protection)
    if (t === 'printer') await forgetPrinterSafety(req.params.name);
    sendJson(res, { ok: true });
  });

  return r;
}
