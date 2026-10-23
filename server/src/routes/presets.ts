/**
 * Presets: list, read, add and delete the presets of the four types (system bundles + user presets).
 * The use cases – context resolution, key filtering, storage – are `services/presets.ts`.
 */
import express, { type Request, type Response } from 'express';
import { optionSchema } from '../services/meta.js';
import { defaultPreset, hasUserPreset, listPresetsWithContext, presetOf, removeUserPreset, storeUserPreset } from '../services/presets.js';
import { isPresetType, type PresetType, type PresetSummary, type ResolvedPreset } from '@webslicer/shared';
import { presetBodySchema, presetListSchema } from '../validation/presets.js';
import { firstIssueMessage } from '../validation/common.js';
import { badRequest, sendJson } from './common.js';

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

  r.delete('/presets/:type/:name', (req, res) => {
    const t = presetType(req, res);
    if (!t) return;
    if (!hasUserPreset(t, req.params.name)) return res.status(404).json({ error: 'user preset not found' });
    removeUserPreset(t, req.params.name);
    res.json({ ok: true });
  });

  return r;
}
