import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { AMFLoader } from 'three/examples/jsm/loaders/AMFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface LoadedModel {
  name: string;
  geometry: THREE.BufferGeometry;
}

export const SUPPORTED_EXTENSIONS = ['stl', 'obj', '3mf', 'amf'];

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

/** Load a model file into one or more geometries (Z-up, millimeters). */
export async function loadModelFile(file: File): Promise<LoadedModel[]> {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const base = file.name.replace(/\.[^.]+$/, '');
  const buf = await file.arrayBuffer();
  switch (ext) {
    case 'stl': {
      const g = new STLLoader().parse(buf);
      for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
      return [{ name: base, geometry: g }];
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
