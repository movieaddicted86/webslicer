import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { AMFLoader } from 'three/examples/jsm/loaders/AMFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { api } from '../api';

interface LoadedModel {
  name: string;
  geometry: THREE.BufferGeometry;
}

/** `step`/`stp` are converted by the server (`POST /api/convert/step`) and then load like an STL. */
export const SUPPORTED_EXTENSIONS = ['stl', 'obj', '3mf', 'amf', 'step', 'stp'];

function collectMeshes(root: THREE.Object3D, baseName: string, splitObjects: boolean): LoadedModel[] {
  root.updateMatrixWorld(true);
  const out: LoadedModel[] = [];
  const geoms: THREE.BufferGeometry[] = [];
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    let g = mesh.geometry.clone();
    if (g.getIndex()) g = g.toNonIndexed();
    for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
    g.applyMatrix4(mesh.matrixWorld);
    if (splitObjects) {
      out.push({ name: mesh.name || child.parent?.name || `${baseName} (${out.length + 1})`, geometry: g });
    } else geoms.push(g);
  });
  if (!splitObjects && geoms.length) {
    const merged = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false);
    if (merged) out.push({ name: baseName, geometry: merged });
  }
  return out;
}

/**
 * Split a non-indexed geometry into sub-geometries by triangle ranges [first, last] (inclusive).
 * Used to restore PrusaSlicer volumes (parts, modifiers…) from a 3MF object mesh.
 */
export function splitGeometryByRanges(geometry: THREE.BufferGeometry, ranges: Array<[number, number]>): THREE.BufferGeometry[] {
  const g = geometry.getIndex() ? geometry.toNonIndexed() : geometry;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const arr = pos.array as Float32Array;
  return ranges.map(([first, last]) => {
    const start = Math.max(0, first) * 9;
    const end = Math.min(pos.count / 3 - 1, last) * 9 + 9;
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(arr.slice(start, Math.max(start, end)), 3));
    out.computeVertexNormals();
    return out;
  });
}

/**
 * One geometry per `<build><item>` of a 3MF file, in build order, with that item's transform baked in.
 * `loadModelFile` flattens all items into a list of meshes, which loses the item boundaries a project
 * import needs to restore instances. A composite item contributes one merged geometry.
 */
export function load3mfBuildItems(buf: ArrayBuffer): THREE.BufferGeometry[] {
  const group = new ThreeMFLoader().parse(buf);
  group.rotation.set(0, 0, 0);
  group.updateMatrixWorld(true);
  const out: THREE.BufferGeometry[] = [];
  for (const child of group.children) {
    const geoms = collectMeshes(child, 'item', true).map((m) => m.geometry);
    const merged = geoms.length === 1 ? geoms[0] : geoms.length ? mergeGeometries(geoms, false) : undefined;
    if (merged) out.push(merged);
  }
  return out;
}

/** A binary STL buffer as one geometry (only the positions survive: the plater rebuilds normals). */
function stlModel(buf: ArrayBuffer, name: string): LoadedModel {
  const g = new STLLoader().parse(buf);
  for (const attr of Object.keys(g.attributes)) if (attr !== 'position') g.deleteAttribute(attr);
  return { name, geometry: g };
}

/** Load a model file into one or more geometries (Z-up, millimeters). */
export async function loadModelFile(file: File): Promise<LoadedModel[]> {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const base = file.name.replace(/\.[^.]+$/, '');
  const buf = await file.arrayBuffer();
  switch (ext) {
    case 'stl':
      return [stlModel(buf, base)];
    case 'step':
    case 'stp': {
      // T-009: the CLI reads STEP, the browser does not – the server converts it to a binary STL
      const stl = await api.convertStep(buf, file.name);
      return [stlModel(stl, base)];
    }
    case 'obj': {
      const text = new TextDecoder().decode(buf);
      const group = new OBJLoader().parse(text);
      // OBJ is commonly Y-up; keep as-is (PrusaSlicer also loads raw coordinates).
      return collectMeshes(group, base, false);
    }
    case '3mf': {
      const group = new ThreeMFLoader().parse(buf);
      // three's 3MF loader rotates to Y-up: undo it so Z stays up like in the file.
      group.rotation.set(0, 0, 0);
      group.updateMatrixWorld(true);
      const models = collectMeshes(group, base, true);
      return models.length ? models : [];
    }
    case 'amf': {
      const group = new AMFLoader().parse(buf);
      return collectMeshes(group, base, true);
    }
    default:
      throw new Error(`Unsupported file type .${ext}`);
  }
}
