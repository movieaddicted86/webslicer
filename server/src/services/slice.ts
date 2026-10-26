/**
 * Slice use cases: turn a `SliceRequest` into a queued job (and, for the export routes, into a 3MF).
 *
 * No Express types – the routes and the MCP tools call in here. The heavy work (reading the models,
 * building the 3MF) sits behind `build3mfForRequest`; the queue itself is `../jobs.js`.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { parseStl, transformMesh, build3mf, type Mesh, type ThreeMfObject, type ThreeMfVolume } from '../slicer/threemf/index.js';
import { parseSliceRequest } from '../validation/slice.js';
import {
  blockingConfigIssues,
  checkConfigLimits,
  checkFootprints,
  checkRequestConfigLimits,
  hullBox,
  hullOfFlat,
  instanceBounds,
  meshBounds,
  transformHull,
  unionHull,
  multiply,
  plateRulesOf,
  splitVector,
  type ConfigIssue,
  type Hull,
  type InstanceFootprint,
  type Matrix4,
  type PlateIssue,
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

/**
 * The plate issues of a request (T-034): the same rules the browser lists before it starts a slice,
 * computed from the stored meshes and the request's own transforms, so no path into the queue can
 * skip them – the browser footer, the Preview, the re-slice, the project and the MCP routes.
 *
 * Footprints are the convex hulls of the meshes' bed projections through the instance matrices (the
 * way the browser reads its geometries), extended by the object's `ModelPart` volumes the way the
 * slicer adds them to the object. A bounding box only sees the outline's box; the hull sees the part.
 */
export async function plateIssuesOfRequest(req: SliceRequest): Promise<PlateIssue[]> {
  const meshes = new Map<string, Mesh>();
  /**
   * The mesh of a model, or `undefined` when its file is gone. A missing model is an internal
   * inconsistency the job builder reports on its own (500, as before); the plate check skips the
   * object instead of turning that answer into a misleading "outside the print volume".
   */
  const meshOf = async (modelId: string): Promise<Mesh | undefined> => {
    let mesh = meshes.get(modelId);
    if (!mesh) {
      try {
        mesh = parseStl(await fs.readFile(path.join(config.modelsDir, `${modelId}.stl`)));
      } catch {
        return undefined;
      }
      meshes.set(modelId, mesh);
    }
    return mesh;
  };

  const footprints: InstanceFootprint[] = [];
  for (const o of req.objects) {
    const mesh = await meshOf(o.modelId);
    if (!mesh) continue;
    // the object's box (mesh plus its parts) is what the top comes from – the browser reads it the
    // same way; the outline itself comes from the hulls below
    const objectBox = meshBounds(mesh.vertices);
    const meshHull = hullOfFlat(mesh.vertices);
    const volumes: Array<{ hull: Hull; matrix: Matrix4 }> = [];
    for (const v of o.volumes || []) {
      if (v.type !== 'ModelPart') continue;
      const vMesh = await meshOf(v.modelId);
      if (!vMesh) continue;
      const vBox = instanceBounds(meshBounds(vMesh.vertices), v.transform);
      for (let a = 0; a < 3; a++) {
        objectBox.min[a] = Math.min(objectBox.min[a], vBox.min[a]);
        objectBox.max[a] = Math.max(objectBox.max[a], vBox.max[a]);
      }
      volumes.push({ hull: hullOfFlat(vMesh.vertices), matrix: v.transform });
    }
    // old clients send only `transform`; newer ones list every instance (including the first)
    const transforms: Matrix4[] = o.instances?.length ? o.instances : [o.transform];
    transforms.forEach((transform, i) => {
      // hulls, not boxes: the mesh and every part under the instance matrix, the way the browser
      // reads its geometries – both sides feed the same hull code
      const hull = unionHull([
        transformHull(meshHull, transform),
        ...volumes.map((v) => transformHull(v.hull, multiply(transform, v.matrix))),
      ]);
      const box = hullBox(hull);
      footprints.push({
        objectId: o.modelId,
        objectName: o.name || 'object',
        instanceId: `${i}`,
        minX: box.minX,
        minY: box.minY,
        maxX: box.maxX,
        maxY: box.maxY,
        maxZ: instanceBounds(objectBox, transform).max[2],
        hull,
      });
    });
  }
  return checkFootprints(footprints, plateRulesOf(req.printer.config, req.print.config));
}

/**
 * Refuse a request whose plate fails the checks, with the same reasons the browser shows. A block is
 * a `ValidationError` (400) whose `details` carry the issues, like `validateConfigLimits`; warnings
 * (the sequential-printing clearance) do not stop the slice.
 */
export async function validatePlate(req: SliceRequest): Promise<PlateIssue[]> {
  const issues = await plateIssuesOfRequest(req);
  const blocking = issues.filter((i) => i.severity === 'block');
  if (blocking.length) throw new ValidationError(blocking[0].message, { issues });
  return issues;
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
