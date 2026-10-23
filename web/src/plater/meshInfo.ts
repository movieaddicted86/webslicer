/**
 * The plater's plain geometry readers (q4-web-store): sizes, triangle counts, the frame offset a
 * normalized object was built with, a triangle soup and the binary STL export the server receives as
 * the uploaded mesh.
 *
 * These work on any object with a position attribute and a bounding box, so they need no three.js
 * import and the store can call them. The constructors that do need three.js stay in `three/`.
 */

/** What a reader needs of a mesh: position attribute, optional index, bounds. */
export interface GeometryLike {
  boundingBox: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null;
  computeBoundingBox(): void;
  getIndex(): { count: number; getX(i: number): number } | null;
  getAttribute(name: 'position'): { count: number; array: ArrayLike<number> };
}

/** The bounding box of a geometry, computing it when needed; throws on a mesh without positions. */
function boundsOf(g: GeometryLike): NonNullable<GeometryLike['boundingBox']> {
  if (!g.boundingBox) g.computeBoundingBox();
  const bb = g.boundingBox;
  if (!bb) throw new Error('geometry has no bounding box');
  return bb;
}

/** Base (unscaled) size of a mesh: the extent of its bounding box, computing it when needed. */
export function geometrySize(g: GeometryLike): [number, number, number] {
  const bb = boundsOf(g);
  return [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z];
}

/** Triangles of a mesh, indexed or not (the index decides, not the position count). */
export function triangleCount(g: GeometryLike): number {
  const index = g.getIndex();
  return index ? index.count / 3 : g.getAttribute('position').count / 3;
}

/**
 * The mesh as a flat triangle soup (three vertices per triangle), whatever its indexing. The shared
 * measurement helpers (`meshStats`, `mergeParts`) expect soups, and loaded meshes already are ones.
 */
export function geometrySoup(g: GeometryLike): Float32Array {
  const src = g.getAttribute('position').array;
  const index = g.getIndex();
  if (!index) return src as Float32Array;
  const out = new Float32Array(index.count * 3);
  for (let i = 0; i < index.count; i++) {
    const v = index.getX(i);
    for (let c = 0; c < 3; c++) out[i * 3 + c] = src[v * 3 + c];
  }
  return out;
}

/**
 * Offset from the object's own coordinate frame to the plater frame of a normalized object
 * (geometry centred in X/Y, standing on Z = 0): the negative of the object origin in the frame the
 * geometry was imported in. `addObjects` centres a geometry by the same values, and `makeVolume`
 * derives a volume's position from its geometry, so a part built from a shell keeps its place.
 */
export function objectFrameOffset(o: { geometry: GeometryLike }): [number, number, number] {
  const bb = boundsOf(o.geometry);
  return [-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -bb.min.z];
}

/** Export a mesh as binary STL (84-byte header plus 50 bytes per triangle). */
export function geometryToStl(geometry: GeometryLike): ArrayBuffer {
  const pos = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const triCount = index ? index.count / 3 : pos.count / 3;
  const buf = new ArrayBuffer(84 + triCount * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, triCount, true);
  let o = 84;
  // scratch for the triangle and its normal, plain numbers (this module has no three.js vectors)
  let ax = 0,
    ay = 0,
    az = 0,
    bx = 0,
    by = 0,
    bz = 0,
    cx = 0,
    cy = 0,
    cz = 0;
  for (let i = 0; i < triCount; i++) {
    const ia = index ? index.getX(i * 3) : i * 3;
    const ib = index ? index.getX(i * 3 + 1) : i * 3 + 1;
    const ic = index ? index.getX(i * 3 + 2) : i * 3 + 2;
    ax = Number(pos.array[ia * 3]);
    ay = Number(pos.array[ia * 3 + 1]);
    az = Number(pos.array[ia * 3 + 2]);
    bx = Number(pos.array[ib * 3]);
    by = Number(pos.array[ib * 3 + 1]);
    bz = Number(pos.array[ib * 3 + 2]);
    cx = Number(pos.array[ic * 3]);
    cy = Number(pos.array[ic * 3 + 1]);
    cz = Number(pos.array[ic * 3 + 2]);
    // normal = (b - a) x (c - a), normalized
    const ux = bx - ax,
      uy = by - ay,
      uz = bz - az;
    const wx = cx - ax,
      wy = cy - ay,
      wz = cz - az;
    const nx = uy * wz - uz * wy;
    const ny = uz * wx - ux * wz;
    const nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz) || 1;
    dv.setFloat32(o, nx / len, true);
    dv.setFloat32(o + 4, ny / len, true);
    dv.setFloat32(o + 8, nz / len, true);
    o += 12;
    for (const [x, y, z] of [
      [ax, ay, az],
      [bx, by, bz],
      [cx, cy, cz],
    ]) {
      dv.setFloat32(o, x, true);
      dv.setFloat32(o + 4, y, true);
      dv.setFloat32(o + 8, z, true);
      o += 12;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return buf;
}
