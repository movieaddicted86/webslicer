/**
 * Slice use cases: turn a `SliceRequest` into a queued job (and, for the export routes, into a 3MF).
 *
 * No Express types – the routes and the MCP tools call in here. The heavy work (reading the models,
 * building the 3MF) sits behind `build3mfForRequest`; the queue itself is `../jobs.js`.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { activeSchema } from './schema.js';
import { parseStl, transformMesh, build3mf, type ThreeMfObject, type ThreeMfVolume } from '../slicer/threemf.js';
import { splitVector, type PresetType, type Schema, type SliceRequest } from '@webslicer/shared';
import { CUSTOM_GCODE_TYPES, VOLUME_TYPES } from '@webslicer/shared';
import type { IniSection } from '../slicer/ini.js';

const PRESET_TYPES: PresetType[] = ['print', 'filament', 'printer', 'sla_print', 'sla_material'];

/** Is `type` one of the preset types the API knows? */
export function isPresetType(type: string): type is PresetType {
  return (PRESET_TYPES as string[]).includes(type);
}

/** Validate a 4x4 transform: exactly 16 finite numbers. */
export function isTransform(t: unknown): t is number[] {
  return Array.isArray(t) && t.length === 16 && t.every((v) => typeof v === 'number' && Number.isFinite(v));
}

/**
 * Validate a slice request in place. Normalises the two fields the slicer relies on: `instances`
 * overwrites the legacy `transform`, and a missing `filaments` becomes an empty array.
 *
 * These failures stay plain `Error`s on purpose. `validateSliceRequest` is not one of the typed
 * `Object.assign` sites of N-5: the routes that map it (`/api/slice`, `/api/autosave/:client`, the MCP
 * tools) keep their own 400, while the routes that do *not* map it (`/api/export/3mf`,
 * `/api/projects/:id/slice`) fall through to the error handler and answer 500 – exactly as on `main`.
 * Turning that into a typed 400 is R-10 (one validation layer for REST and MCP), not this refactoring.
 */
export function validateSliceRequest(body: SliceRequest) {
  if (!body || typeof body !== 'object') throw new Error('body required');
  if (!Array.isArray(body.objects) || !body.objects.length) throw new Error('at least one object required');
  const isId = (id: unknown) => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id);
  for (const o of body.objects) {
    if (!isId(o.modelId)) throw new Error('invalid modelId');
    if (!Array.isArray(o.transform) || o.transform.length !== 16) throw new Error('transform must have 16 entries');
    if (o.instances !== undefined) {
      if (!Array.isArray(o.instances) || !o.instances.length || o.instances.length > 1000)
        throw new Error('instances must have 1-1000 entries');
      for (const t of o.instances) {
        if (!isTransform(t)) throw new Error('every instance must be a transform with 16 finite numbers');
      }
      // keep the first instance in sync with the legacy field
      o.transform = o.instances[0];
    } else {
      for (const v of o.transform)
        if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('transform must contain 16 finite numbers');
    }
    for (const key of ['supportPaint', 'seamPaint'] as const) {
      const p = o[key];
      if (p !== undefined && (typeof p !== 'string' || p.length > 2_000_000 || !/^[048]*$/.test(p))) throw new Error(`invalid ${key}`);
    }
    if (o.mmuPaint !== undefined && (typeof o.mmuPaint !== 'string' || o.mmuPaint.length > 2_000_000 || !/^[0-9a-f]*$/i.test(o.mmuPaint)))
      throw new Error('invalid mmuPaint');
    if (o.ranges !== undefined) {
      if (!Array.isArray(o.ranges) || o.ranges.length > 64) throw new Error('invalid ranges');
      for (const r of o.ranges) {
        if (typeof r.minZ !== 'number' || typeof r.maxZ !== 'number' || !(r.maxZ > r.minZ) || r.minZ < 0) throw new Error('invalid range');
        if (!r.config || typeof r.config !== 'object') throw new Error('range config required');
      }
    }
    for (const v of o.volumes || []) {
      if (!isId(v.modelId)) throw new Error('invalid volume modelId');
      if (!isTransform(v.transform)) throw new Error('volume transform must have 16 entries');
      if (!VOLUME_TYPES.includes(v.type)) throw new Error(`invalid volume type ${v.type}`);
    }
  }
  if (!body.print?.config || !body.printer?.config) throw new Error('print and printer config required');
  if (!Array.isArray(body.filaments)) body.filaments = [];
  if (body.customGcodes !== undefined) {
    if (!Array.isArray(body.customGcodes) || body.customGcodes.length > 500) throw new Error('at most 500 custom G-codes');
    for (const c of body.customGcodes) {
      if (typeof c.printZ !== 'number' || !Number.isFinite(c.printZ) || c.printZ <= 0) throw new Error('invalid custom G-code height');
      if (!CUSTOM_GCODE_TYPES.includes(c.type)) throw new Error(`invalid custom G-code type ${c.type}`);
      if (c.color !== undefined && !/^#[0-9a-f]{6}$/i.test(c.color)) throw new Error('invalid custom G-code colour');
      if (c.extra !== undefined && (typeof c.extra !== 'string' || c.extra.length > 20000)) throw new Error('invalid custom G-code text');
      if (c.extruder !== undefined && (!Number.isInteger(c.extruder) || c.extruder < 1 || c.extruder > 16))
        throw new Error('invalid custom G-code extruder');
    }
  }
  if (body.thumbnails !== undefined) {
    if (!Array.isArray(body.thumbnails) || body.thumbnails.length > 8) throw new Error('at most 8 thumbnails');
    for (const t of body.thumbnails) {
      if (!['PNG', 'JPG', 'QOI'].includes(t.format)) throw new Error('invalid thumbnail format');
      if (!Number.isInteger(t.width) || !Number.isInteger(t.height) || t.width <= 0 || t.height <= 0 || t.width > 2000 || t.height > 2000)
        throw new Error('invalid thumbnail size');
      if (typeof t.data !== 'string' || t.data.length > 4_000_000 || !/^[A-Za-z0-9+/=\s]*$/.test(t.data))
        throw new Error('invalid thumbnail data');
    }
  }
}

