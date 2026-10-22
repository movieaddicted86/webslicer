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
import { parseStl, transformMesh, build3mf, type ThreeMfObject, type ThreeMfVolume } from '../slicer/threemf/index.js';
import { parseSliceRequest } from '../validation/slice.js';
import { splitVector, type Schema, type SliceRequest } from '@webslicer/shared';
import type { IniSection } from '../slicer/ini.js';

/**
 * Validate a slice request in place. The rules live in `validation/slice.ts` as one zod schema (R-10),
 * shared with the MCP tools; this wrapper keeps the contract the callers rely on: it *normalises in
 * place* (`instances` overwrites the legacy `transform`, a missing `filaments` becomes an empty array)
 * and it throws a plain `Error`, not a typed one.
 *
 * That last point is deliberate: the routes that map the error (`/api/slice`, `/api/autosave/:client`,
 * the MCP tools) answer 400 with this message, while the routes that do *not* map it
 * (`/api/export/3mf`, `/api/projects/:id/slice`) fall through to the error handler and answer 500 –
 * exactly as before the refactoring, and the status codes are part of the contract
 * (`routes/http.test.ts` pins the 500).
 */
export function validateSliceRequest(body: SliceRequest) {
  const parsed = parseSliceRequest(body);
  if (!parsed.ok) throw new Error(parsed.message);
  const objects = (body as unknown as { objects: Array<Record<string, unknown>> }).objects;
  parsed.request.objects.forEach((o, i) => {
    objects[i].transform = o.transform;
  });
  body.filaments = parsed.request.filaments as SliceRequest['filaments'];
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
