/**
 * Whole-mesh measurements and object merge maths (T-042).
 *
 * A loaded mesh is a non-indexed triangle soup, so connectivity is rebuilt by welding equal positions
 * (the same grid `web/src/plater/split.ts` uses). Everything works on flat number arrays and is free
 * of three.js, so the server and the browser can both use it.
 */
import type { Bounds, Placement, Vec3 } from '../types/index.js';
import { apply, invert, multiply, placementFromMatrix, placementMatrix, type Matrix4 } from './matrix.js';

/** Welding grid in mm: two vertices whose coordinates round to the same cell are one vertex. */
export const WELD_GRID = 1e-4;

/** Grid cell key of a vertex. */
function cellKey(x: number, y: number, z: number): string {
  return `${Math.round(x / WELD_GRID)},${Math.round(y / WELD_GRID)},${Math.round(z / WELD_GRID)}`;
}

/**
 * Signed volume of a triangle soup (mm³): positive when the triangles face outwards.
 *
 * The sum does not depend on where the mesh sits, but float32 input far from the origin loses
 * precision – callers pass geometry in its own frame.
 */
export function meshVolume(positions: ArrayLike<number>): number {
  let volume = 0;
  const n = Math.floor(positions.length / 9);
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    const ax = positions[o],
      ay = positions[o + 1],
      az = positions[o + 2];
    const bx = positions[o + 3],
      by = positions[o + 4],
      bz = positions[o + 5];
    const cx = positions[o + 6],
      cy = positions[o + 7],
      cz = positions[o + 8];
    volume += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return volume / 6;
}

/**
 * Open (boundary) edges of a triangle soup: every undirected edge of the welded mesh that fewer than
 * two triangles use. A closed cube has none; a cube with one face removed has the four edges around
 * the hole.
 */
export function openEdgeCount(positions: ArrayLike<number>): number {
  const triCount = Math.floor(positions.length / 9);
  if (!triCount) return 0;
  // weld first, then count every undirected edge by its welded vertex ids
  const ids = new Map<string, number>();
  const corner = new Uint32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const o = t * 9 + k * 3;
      const key = cellKey(positions[o], positions[o + 1], positions[o + 2]);
      let id = ids.get(key);
      if (id === undefined) {
        id = ids.size;
        ids.set(key, id);
      }
      corner[t * 3 + k] = id;
    }
  }
  const uses = new Map<string, number>();
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const a = corner[t * 3 + k];
      const b = corner[t * 3 + ((k + 1) % 3)];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const count of uses.values()) if (count < 2) open++;
  return open;
}

/** The measurements of the object info panel (T-042); `volume` is in mm³ and may be negative. */
export interface MeshStats {
  volume: number;
  openEdges: number;
  triangles: number;
}

/** Volume, open edges and triangle count of one triangle soup. */
export function meshStats(positions: ArrayLike<number>): MeshStats {
  return { volume: meshVolume(positions), openEdges: openEdgeCount(positions), triangles: Math.floor(positions.length / 9) };
}

/** Copy a triangle soup through a matrix (`M · v` per vertex): the world form the merge works in. */
export function transformSoup(positions: ArrayLike<number>, matrix: Matrix4): Float64Array {
  const vertexCount = Math.floor(positions.length / 3);
  const out = new Float64Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    const p = apply(matrix, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    out[i * 3] = p[0];
    out[i * 3 + 1] = p[1];
    out[i * 3 + 2] = p[2];
  }
  return out;
}

/** Bounding box of a flat xyz soup; an empty soup is a point at the origin. */
export function soupBounds(positions: ArrayLike<number>): Bounds {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  if (!Number.isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

/** One merged object expressed from another object's frame: a new ModelPart volume (T-042). */
export interface MergedVolume {
  /** the volume's own mesh, centred on the origin of its frame */
  vertices: Float64Array;
  /** placement of the volume inside the target object */
  placement: Placement;
}

/**
 * The volume that carries `source` inside the object `target`, both given by their world matrices and
 * the source mesh in its own object frame (T-042 merge).
 *
 * The source mesh is moved into the target's frame, centred on the origin there and placed back by the
 * centre – so `M_target · T(centre)` puts every vertex where the source had it in the world.
 * `undefined` when the target transform cannot be inverted (a zero scale).
 */
export function mergedVolume(targetInstance: Matrix4, sourceInstance: Matrix4, sourceMesh: ArrayLike<number>): MergedVolume | undefined {
  const toTarget = invert(targetInstance);
  if (!toTarget) return undefined;
  const local = transformSoup(sourceMesh, multiply(toTarget, sourceInstance));
  const box = soupBounds(local);
  const centre: Vec3 = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
  for (let i = 0; i < local.length; i += 3) {
    local[i] -= centre[0];
    local[i + 1] -= centre[1];
    local[i + 2] -= centre[2];
  }
  // the volume is centred on its own origin, so its placement is the centre in the target's frame
  return { vertices: local, placement: { position: centre, rotation: [0, 0, 0], scale: [1, 1, 1] } };
}

/**
 * Placement of a sub-volume of the source object inside the target object, once the source object is
 * merged away: `M_target⁻¹ · M_source · M_volume`, decomposed back to a placement.
 */
export function transferredVolumePlacement(
  targetInstance: Matrix4,
  sourceInstance: Matrix4,
  volumePlacement: Pick<Placement, 'position' | 'rotation' | 'scale'>,
): Placement | undefined {
  const toTarget = invert(targetInstance);
  if (!toTarget) return undefined;
  return placementFromMatrix(multiply(multiply(toTarget, sourceInstance), placementMatrix(volumePlacement)));
}
