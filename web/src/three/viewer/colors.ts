/**
 * The palette of the plater (R-7): the object colours, the per-extruder colours and the sub-volume
 * colours. Moved out of `Viewer.tsx` verbatim; `Viewer.tsx` re-exports `VOLUME_COLORS`.
 */
import type { VolumeType } from '../../api';
import { DEFAULT_COLOR, EXTRUDER_COLORS } from '../../palette';

/** The extruder palette lives in `palette.ts` (F-21) and is re-exported here for the plater code. */
export { EXTRUDER_COLORS };
export const OBJECT_COLOR = DEFAULT_COLOR;
export const SELECTED_COLOR = 0x6fb1ff;
export const OUTSIDE_COLOR = 0xd94f4f;

/** Colours of sub-volumes, close to PrusaSlicer's */
export const VOLUME_COLORS: Record<VolumeType, { color: number; opacity: number }> = {
  ModelPart: { color: DEFAULT_COLOR, opacity: 1 },
  ParameterModifier: { color: 0xffe14d, opacity: 0.45 },
  SupportEnforcer: { color: 0x4d6bff, opacity: 0.45 },
  SupportBlocker: { color: 0xff4d4d, opacity: 0.45 },
  NegativeVolume: { color: 0x707070, opacity: 0.45 },
};
