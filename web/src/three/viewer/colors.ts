/**
 * The palette of the plater (R-7): the object colours, the per-extruder colours and the sub-volume
 * colours. Moved out of `Viewer.tsx` verbatim; `Viewer.tsx` re-exports `VOLUME_COLORS`.
 */
import type { VolumeType } from '../../api';

export const OBJECT_COLOR = 0xe6b84a;
export const SELECTED_COLOR = 0x6fb1ff;
export const OUTSIDE_COLOR = 0xd94f4f;
export const EXTRUDER_COLORS = [0xe6b84a, 0x73c2fb, 0xd96fd9, 0x84d08a, 0xf09b59, 0xa9a9f5];

/** Colours of sub-volumes, close to PrusaSlicer's */
export const VOLUME_COLORS: Record<VolumeType, { color: number; opacity: number }> = {
  ModelPart: { color: 0xe6b84a, opacity: 1 },
  ParameterModifier: { color: 0xffe14d, opacity: 0.45 },
  SupportEnforcer: { color: 0x4d6bff, opacity: 0.45 },
  SupportBlocker: { color: 0xff4d4d, opacity: 0.45 },
  NegativeVolume: { color: 0x707070, opacity: 0.45 },
};
