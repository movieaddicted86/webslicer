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
import { config } from '../config.js';
import { envIntegerAtLeast } from '../env.js';
import { ValidationError } from '../errors.js';
import { runSlicer, type RunOptions, type RunResult } from './cli.js';
import { writeBinaryStl, transformMesh, type Mesh } from './threemf/index.js';
import { parse3mfBuild } from './threemf/read.js';
import { assertZipReasonable, readZipEntryText } from './threemf/zipLimits.js';
import { cutRotation, invert, multiply, planeFrame, soupBounds, translate, type Matrix4, type Vec3 } from '@webslicer/shared';
/** The CLI runner, injectable so the tests do not need PrusaSlicer. */
export type SlicerRunner = (args: string[], opts?: RunOptions) => Promise<RunResult>;

/** How long one cut may take (the CLI can hang on a broken mesh). */
export function cutTimeoutMs(): number {
  return envIntegerAtLeast('CUT_TIMEOUT_MS', 1, 120_000);
}

/** The escape character of the CLI's ANSI colour codes (`\u001b`, kept out of a regex literal). */
const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

/** Strip the CLI's colour escapes and the `****` decoration of its log lines. */
function cleanLine(line: string): string {
  return line
    .replace(ANSI, '')
    .replace(/^\*+\s*/, '')
    .replace(/\s*\*+$/, '')
    .trim();
}

/** The first line of the CLI output that says what went wrong (the 400 text of a failed cut). */
export function cutFailureLine(res: RunResult, timeoutMs = cutTimeoutMs()): string {
  if (res.code === null && res.signal) return `the cut timed out after ${Math.round(timeoutMs / 1000)} s`;
  const lines = `${res.stderr}\n${res.stdout}`.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const relevant = lines.find((l) => /\b(err|error|fail|cannot|unknown|invalid|no such|unable)\b/i.test(l));
  return relevant || lines[0] || `the slicer CLI exited with code ${res.code}`;
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

/** The temp directory one cut works in; the caller removes it, whatever happens. */
export async function createCutTempDir(): Promise<string> {
  const root = path.join(config.cacheDir, 'cut');
  await fsp.mkdir(root, { recursive: true });
  return fsp.mkdtemp(path.join(root, `${process.pid}-`));
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
    const mesh = readMesh(open[2]);
    if (!mesh.indices.length) continue;
    // with `--dont-arrange --no-ensure-on-bed` the item transform is the identity, but a CLI that
    // wrote a placement must not lose it
    const item = items.find((b) => b.objectId === id);
    meshes.push(item ? transformMesh(mesh, item.transform) : mesh);
  }
  if (!meshes.length) throw new ValidationError('cannot cut: the slicer wrote no mesh');
  return meshes;
}

/** Vertices and triangles of one `<mesh>` block (the reader of the headless import, kept local). */
function readMesh(body: string): Mesh {
  const block = /<mesh\b[^>]*>([\s\S]*?)<\/mesh>/.exec(body)?.[1];
  if (!block) return { vertices: new Float32Array(0), indices: new Uint32Array(0) };
  const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
  const verts: number[] = [];
  const vertexRe = /<vertex\b([^>]*?)\/?>/g;
  let v: RegExpExecArray | null;
  while ((v = vertexRe.exec(block))) verts.push(Number(attr(v[1], 'x')), Number(attr(v[1], 'y')), Number(attr(v[1], 'z')));
  const tris: number[] = [];
  const triRe = /<triangle\b([^>]*?)\/?>/g;
  let t: RegExpExecArray | null;
  const count = verts.length / 3;
  while ((t = triRe.exec(block))) {
    const a = Number(attr(t[1], 'v1'));
    const b = Number(attr(t[1], 'v2'));
    const c = Number(attr(t[1], 'v3'));
    if (![a, b, c].every((i) => Number.isInteger(i) && i >= 0 && i < count)) continue;
    tris.push(a, b, c);
  }
  return { vertices: Float32Array.from(verts), indices: Uint32Array.from(tris) };
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

/**
 * Cut a model with a plane. Returns the kept parts in world coordinates, each also in its own
 * coordinates with the world position of that origin; the temp directory of the run is removed in
 * every case, so a failed cut leaves nothing behind.
 */
export async function cutMesh(
  input: CutInput,
  opts: { run?: SlicerRunner; workDir?: string; timeoutMs?: number } = {},
): Promise<CutOutput> {
  const frame = planeFrame({ point: input.point, normal: input.normal });
  if (!frame) throw new ValidationError('cannot cut: the plane has no direction');
  // world -> cut frame; the CLI counts `--cut` from the lowest point of what it loads
  const intoFrame = multiply(frame.rotation, input.transform);
  const framed = transformMesh(input.mesh, intoFrame);
  const minZ = soupBounds(framed.vertices).min[2];
  const cutZ = frame.planeZ - minZ;
  const ownDir = opts.workDir ? undefined : await createCutTempDir();
  const dir = opts.workDir ?? (ownDir as string);
  const timeoutMs = opts.timeoutMs ?? cutTimeoutMs();
  const inputFile = path.join(dir, 'input.stl');
  const outputFile = path.join(dir, 'cut.3mf');
  try {
    await fsp.writeFile(inputFile, writeBinaryStl(framed));
    const run = opts.run ?? runSlicer;
    const res = await run(
      ['--cut', String(cutZ), '--export-3mf', '--dont-arrange', '--no-ensure-on-bed', '--output', outputFile, inputFile],
      { timeoutMs },
    );
    if (res.code !== 0) throw new ValidationError(`cannot cut: ${cutFailureLine(res, timeoutMs)}`);
    const meshes = await readCutOutput(outputFile).catch(() => {
      throw new ValidationError(`cannot cut: ${cutFailureLine(res, timeoutMs)}`);
    });
    // the CLI exports every object standing on z = 0 (measured in the frame it cut in); the cut
    // frame puts the plane back where the user's plane is
    const up = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, minZ, 1];
    const placed = meshes.map((mesh) => transformMesh(mesh, up));
    const keep = input.keep ?? 'both';
    const parts = splitParts(placed, frame.planeZ)
      .filter((p) => keep === 'both' || p.side === keep)
      .map((p) => ({ side: p.side, ...ownCoordinates(placePart(p, frame, input)) }));
    return { parts };
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
