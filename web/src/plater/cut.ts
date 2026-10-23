/**
 * The cut plane of the selected instance (T-044): where the user's Z slider and the two tilt angles put
 * it in the world, and how big to draw it. The plane is defined in the object's own frame (the object
 * stands on its own Z = 0, centred in X/Y), so the slider stays the object's height whatever the
 * instance scale or rotation is; the world plane is that frame through the instance matrix.
 *
 * The cutting itself runs on the server (`POST /api/cut`); this module only says what to send and what
 * to draw in the viewer.
 */
import { apply, invert, placementMatrix, unit, type Placement, type Vec3 } from '@webslicer/shared';

/** The cut panel's settings: a height in the object frame and two tilt angles in degrees. */
export interface CutSettings {
  /** height of the plane in the object frame (0 = the object's bottom) */
  z: number;
  /** tilt about the object's X axis, degrees */
  rotX: number;
  /** tilt about the object's Y axis, degrees */
  rotY: number;
  keep: 'both' | 'upper' | 'lower';
  /** the cut face of every kept part goes onto the bed */
  placeOnCut: boolean;
  /** turn the upper part over about the cut plane */
  flipUpper: boolean;
}

/** The default panel settings for an object of the given height: cut in the middle, no tilt. */
export function defaultCutSettings(height: number): CutSettings {
  return { z: +(height / 2).toFixed(2), rotX: 0, rotY: 0, keep: 'both', placeOnCut: false, flipUpper: false };
}

/** A plane in world coordinates: a point on it and its unit normal. */
export interface WorldPlane {
  point: Vec3;
  normal: Vec3;
}

/** The tilt rotation of the panel, in radians. */
function tiltMatrix(s: Pick<CutSettings, 'rotX' | 'rotY'>): number[] {
  const rad = Math.PI / 180;
  return placementMatrix({ position: [0, 0, 0], rotation: [s.rotX * rad, s.rotY * rad, 0], scale: [1, 1, 1] });
}

/**
 * The plane of the panel in world coordinates, for one instance. The plane runs through the object's
 * own X/Y centre (the geometry is normalised to that), so only the instance transform and the height
 * decide where it sits.
 */
export function cutPlaneWorld(inst: Placement, s: CutSettings): WorldPlane {
  const m = placementMatrix(inst);
  const nLocal = apply(tiltMatrix(s), 0, 0, 1);
  const point = apply(m, 0, 0, s.z);
  // a normal transforms with the inverse transpose; a mirrored instance must not flip the plane
  const inv = invert(m);
  let normal: Vec3 = nLocal;
  if (inv) {
    normal = [
      inv[0] * nLocal[0] + inv[1] * nLocal[1] + inv[2] * nLocal[2],
      inv[4] * nLocal[0] + inv[5] * nLocal[1] + inv[6] * nLocal[2],
      inv[8] * nLocal[0] + inv[9] * nLocal[1] + inv[10] * nLocal[2],
    ];
  }
  const n = unit(normal) ?? ([0, 0, 1] as Vec3);
  // the panel tilts from "level", so the normal always points upwards
  return { point, normal: n[2] < 0 ? [-n[0], -n[1], -n[2]] : n };
}
