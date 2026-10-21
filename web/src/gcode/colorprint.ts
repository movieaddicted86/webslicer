import type { CustomGcode } from '../api';
import { DEFAULT_COLOR_CSS } from '../palette';

export interface ColorSegment {
  color: string;
  fromZ: number;
  toZ: number;
}

/** Normalise a filament colour value ('#FF8000', '"#FF8000"', 'FF8000;#00FF00') to '#rrggbb'. */
export function normalizeColor(value: string | undefined, fallback = DEFAULT_COLOR_CSS): string {
  if (!value) return fallback;
  const first = value.replace(/"/g, '').split(';')[0].trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(first);
  return m ? `#${m[1].toLowerCase()}` : fallback;
}

/** Colour segments over the print height caused by colour changes (like PrusaSlicer's "Color Print" legend). */
export function colorPrintSegments(baseColor: string, codes: CustomGcode[], maxZ: number): ColorSegment[] {
  const changes = codes.filter((c) => c.type === 'color_change').sort((a, b) => a.printZ - b.printZ);
  const out: ColorSegment[] = [];
  let from = 0;
  let color = baseColor;
  for (const c of changes) {
    out.push({ color, fromZ: from, toZ: c.printZ });
    from = c.printZ;
    color = normalizeColor(c.color, color);
  }
  out.push({ color, fromZ: from, toZ: Math.max(from, maxZ) });
  return out;
}

/** Colour of the toolpaths of a layer at height z. */
export function colorAtZ(z: number, baseColor: string, codes: CustomGcode[]): string {
  let color = baseColor;
  for (const c of codes) {
    if (c.type !== 'color_change') continue;
    if (z >= c.printZ - 1e-4) color = normalizeColor(c.color, color);
  }
  return color;
}

/** Next colour suggestion for a new colour change (different from the colour currently printed there). */
const PALETTE = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00', '#00acc1', '#f5f5f5', '#212121'];
export function suggestColor(current: string): string {
  return PALETTE.find((p) => p.toLowerCase() !== current.toLowerCase()) ?? PALETTE[0];
}
