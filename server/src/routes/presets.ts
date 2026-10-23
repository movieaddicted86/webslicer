/**
 * Presets: list, read, add and delete the presets of the four types (system bundles + user presets).
 * The preset work itself is `slicer/presets.ts`; a user preset is filtered to the keys of its type
 * before it is stored.
 */
import express, { type Request, type Response } from 'express';
import { activeSchema } from '../services/schema.js';
import { listPresets, resolvePreset, saveUserPreset, deleteUserPreset, defaultPresetName, userPresetExists } from '../slicer/presets.js';
import { isPresetType, type PresetType, type PresetSummary, type ResolvedPreset } from '@webslicer/shared';
import { presetBodySchema, presetListSchema } from '../validation/presets.js';
import { firstIssueMessage } from '../validation/common.js';
import { badRequest, sendJson } from './common.js';
import type { IniSection } from '../slicer/ini.js';

function presetType(req: Request, res: Response): PresetType | undefined {
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
    const s = await activeSchema();
    const body = presetListSchema.parse(req.body ?? {});
    let printerConfig = body.printerConfig as IniSection | undefined;
    if (!printerConfig && body.printerName) printerConfig = resolvePreset(s, 'printer', body.printerName)?.config;
    let printConfig = body.printConfig as IniSection | undefined;
    if (!printConfig && body.printName) printConfig = resolvePreset(s, 'print', body.printName)?.config;
    sendJson<PresetSummary[]>(
      res,
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
    const s = await activeSchema();
    sendJson<ResolvedPreset | undefined>(res, resolvePreset(s, t, defaultPresetName(t)));
  });

  r.get('/presets/:type/:name', async (req, res) => {
    const t = presetType(req, res);
    if (!t) return;
    const s = await activeSchema();
    const p = resolvePreset(s, t, req.params.name);
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
    const s = await activeSchema();
    const allowed = new Set(s.presetKeys[t]);
    const cfg: IniSection = {};
    for (const [k, v] of Object.entries(parsed.data.config)) if (allowed.has(k)) cfg[k] = v;
    saveUserPreset(t, name, cfg, parsed.data.inherits);
    sendJson<ResolvedPreset | undefined>(res, resolvePreset(s, t, name));
  });

  r.delete('/presets/:type/:name', (req, res) => {
    const t = presetType(req, res);
    if (!t) return;
    if (!userPresetExists(t, req.params.name)) return res.status(404).json({ error: 'user preset not found' });
    deleteUserPreset(t, req.params.name);
    res.json({ ok: true });
  });

  return r;
}
