/**
 * The cut tool's server side (T-044): PrusaSlicer cuts the mesh, the server only prepares the frame
 * and puts the parts back.
 *
 * The CLI cuts horizontally only (`--cut <z>`), measured from the lowest point of the loaded file in
 * the bed frame. So, like the STEP conversion (T-009), everything happens around a temp directory:
 *
 * 1. read the model, place it by the instance transform and rotate it into the cut frame
 *    (`planeFrame`, shared maths), where the plane is horizontal at `z = planeZ`;
 * 2. lower the mesh so its lowest point is at 0 (what `--cut` counts from) and write it as binary STL;
 * 3. run `prusa-slicer --cut <planeZ - minZ> --export-3mf --dont-arrange --no-ensure-on-bed`;
 * 4. read the one or two objects the CLI wrote (upper first, lower second), turn and place each with
 *    the shared cut maths, and store it as a model of its own.
 *
 * No mesh cutting or capping happens here: the CLI does that, which is what keeps the caps closed and
 * matches PrusaSlicer's own behaviour.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { envIntegerAtLeast } from '../env.js';
import { ValidationError } from '../errors.js';
import { failureLine, maskTempPath, runSlicer, withTempDir, type RunOptions, type RunResult } from './cli.js';
import { cutArgs } from './commands.js';
import { readMeshBlock, writeBinaryStl, transformMesh, type Mesh } from './threemf/index.js';
import { parse3mfBuild } from './threemf/read.js';
import { assertZipReasonable, readZipEntryText } from './threemf/zipLimits.js';
import { cutRotation, invert, multiply, planeFrame, soupBounds, translate, type Matrix4, type Vec3 } from '@webslicer/shared';
/** The CLI runner, injectable so the tests do not need PrusaSlicer. */
export type SlicerRunner = (args: string[], opts?: RunOptions) => Promise<RunResult>;

/** How long one cut may take (the CLI can hang on a broken mesh). */
export function cutTimeoutMs(): number {
  return envIntegerAtLeast('CUT_TIMEOUT_MS', 1, 120_000);
}

/** The first line of the CLI output that says what went wrong (the 400 text of a failed cut). */
export function cutFailureLine(res: RunResult, timeoutMs = cutTimeoutMs()): string {
  return failureLine(res, timeoutMs, 'the cut');
}

/** One side of the cut: `upper` is the material above the plane, `lower` the material below it. */
export type CutSide = 'upper' | 'lower';

/** A part the CLI produced, in the cut frame (upper part first in the CLI's output). */
export interface CutPart {
  side: CutSide;
  mesh: Mesh;
}

/** What the endpoint sends in: the mesh in its own coordinates plus the instance and the plane. */
export interface CutInput {
  mesh: Mesh;
  /** the instance's world matrix (column-major 4x4, `placementMatrix` order) */
  transform: Matrix4;
  /** a point on the cut plane, world coordinates */
  point: Vec3;
  normal: Vec3;
  keep?: 'both' | 'upper' | 'lower';
  placeOnCut?: boolean;
  flipUpper?: boolean;
}

/** One kept part: the mesh in its own coordinates and where that origin sits in the world. */
export interface CutOutPart extends CutPart {
  position: Vec3;
}

/** The result of one cut: the kept parts, plus which side they came from and where they go. */
export interface CutOutput {
  parts: CutOutPart[];
}

/** A 400 of the cut that never carries a server path (AC-6). */
function cutError(message: string, dir: string): ValidationError {
  return new ValidationError(maskTempPath(message, dir));
}

/** The objects of a cut 3MF in document order, with their item transform applied. */
async function readCutOutput(file: string): Promise<Mesh[]> {
  const zip = await JSZip.loadAsync(await fsp.readFile(file));
  assertZipReasonable(zip);
  if (!zip.file('3D/3dmodel.model')) throw new ValidationError('cannot cut: the slicer wrote no 3dmodel.model');
  const model = await readZipEntryText(zip, '3D/3dmodel.model');
  const items = parse3mfBuild(model);
  const meshes: Mesh[] = [];
  for (const chunk of model.split(/<\/object>/)) {
    const at = chunk.lastIndexOf('<object');
    if (at < 0) continue;
    const open = /^<object\b([^>]*)>([\s\S]*)$/.exec(chunk.slice(at));
    if (!open) continue;
    const id = /\bid="([^"]+)"/.exec(open[1])?.[1];
    if (!id) continue;
    const mesh = readMeshBlock(open[2]);
    if (!mesh.indices.length) continue;
    // with `--dont-arrange --no-ensure-on-bed` the item transform is the identity, but a CLI that
    // wrote a placement must not lose it
    const item = items.find((b) => b.objectId === id);
    meshes.push(item ? transformMesh(mesh, item.transform) : mesh);
  }
  if (!meshes.length) throw new ValidationError('cannot cut: the slicer wrote no mesh');
  return meshes;
}