/**
 * Read a mesh of the model directory.
 *
 * A missing model file is an *internal* inconsistency (the browser uploaded it, the autosave or the
 * project kept the id), not client input – on `main` these throw plain `Error`s and the error handler
 * answers 500, and that is preserved here.
 */
async function readModelFile(modelId: string, message: string) {
  const file = path.join(config.modelsDir, `${modelId}.stl`);
  try {
    return parseStl(await fs.readFile(file));
  } catch {
    throw new Error(message);
  }
}

/** Build the PrusaSlicer 3MF of a request; `projectConfig` becomes the embedded project settings. */
export async function build3mfForRequest(req: SliceRequest, projectConfig?: IniSection): Promise<Buffer> {
  const objects: ThreeMfObject[] = [];
  for (const o of req.objects) {
    // old clients send only `transform`; newer ones list every instance (including the first)
    const transforms = o.instances?.length ? o.instances : [o.transform];
    const mesh = await readModelFile(o.modelId, `Model ${o.modelId} not found on server; please re-upload`);
    const volumes: ThreeMfVolume[] = [];
    for (const v of o.volumes || []) {
      const vMesh = await readModelFile(v.modelId, `Volume model ${v.modelId} not found on server; please re-add the volume`);
      volumes.push({
        name: v.name || v.type,
        mesh: transformMesh(vMesh, v.transform),
        type: v.type,
        config: v.config,
        extruder: v.extruder,
      });
    }
    objects.push({
      name: o.name || 'object',
      mesh,
      transform: transforms[0],
      instances: transforms.length > 1 ? transforms : undefined,
      config: o.config,
      extruder: o.extruder,
      volumes,
      supportPaint: o.supportPaint,
      seamPaint: o.seamPaint,
      mmuPaint: o.mmuPaint,
      ranges: o.ranges,
    });
  }
  const extruders = Math.max(1, splitVector(req.printer.config.nozzle_diameter || '0.4').length);
  return build3mf(objects, {
    projectConfig,
    title: req.outputName,
    customGcodes: req.customGcodes,
    extruders,
  });
}

/** The option schema, built on first use from the installed slicer. */
export async function schemaOf(): Promise<Schema> {
  return activeSchema();
}
