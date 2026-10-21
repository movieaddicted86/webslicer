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

/** `1m 02s` – the layer time labels of the range legend. */
export function fmtLayerTime(s: number) {
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`;
}

/** PrusaSlicer's feature legend: `1h 02m`, `3m 10s`, `8.4 s`. */
export function fmtFeatureTime(s: number) {
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`;
  return `${s.toFixed(1)}s`;
}

export const sumTimes = (t: Record<string, number>) => Object.values(t).reduce((a, b) => a + b, 0);

/** `1h 02m 3s` for the sliced info table. */
export function fmtTime(s?: number) {
  if (!s) return '–';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h ? `${h}h ${m}m ${sec}s` : m ? `${m}m ${sec}s` : `${sec}s`;
}
