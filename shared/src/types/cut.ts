/**
 * The cut tool's API types (T-044). The cutting itself runs on the server with the PrusaSlicer CLI;
 * the browser only sends the model, the placement of the instance and the plane, and gets the two
 * parts back as new models (already at their world positions, or placed on the cut face).
 */
import type { Vec3 } from './common.js';

/** The parts the user keeps; a missing side comes back empty. */
export type CutKeep = 'both' | 'upper' | 'lower';

/** `POST /api/cut`: cut one instance of a model with a plane. */
export interface CutRequest {
  /** the uploaded model (object coordinates) */
  modelId: string;
  /** the instance's world matrix (column-major 4x4) */
  transform: number[];
  /** the cut plane in world coordinates */
  plane: { point: Vec3; normal: Vec3 };
  keep: CutKeep;
  /** "Place on cut": the cut face of every kept part goes onto the bed */
  placeOnCut?: boolean;
  /** "Flip upper part": turn the upper part over about the cut plane */
  flipUpper?: boolean;
}

/** One part the server cut out of the model. */
export interface CutPart {
  modelId: string;
  name: string;
  /**
   * Where the part's own origin (X/Y centre, bottom) sits in the world. The stored model is in the
   * part's own coordinates – the same convention as an uploaded model plus its instance placement –
   * so a slice request adds exactly one transform.
   */
  position: Vec3;
}

/** The answer of `POST /api/cut`; a side the plane does not leave any material of is absent. */
export interface CutResult {
  upper?: CutPart;
  lower?: CutPart;
}
