import type { ParsedGcode } from './types';

/** Preview colour schemes ("View" in PrusaSlicer's G-code preview). */
export type PreviewColorMode =
  | 'feature'
  | 'height'
  | 'width'
  | 'speed'
  | 'fan'
  | 'temperature'
  | 'flow'
  | 'layertime'
  | 'layertimelog'
  | 'tool'
  | 'colorprint';

export const COLOR_MODES: { id: PreviewColorMode; label: string }[] = [
  { id: 'feature', label: 'Feature type' },
  { id: 'height', label: 'Height (mm)' },
  { id: 'width', label: 'Width (mm)' },
  { id: 'speed', label: 'Speed (mm/s)' },
  { id: 'fan', label: 'Fan speed (%)' },
  { id: 'temperature', label: 'Temperature (°C)' },
  { id: 'flow', label: 'Volumetric flow rate (mm³/s)' },
  { id: 'layertime', label: 'Layer time (linear)' },
  { id: 'layertimelog', label: 'Layer time (logarithmic)' },
  { id: 'tool', label: 'Tool' },
  { id: 'colorprint', label: 'Color print' },
];

interface RangeScheme {
  decimals: number;
  /** one value per layer instead of per segment */
  perLayer?: boolean;
  log?: boolean;
  values: (g: ParsedGcode) => Float32Array;
}

export const RANGE_SCHEMES: Partial<Record<PreviewColorMode, RangeScheme>> = {
  height: { decimals: 2, values: (g) => g.height },
  width: { decimals: 3, values: (g) => g.width },
  speed: { decimals: 0, values: (g) => g.speed },
  fan: { decimals: 0, values: (g) => g.fan },
  temperature: { decimals: 0, values: (g) => g.temperature },
  flow: { decimals: 2, values: (g) => g.flow },
  layertime: { decimals: 1, perLayer: true, values: (g) => g.layerTime },
  layertimelog: { decimals: 1, perLayer: true, log: true, values: (g) => g.layerTime },
};

/** The blue → green → yellow → red gradient of PrusaSlicer's range legends. */
const RANGE_COLORS: [number, number, number][] = [
  [0.043, 0.173, 0.478],
  [0.075, 0.349, 0.522],
  [0.11, 0.533, 0.569],
  [0.016, 0.839, 0.059],
  [0.667, 0.949, 0.0],
  [0.988, 0.975, 0.012],
  [0.961, 0.808, 0.039],
  [0.89, 0.533, 0.125],
  [0.82, 0.408, 0.188],
  [0.761, 0.322, 0.235],
  [0.581, 0.149, 0.087],
];
export const RANGE_STEPS = RANGE_COLORS.length;

/** Colour at position t ∈ [0, 1] of the gradient. */
export function rangeColor(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (RANGE_COLORS.length - 1);
  const i = Math.min(RANGE_COLORS.length - 2, Math.floor(x));
  const f = x - i;
  const a = RANGE_COLORS[i];
  const b = RANGE_COLORS[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export const rgbCss = ([r, g, b]: [number, number, number]) =>
  `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;

/** Min/max of a scheme (layer times: only layers that take time; log scale: only positive values). */
export function schemeRange(g: ParsedGcode, mode: PreviewColorMode): [number, number] {
  const s = RANGE_SCHEMES[mode];
  if (!s) return [0, 0];
  const values = s.values(g);
  // layers that only hold start G-code moves (purge line: "Custom"/"Unknown") would squash the layer time scale
  const realLayer = (l: number) => {
    for (let i = g.layerStart[l]; i < g.layerStart[l + 1]; i++) {
      const t = g.featureTypes[g.types[i]];
      if (t !== 'Custom' && t !== 'Unknown') return true;
    }
    return false;
  };
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v) || ((s.perLayer || s.log) && v <= 0)) continue;
    if (s.perLayer && !realLayer(i)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return Number.isFinite(min) ? [min, max] : [0, 0];
}

/** Position of value v in the range, 0 … 1. */
export function rangePosition(v: number, [min, max]: [number, number], log = false): number {
  if (max <= min) return 0.5;
  if (log) {
    if (v <= 0 || min <= 0) return 0;
    return (Math.log(v) - Math.log(min)) / (Math.log(max) - Math.log(min));
  }
  return (v - min) / (max - min);
}

/** Legend entries from the top (max) to the bottom (min), like PrusaSlicer. */
export function legendSteps([min, max]: [number, number], log = false): { value: number; color: string }[] {
  if (max <= min) return [{ value: min, color: rgbCss(rangeColor(0.5)) }];
  const out: { value: number; color: string }[] = [];
  for (let i = RANGE_STEPS - 1; i >= 0; i--) {
    const t = i / (RANGE_STEPS - 1);
    const value = log ? Math.exp(Math.log(min) + t * (Math.log(max) - Math.log(min))) : min + t * (max - min);
    out.push({ value, color: rgbCss(rangeColor(t)) });
  }
  return out;
}
