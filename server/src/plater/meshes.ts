/**
 * Headless model import: STL and 3MF from the library, without a browser.
 *
 * STL: one model, placed by the identity matrix (an STL has no position of its own – the browser
 * behaves the same way).
 * 3MF: one model per `<object>` in `3D/3dmodel.model`, its mesh in object coordinates, and the
 * `<build><item>` transforms of that object as its instances. Modifiers, parts and paint are
 * **not** imported in this phase (chosen for T-005; see the report) – a 3MF object is taken as one
 * model part.
 */
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { parse3mfBuild, parseStl, type Mesh } from '../slicer/threemf/index.js';
import { assertZipReasonable, readZipEntryText } from '../slicer/threemf/zipLimits.js';
import { IDENTITY, type Matrix4 } from '@webslicer/shared';
import { ValidationError } from '../errors.js';

export interface LoadedModel {
  name: string;
  /** mesh in object coordinates (not yet normalised) */
  mesh: Mesh;
  /** instance transforms (column-major 4x4, includes the first); empty objects get the identity */
  instances: Matrix4[];
}

/** Read a model file by its extension (`.stl` or `.3mf`). */
export async function loadModelFile(file: string): Promise<LoadedModel[]> {
  const buf = fs.readFileSync(file);
  return loadModelBuffer(buf, path.basename(file));
}

/** Read a model from memory; `filename` only decides the format. */
export async function loadModelBuffer(buf: Buffer, filename: string): Promise<LoadedModel[]> {
  const ext = path.extname(filename).toLowerCase();
  const name = path.basename(filename, path.extname(filename)) || 'model';
  if (ext === '.stl') return [{ name, mesh: parseStl(buf), instances: [IDENTITY] }];
  if (ext === '.3mf') return read3mfMeshes(buf);
  throw new ValidationError(`Unsupported model format "${ext || filename}" (STL and 3MF only)`);
}

/** Value of an XML attribute inside a captured tag string. */
function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
}

/**
 * Meshes of a 3MF's objects. Every `<object>` with a `<mesh>` becomes one model; the build items
 * give its instances. Object ids and the document order are kept, like the browser's import.
 */
async function read3mfMeshes(buf: Buffer): Promise<LoadedModel[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch (e) {
    throw new ValidationError(`Cannot read 3MF: ${(e as Error).message}`);
  }
  // S7: an untrusted 3MF may not unpack a zip bomb – the central directory is checked first
  assertZipReasonable(zip);
  const modelFile = zip.file('3D/3dmodel.model');
  if (!modelFile) throw new ValidationError('3MF has no 3D/3dmodel.model');
  const model = await readZipEntryText(zip, '3D/3dmodel.model');
  const items = parse3mfBuild(model);
  const out: LoadedModel[] = [];
  // Split on the closing tag: the object that tag closes is the *last* opening tag in the chunk,
  // which keeps self-closing objects (components, no mesh) from swallowing the next object's mesh.
  for (const chunk of model.split(/<\/object>/)) {
    const at = chunk.lastIndexOf('<object');
    if (at < 0) continue;
    const open = /^<object\b([^>]*)>([\s\S]*)$/.exec(chunk.slice(at));
    if (!open) continue;
    const id = attr(open[1], 'id');
    if (!id) continue;
    const mesh = readMesh(open[2]);
    if (!mesh.indices.length) continue;
    const instances = items.filter((b) => b.objectId === id).map((b) => b.transform);
    out.push({ name: attr(open[1], 'name') || `Object ${id}`, mesh, instances: instances.length ? instances : [IDENTITY] });
  }
  if (!out.length) throw new ValidationError('3MF contains no mesh');
  return out;
}

/** Vertices and triangles of one `<mesh>` block. */
function readMesh(body: string): Mesh {
  const block = /<mesh\b[^>]*>([\s\S]*?)<\/mesh>/.exec(body)?.[1];
  if (!block) return { vertices: new Float32Array(0), indices: new Uint32Array(0) };
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
    // a triangle pointing outside the vertex list would corrupt the mesh downstream
    if (![a, b, c].every((i) => Number.isInteger(i) && i >= 0 && i < count)) continue;
    tris.push(a, b, c);
  }
  return { vertices: Float32Array.from(verts), indices: Uint32Array.from(tris) };
}
