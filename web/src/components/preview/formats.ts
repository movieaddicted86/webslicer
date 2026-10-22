import type { CustomGcodeType } from '../../api';
import type { MarkerKind } from '../../gcode/types';

/** Labels of the custom G-code types (the marker list and the code list of the preview). */
export const CODE_LABEL: Record<CustomGcodeType, string> = {
  color_change: 'Color change',
  pause: 'Pause',
  custom: 'Custom G-code',
  template: 'Template',
  tool_change: 'Tool change',
};

/** Labels of the marker kinds below the preview (PrusaSlicer writes them into the G-code as comments). */
export const MARKER_LABEL: Record<MarkerKind, string> = {
  retract: 'Retractions',
  deretract: 'Deretractions',
  seam: 'Seams',
  wipe: 'Wipe',
  tool_change: 'Tool changes',
  color_change: 'Color changes',
};

/** Index of the layer printed at height z (layer heights come from the G-code ;Z: markers). */
export function layerIndexOfZ(layerZ: Float32Array, z: number): number {
  for (let i = 0; i < layerZ.length; i++) if (Math.abs(layerZ[i] - z) < 1e-3) return i;
  return -1;
}

export const sumTimes = (t: Record<string, number>) => Object.values(t).reduce((a, b) => a + b, 0);
