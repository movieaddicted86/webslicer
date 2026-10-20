/**
 * The plater's three.js geometry helpers (R-6): sizes, triangle counts, the frame offset a
 * normalized object was built with, one shell as a geometry of its own and the binary STL export
 * the server receives as the uploaded mesh.
 *
 * Everything here works on a `BufferGeometry` alone; the state layer keeps the object and volume
 * records and calls in. three.js types stay inside `web/src/three/` (guideline §2).
 */
import * as THREE from 'three';
import { shellPositions } from '../plater/split';

/** Base (unscaled) size of a mesh: the extent of its bounding box, computing it when needed. */
export function geometrySize(g: THREE.BufferGeometry): [number, number, number] {
  if (!g.boundingBox) g.computeBoundingBox();
  const bb = g.boundingBox!;
  return [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z];
}

/** Triangles of a mesh, indexed or not (the index decides, not the position count). */
export function triangleCount(g: THREE.BufferGeometry): number {
  return g.getIndex() ? g.getIndex()!.count / 3 : g.getAttribute('position').count / 3;
}

/**
 * Offset from the object's own coordinate frame to the plater frame of a normalized object
 * (geometry centred in X/Y, standing on Z = 0): the negative of the object origin in the frame the
 * geometry was imported in. `addObjects` centres a geometry by the same values, and `makeVolume`
 * derives a volume's position from its geometry, so a part built from a shell keeps its place.
 */
export function objectFrameOffset(o: { geometry: THREE.BufferGeometry }): [number, number, number] {
  if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
  const bb = o.geometry.boundingBox!;
  return [-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -bb.min.z];
}

/** One shell of a non-indexed mesh as a geometry of its own, in the object's coordinate frame. */
export function shellGeometry(positions: Float32Array, tris: Uint32Array): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(shellPositions(positions, tris), 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Export a BufferGeometry as binary STL */
export function geometryToStl(geometry: THREE.BufferGeometry): ArrayBuffer {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const index = geometry.getIndex();
  const triCount = index ? index.count / 3 : pos.count / 3;
  const buf = new ArrayBuffer(84 + triCount * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, triCount, true);
  let o = 84;
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3(),
    n = new THREE.Vector3();
  for (let i = 0; i < triCount; i++) {
    const ia = index ? index.getX(i * 3) : i * 3;
    const ib = index ? index.getX(i * 3 + 1) : i * 3 + 1;
    const ic = index ? index.getX(i * 3 + 2) : i * 3 + 2;
    a.fromBufferAttribute(pos, ia);
    b.fromBufferAttribute(pos, ib);
    c.fromBufferAttribute(pos, ic);
    n.copy(b).sub(a).cross(c.clone().sub(a)).normalize();
    dv.setFloat32(o, n.x, true);
    dv.setFloat32(o + 4, n.y, true);
    dv.setFloat32(o + 8, n.z, true);
    o += 12;
    for (const v of [a, b, c]) {
      dv.setFloat32(o, v.x, true);
      dv.setFloat32(o + 4, v.y, true);
      dv.setFloat32(o + 8, v.z, true);
      o += 12;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return buf;
}
