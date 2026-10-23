/**
 * Slice use cases: turn a `SliceRequest` into a queued job (and, for the export routes, into a 3MF).
 *
 * No Express types – the routes and the MCP tools call in here. The heavy work (reading the models,
 * building the 3MF) sits behind `build3mfForRequest`; the queue itself is `../jobs.js`.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { parseStl, transformMesh, build3mf, type ThreeMfObject, type ThreeMfVolume } from '../slicer/threemf/index.js';
import { parseSliceRequest } from '../validation/slice.js';
import {
  checkConfigLimits,
  checkRequestConfigLimits,
  blockingConfigIssues,
  splitVector,
  type ConfigIssue,
  type Schema,
  type SliceRequest,
} from '@webslicer/shared';
import { ValidationError } from '../errors.js';
import { mergeConfigs } from './configMerge.js';
import type { IniSection } from '../slicer/ini.js';

/**
 * Validate a slice request in place and answer it as the `SliceRequest` it now is. The rules live in
 * `validation/slice.ts` as one zod schema (R-10), shared with the MCP tools; this wrapper keeps the
 * contract the callers rely on: it *normalises in place* (`instances` overwrites the legacy
 * `transform`, a missing `filaments` becomes an empty array) and it throws a plain `Error`, not a
 * typed one.
 *
 * That last point is deliberate: every route that calls it maps the error to 400 with this message
 * (`/api/slice`, `/api/autosave/:client`, both export routes, the project slice and the MCP tools);
 * a plain `Error` here never reaches the 500 handler as an "internal error".
 *
 * The raw body is given its API type only here, after the schema checked the contract – routes never
 * cast `req.body` themselves (AC-3, q3-server-routes).
 */
export function validateSliceRequest(raw: unknown): SliceRequest {
  const parsed = parseSliceRequest(raw);
  if (!parsed.ok) throw new Error(parsed.message);
  const body = raw as SliceRequest;
  const objects = (body as unknown as { objects: Array<Record<string, unknown>> }).objects;
  parsed.request.objects.forEach((o, i) => {
    objects[i].transform = o.transform;
  });
  body.filaments = parsed.request.filaments as SliceRequest['filaments'];
  return body;
}

/** The configuration-limit issues of a validated request (S1-d): the slice and MCP paths read these. */
export { checkConfigLimits };

/**
 * Refuse a request whose settings break a global typo catcher (S1-d, extended in q6-preflight/N3).
 *
 * The checked view is the **merged** config the slicer really receives (`mergeConfigs`) plus the
 * preset sections and the per-object/per-range overrides – a `temperature = 999` that only arrives
 * through a printer or print config, or a `layer_height` an object override sets, is caught too.
 *
 * A block is a `ValidationError` (400) whose `details` carry the issues, so the client shows the same
 * list the check produced – the shape the send gate already uses for its 409. Warnings do not stop the
 * slice; they are handed back with the job (and shown in the preview's warning list).
 *
 * Separate from `validateSliceRequest` on purpose: that one keeps its contract (`Error`, 400, 500 on
 * the routes that never mapped it), while this rule is new and belongs to every route that queues a job.
 */
export function validateConfigLimits(body: SliceRequest, schema?: Schema): ConfigIssue[] {
  const merged = schema ? mergeConfigs(schema, body) : undefined;
  const issues = checkRequestConfigLimits({
    print: body.print,
    printer: body.printer,
    filaments: body.filaments,
    objects: body.objects,
    merged,
  });
  const blocking = blockingConfigIssues(issues);
  if (blocking.length) {
    throw new ValidationError(blocking[0].message, { issues });
  }
  return issues;
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
      // the variable layer height profile (T-045) goes into the 3MF next to the height ranges
      layerProfile: o.layerProfile,
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
