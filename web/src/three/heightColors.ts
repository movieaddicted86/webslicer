/**
 * Layer height colouring of the plater (T-045): an object with a variable layer height profile is drawn
 * in the preview's height gradient, so the thin and thick bands are visible before slicing. The gradient
 * itself is the preview's (`gcode/colorschemes.ts`), normalised over the printer's layer height limits.
 */
import { profileHeightAt, type LayerLimits } from '@webslicer/shared';
import { rangeColor } from '../gcode/colorschemes';

/**
 * One RGB colour per vertex of a triangle soup, from the layer height the profile gives at the vertex's
 * Z. `undefined` without a profile. The gradient runs from the printer's minimum (blue) to its maximum
 * (red), so a profile that only uses a narrow band still shows the difference.
 */
export function layerHeightColors(
  positions: ArrayLike<number>,
  profile: number[] | undefined,
  limits: LayerLimits,
): Float32Array | undefined {
  if (!profile?.length) return undefined;
  const span = Math.max(1e-6, limits.max - limits.min);
  const n = Math.floor(positions.length / 3);
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const z = positions[i * 3 + 2];
    const h = profileHeightAt(profile, z);
    const t = h === undefined ? 0.5 : (h - limits.min) / span;
    const [r, g, b] = rangeColor(t);
    out[i * 3] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
  }
  return out;
}
