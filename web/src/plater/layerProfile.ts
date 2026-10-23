/**
 * The variable layer height panel's model (T-045): the settings of the panel, the printer's layer
 * height limits and the chart geometry. The algorithms themselves are pure functions in
 * `@webslicer/shared` (`plater/layerProfile.ts`); this module only says what the UI needs around them.
 */
import { layerHeightLimits, type LayerLimits } from '@webslicer/shared';

/** The panel's own settings – everything that is not part of the profile itself. */
export interface ProfileSettings {
  /** Adaptive quality slider: 0 = finest, 1 = fastest */
  quality: number;
  /** Smooth radius in mm */
  radius: number;
  /** Smooth keeps local minima */
  keepMin: boolean;
  /** The brush: radius in mm and step per drag (mm of layer height, +/-) */
  brushRadius: number;
  brushDelta: number;
}

export const DEFAULT_PROFILE_SETTINGS: ProfileSettings = {
  quality: 0.5,
  radius: 1,
  keepMin: true,
  brushRadius: 2,
  brushDelta: 0.02,
};

/**
 * The layer height limits of the current printer and print profile. `min_layer_height` /
 * `max_layer_height` are per extruder in PrusaSlicer; the plater only has one nozzle per extruder and
 * the first value is the one a single-nozzle print uses. `0` means "automatic" (a factor of the
 * nozzle diameter) – `layerHeightLimits` of the shared module applies that rule.
 */
export function printerLayerLimits(printer: Record<string, string>): LayerLimits {
  const first = (v: string | undefined) => {
    const n = Number((v || '').split(/[,;]/)[0]);
    return Number.isFinite(n) ? n : 0;
  };
  const nozzle = first(printer.nozzle_diameter) || 0.4;
  return layerHeightLimits(nozzle, first(printer.min_layer_height), first(printer.max_layer_height));
}

/** A point of the chart in panel coordinates (Z up the Y axis, layer height along X), SVG units. */
export interface ChartPoint {
  z: number;
  height: number;
  x: number;
  y: number;
}

/** The chart's drawing area and the axis limits. */
export interface ChartFrame {
  points: ChartPoint[];
  /** the Z range the chart shows (the object height) */
  zMax: number;
  /** the height range the chart shows (the printer limits, rounded outwards) */
  heightMin: number;
  heightMax: number;
  width: number;
  height: number;
  pad: number;
}

/**
 * Lay a profile out for the SVG chart: Z runs bottom to top on the Y axis, the layer height runs left
 * to right on the X axis (the task's "Z up, height right"). The height axis always covers the printer
 * limits, so a thin profile visibly sits at the left and a thick one at the right.
 */
export function chartFrame(profile: number[], limits: LayerLimits, zMax: number, width = 160, height = 200, pad = 8): ChartFrame {
  const hMin = 0;
  const hMax = Math.max(limits.max, 0.01);
  const zTop = Math.max(zMax, 0.01);
  const points: ChartPoint[] = [];
  const n = Math.floor(profile.length / 2);
  const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
  for (let i = 0; i < n; i++) {
    const z = profile[i * 2];
    const h = profile[i * 2 + 1];
    points.push({
      z,
      height: h,
      x: pad + (width - 2 * pad) * clamp01((h - hMin) / (hMax - hMin)),
      y: pad + (height - 2 * pad) * (1 - clamp01(z / zTop)),
    });
  }
  return { points, zMax: zTop, heightMin: hMin, heightMax: hMax, width, height, pad };
}