/** The CLI's objects named by their side: the upper part is the one with the higher top. */
function splitParts(meshes: Mesh[], planeZ: number): CutPart[] {
  const boxes = meshes.map((mesh) => ({ mesh, box: soupBounds(mesh.vertices) }));
  if (boxes.length === 1) {
    // the plane missed the material: the CLI left the mesh untouched, and one side is empty
    const { mesh, box } = boxes[0];
    return [{ side: box.min[2] >= planeZ - 1e-6 ? 'upper' : 'lower', mesh }];
  }
  boxes.sort((a, b) => b.box.max[2] - a.box.max[2]);
  return [
    { side: 'upper', mesh: boxes[0].mesh },
    { side: 'lower', mesh: boxes[1].mesh },
  ];
}

/** The mesh of one part as the plater gets it: turned in the cut frame, back to the world, on the bed. */
export function placePart(
  part: CutPart,
  frame: { rotation: Matrix4; planeZ: number },
  opts: { placeOnCut?: boolean; flipUpper?: boolean } = {},
): Mesh {
  // the cut frame is a rotation about the world origin, so the way back is its inverse rotation
  const back = invert(frame.rotation);
  if (!back) throw new ValidationError('cannot cut: the plane has no direction');
  const turned = transformMesh(part.mesh, cutRotation(part.side, frame.planeZ, opts));
  const world = transformMesh(turned, back);
  if (!opts.placeOnCut) return world;
  // "place on cut": lower the part along the world Z axis until its lowest point is on the bed
  const minZ = soupBounds(world.vertices).min[2];
  return transformMesh(world, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -minZ, 1]);
}

/**
 * A part's mesh in its own coordinates (X/Y centred, bottom at z = 0) plus the world position of that
 * origin. Stored that way a part is a model like an uploaded one, and its instance placement is the
 * position – so a slice request applies the transform exactly once.
 */
export function ownCoordinates(mesh: Mesh): { mesh: Mesh; position: Vec3 } {
  const b = soupBounds(mesh.vertices);
  const position: Vec3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.min[2]];
  return { mesh: transformMesh(mesh, translate(-position[0], -position[1], -position[2])), position };
}

/** What one cut needs besides the input: the frame it happens in and the CLI run's options. */
interface CutRun {
  frame: { rotation: Matrix4; planeZ: number };
  framed: Mesh;
  /** the plane height in the framed mesh, counted from its lowest point (what `--cut` takes) */
  cutZ: number;
  /** the lowest point of the framed mesh, undone on the CLI's output */
  minZ: number;
  opts: { run?: SlicerRunner; timeoutMs?: number; signal?: AbortSignal };
}

/** Cut a model with a plane. Returns the kept parts in world coordinates, each also in its own
 * coordinates with the world position of that origin; the temp directory of the run is removed in
 * every case, so a failed cut leaves nothing behind. */
export async function cutMesh(
  input: CutInput,
  opts: { run?: SlicerRunner; workDir?: string; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<CutOutput> {
  const frame = planeFrame({ point: input.point, normal: input.normal });
  if (!frame) throw new ValidationError('cannot cut: the plane has no direction');
  // world -> cut frame; the CLI counts `--cut` from the lowest point of what it loads
  const intoFrame = multiply(frame.rotation, input.transform);
  const framed = transformMesh(input.mesh, intoFrame);
  const minZ = soupBounds(framed.vertices).min[2];
  const run: CutRun = { frame, framed, cutZ: frame.planeZ - minZ, minZ, opts };
  if (opts.workDir) return cutInDir(input, opts.workDir, run);
  return withTempDir('cut', (dir) => cutInDir(input, dir, run));
}

async function cutInDir(input: CutInput, dir: string, c: CutRun): Promise<CutOutput> {
  const timeoutMs = c.opts.timeoutMs ?? cutTimeoutMs();
  const inputFile = path.join(dir, 'input.stl');
  const outputFile = path.join(dir, 'cut.3mf');
  await fsp.writeFile(inputFile, writeBinaryStl(c.framed));
  const run = c.opts.run ?? runSlicer;
  const res = await run(cutArgs({ cutZ: c.cutZ, outputFile, inputFile }), { timeoutMs, signal: c.opts.signal });
  if (res.code !== 0) throw cutError(`cannot cut: ${cutFailureLine(res, timeoutMs)}`, dir);
  const meshes = await readCutOutput(outputFile).catch(() => {
    throw cutError(`cannot cut: ${cutFailureLine(res, timeoutMs)}`, dir);
  });
  // the CLI exports every object standing on z = 0 (measured in the frame it cut in); the cut
  // frame puts the plane back where the user's plane is
  const up = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, c.minZ, 1];
  const placed = meshes.map((mesh) => transformMesh(mesh, up));
  const keep = input.keep ?? 'both';
  const parts = splitParts(placed, c.frame.planeZ)
    .filter((p) => keep === 'both' || p.side === keep)
    .map((p) => ({ side: p.side, ...ownCoordinates(placePart(p, c.frame, input)) }));
  return { parts };
}
