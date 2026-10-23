/**
 * The variable layer height profile (T-045): PrusaSlicer's per-object list of (z, layer height) pairs,
 * its adaptive and smoothing algorithms, the manual brush, and the 3MF file that carries it.
 *
 * The algorithms follow PrusaSlicer's `SlicingAdaptive.cpp` (the surface-error variant that is active in
 * 2.8/2.9) and `LayerHeightProfile.cpp`, reduced to what the plater needs:
 *
 * - a profile is a flat array of pairs `[z0, h0, z1, h1, …]`: printing starts at `z0` with height `h0`,
 *   the next layer starts at `z1`, and so on (PrusaSlicer's own in-memory layout);
 * - `z` is the object's own Z axis (the object stands on z = 0, the plater's `ranges` use the same
 *   frame), so a profile survives moving, rotating and scaling the object;
 * - every height stays inside the printer's limits (`min_layer_height` / `max_layer_height`, falling
 *   back to 25 % / 75 % of the nozzle diameter – PrusaSlicer's rule for the "0 = automatic" default).
 *
 * PrusaSlicer stores the profile in `Metadata/Slic3r_PE_layer_heights_profile.txt` of the 3MF, one line
 * per object, `object_id=<1-based id>|<z>;<h>;<z>;<h>;…` with six decimals (verified against the
 * PrusaSlicer 2.8.1 source: `LAYER_HEIGHTS_PROFILE_FILE` in `Format/3mf.cpp` and its reader/exporter).
 *
 * When an object has both a layer height profile and height ranges, the profile wins for the layer
 * height (PrusaSlicer applies the profile to the whole object and derives the layer boundaries from it);
 * the other settings of a range still apply in their Z band.
 */
/** Lower/upper bound of a layer height in mm. */
export interface LayerLimits {
  min: number;
  max: number;
}

/** PrusaSlicer's automatic limits: 25 % / 75 % of the nozzle diameter when the option is 0. */
export const LAYER_HEIGHT_FACTOR_MIN = 0.25;
export const LAYER_HEIGHT_FACTOR_MAX = 0.75;

/**
 * The layer height limits of a printer: the configured values, and the nozzle-factor default for a 0
 * (PrusaSlicer treats `min_layer_height = 0` / `max_layer_height = 0` as "automatic"). Always a usable
 * interval: a max below the min is raised to the min.
 */
export function layerHeightLimits(nozzleDiameter: number, minLayerHeight: number, maxLayerHeight: number): LayerLimits {
  const nozzle = nozzleDiameter > 0 ? nozzleDiameter : 0.4;
  const min = minLayerHeight > 0 ? minLayerHeight : nozzle * LAYER_HEIGHT_FACTOR_MIN;
  const configuredMax = maxLayerHeight > 0 ? maxLayerHeight : nozzle * LAYER_HEIGHT_FACTOR_MAX;
  const max = Math.max(min, configuredMax);
  return { min: +min.toFixed(4), max: +max.toFixed(4) };
}

/** Clamp one layer height into the limits; a missing/invalid height becomes `limits.min`. */
export function clampLayerHeight(h: number, limits?: LayerLimits): number {
  if (!Number.isFinite(h)) return limits ? limits.min : 0;
  if (!limits) return h;
  return Math.min(limits.max, Math.max(limits.min, h));
}

/** A triangle soup with an optional index list – everything the adaptive algorithm reads. */
export interface ProfileMesh {
  /** flat xyz, three values per vertex */
  positions: ArrayLike<number>;
  /** triangle indices into `positions`; absent means a non-indexed soup (three per triangle) */
  indices?: ArrayLike<number> | null;
}

/** One facet of the mesh in the form the adaptive algorithm needs. */
interface Facet {
  /** lower/upper end of the facet's Z span */
  z0: number;
  z1: number;
  /** |n.z| – 1 for a horizontal facet, 0 for a vertical wall */
  nCos: number;
  /** sqrt(n.x² + n.y²) – the "lateral" part of the normal */
  nSin: number;
  /** the facet has no Z span (a flat top or bottom) */
  horizontal: boolean;
}

/** The facets of a mesh: unit normal, Z span and the two normal components per triangle. */
export function profileFacets(mesh: ProfileMesh): Facet[] {
  const p = mesh.positions;
  const idx = mesh.indices;
  const triCount = idx ? Math.floor(idx.length / 3) : Math.floor(p.length / 9);
  const facets: Facet[] = [];
  for (let t = 0; t < triCount; t++) {
    const a = idx ? idx[t * 3] * 3 : t * 9;
    const b = idx ? idx[t * 3 + 1] * 3 : t * 9 + 3;
    const c = idx ? idx[t * 3 + 2] * 3 : t * 9 + 6;
    if (![a, b, c].every((i) => i + 2 < p.length)) continue;
    const ax = p[a],
      ay = p[a + 1],
      az = p[a + 2];
    const ux = p[b] - ax,
      uy = p[b + 1] - ay,
      uz = p[b + 2] - az;
    const vx = p[c] - ax,
      vy = p[c + 1] - ay,
      vz = p[c + 2] - az;
    // n = u × v, normalized
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (!(len > 1e-12) || !Number.isFinite(len)) continue;
    nx /= len;
    ny /= len;
    nz /= len;
    const zs = [az, p[b + 2], p[c + 2]];
    const z0 = Math.min(...zs);
    const z1 = Math.max(...zs);
    facets.push({
      z0,
      z1,
      nCos: Math.abs(nz),
      nSin: Math.hypot(nx, ny),
      // a facet whose corners share a height is a flat top or bottom
      horizontal: z1 - z0 < 1e-6,
    });
  }
  return facets;
}

/**
 * The allowed surface deviation of a quality slider position (0 = best quality, 1 = fastest), as
 * PrusaSlicer's `next_layer_height` computes it: below 0.5 it interpolates from the minimum layer
 * height to the nominal one, above from the maximum to the nominal.
 */
export function surfaceDeviation(quality: number, limits: LayerLimits, nominal?: number): number {
  const mid = nominal && nominal > 0 ? Math.min(limits.max, Math.max(limits.min, nominal)) : (limits.min + limits.max) / 2;
  const q = Math.min(1, Math.max(0, Number.isFinite(quality) ? quality : 0.5));
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  return q < 0.5 ? lerp(limits.min, mid, 2 * q) : lerp(limits.max, mid, 2 * (1 - q));
}

/** PrusaSlicer's facet height from its slope: the base term, and the slope term for non-horizontal facets. */
function facetHeight(facet: Facet, deviation: number): number {
  const base = deviation / 0.184;
  if (facet.nCos <= 1e-5) return base;
  return Math.min(base, 1.44 * deviation * Math.sqrt(facet.nSin / facet.nCos));
}

/** Hard cap on the profile length: a runaway loop must not fill memory (a 200 mm object at 0.05 mm has 4000). */
const MAX_PROFILE_SAMPLES = 20_000;

/**
 * The adaptive layer height profile of a mesh (PrusaSlicer's "Adaptive" button).
 *
 * `quality` runs 0 (finest) to 1 (fastest); `minH`/`maxH` are the printer's limits and `nominal` the
 * print profile's layer height (the middle of the quality curve). The algorithm walks up the object's Z
 * axis and, for every layer, takes the smallest height that any facet intersecting that layer allows –
 * a steep facet (normal pointing sideways) allows thick layers, a flat one thin layers. A second pass
 * shortens a layer so a facet that starts inside it is not buried under the next layer, and a flat top
 * or bottom pulls the next layer boundary onto itself.
 *
 * Returns PrusaSlicer's flat pair layout `[z0, h0, z1, h1, …]`, empty for a mesh without facets or a
 * non-positive maximum. Like `layer_height_profile_adaptive` (`Slicing.cpp`), the profile always ends
 * with a pair whose `z` is the object's top: `PrintObject::update_layer_height_profile` discards a
 * profile whose second-to-last value is not within 1e-3 mm of the top, and slices the object with a
 * fixed layer height instead. The height of that last pair is the remaining gap, clamped to the limits.
 */
export function adaptiveProfile(mesh: ProfileMesh, quality: number, minH: number, maxH: number, nominal?: number): number[] {
  const limits: LayerLimits = { min: Math.max(1e-4, minH), max: Math.max(1e-4, maxH) };
  if (!(limits.max > 0)) return [];
  const facets = profileFacets(mesh);
  if (!facets.length) return [];
  const zMin = facets.reduce((m, f) => Math.min(m, f.z0), Infinity);
  const zMax = facets.reduce((m, f) => Math.max(m, f.z1), -Infinity);
  if (!(zMax > zMin)) return [];
  const deviation = surfaceDeviation(quality, limits, nominal);
  const eps = 1e-7;
  const pairs: number[] = [];
  let z = zMin;
  for (let guard = 0; guard < MAX_PROFILE_SAMPLES && z < zMax - eps; guard++) {
    let h = Infinity;
    for (const f of facets) {
      // facets touching the layer base count; a facet that only ends there is above the layer
      if (f.horizontal) continue;
      if (z < f.z0 - eps || z >= f.z1 - eps) continue;
      h = Math.min(h, facetHeight(f, deviation));
    }
    // a flat facet above the layer: its boundary is the natural layer boundary
    for (const f of facets) {
      if (!f.horizontal) continue;
      const d = f.z0 - z;
      if (d > eps && d < h) h = d;
    }
    if (!Number.isFinite(h)) h = limits.max;
    // correction: a facet starting inside this layer must be the base of the next one
    for (const f of facets) {
      if (f.horizontal) continue;
      const d = f.z0 - z;
      if (d <= eps || d >= h) continue;
      if (facetHeight(f, deviation) < d) h = d;
    }
    h = clampLayerHeight(h, limits);
    if (!(h > eps)) break;
    pairs.push(+z.toFixed(6), +h.toFixed(6));
    z += h;
  }
  if (pairs.length) {
    // PrusaSlicer's terminator: the last pair sits exactly at the object top (the gap left by the loop
    // is its height; a layer above the top is simply clipped when the layers are generated)
    const lastZ = pairs[pairs.length - 2];
    const gap = zMax - lastZ;
    if (gap > 0) pairs.push(+zMax.toFixed(6), +clampLayerHeight(gap, limits).toFixed(6));
    else if (lastZ > zMax) pairs[pairs.length - 2] = +zMax.toFixed(6);
  }
  return pairs;
}

/** The number of pairs of a flat profile (defensive: an odd list keeps the complete pairs only). */
function pairCount(profile: number[]): number {
  return Number.isFinite(profile.length) ? Math.floor(profile.length / 2) : 0;
}

/**
 * Smooth a profile (PrusaSlicer's "Smooth"): every height is replaced by the weighted average of the
 * heights within `radius` mm of its Z, with a linear fall-off towards the window edge. The Z values stay
 * where they are – only the heights change, so the profile keeps describing the same object.
 *
 * `keepMin` keeps the local minima: a height that is a minimum of its neighbours is never raised by the
 * smoothing (that is PrusaSlicer's "Keep min" checkbox). Heights end up clamped to `limits`.
 */
export function smoothProfile(profile: number[], radius: number, keepMin: boolean, limits?: LayerLimits): number[] {
  const n = pairCount(profile);
  if (n === 0 || !(radius > 0)) return profile.slice();
  const zs: number[] = [];
  const hs: number[] = [];
  for (let i = 0; i < n; i++) {
    zs.push(profile[i * 2]);
    hs.push(profile[i * 2 + 1]);
  }
  const smoothed = hs.slice();
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let weight = 0;
    for (let j = 0; j < n; j++) {
      const d = Math.abs(zs[j] - zs[i]);
      if (d > radius) continue;
      const w = 1 - d / radius;
      if (w <= 0) continue;
      sum += hs[j] * w;
      weight += w;
    }
    smoothed[i] = weight > 0 ? sum / weight : hs[i];
  }
  if (keepMin) {
    for (let i = 0; i < n; i++) {
      const prev = i > 0 ? hs[i - 1] : Infinity;
      const next = i + 1 < n ? hs[i + 1] : Infinity;
      if (hs[i] <= prev && hs[i] <= next) smoothed[i] = Math.min(smoothed[i], hs[i]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(zs[i], +clampLayerHeight(smoothed[i], limits).toFixed(6));
  return out;
}

/**
 * The manual brush (PrusaSlicer's drag in the layer height chart): `delta` mm is added to every height
 * whose Z lies within `radius` mm of `z`, tapered linearly towards the window edge so the change blends
 * in. A positive `delta` adds material (thicker layers), a negative one subtracts. Heights are clamped
 * to `limits`; the Z grid is unchanged.
 */
export function applyBrush(profile: number[], z: number, radius: number, delta: number, limits?: LayerLimits): number[] {
  const n = pairCount(profile);
  if (n === 0 || !Number.isFinite(z) || !Number.isFinite(delta) || delta === 0) return profile.slice();
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const zi = profile[i * 2];
    const hi = profile[i * 2 + 1];
    const d = Math.abs(zi - z);
    let h = hi;
    if (radius > 0 ? d <= radius : d < 1e-9) {
      const w = radius > 0 ? 1 - d / radius : 1;
      h = hi + delta * w;
    }
    out.push(zi, +clampLayerHeight(h, limits).toFixed(6));
  }
  return out;
}

/** The layer height a profile gives at Z `z` (the pair whose interval contains `z`); `undefined` without a profile. */
export function profileHeightAt(profile: number[] | undefined, z: number): number | undefined {
  const n = pairCount(profile || []);
  if (!n) return undefined;
  const list = profile as number[];
  let h = list[1];
  for (let i = 0; i < n; i++) {
    if (list[i * 2] <= z + 1e-9) h = list[i * 2 + 1];
    else break;
  }
  return h;
}

/** The heights of a profile (for charts and tests): every second value. */
export function profileHeights(profile: number[] | undefined): number[] {
  const n = pairCount(profile || []);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((profile as number[])[i * 2 + 1]);
  return out;
}

/** The Z values of a profile: every first value of a pair. */
export function profileZs(profile: number[] | undefined): number[] {
  const n = pairCount(profile || []);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((profile as number[])[i * 2]);
  return out;
}

/**
 * The top of a profile: its last Z, which for a profile PrusaSlicer accepts is the object's top (the
 * last pair's height only describes the layer that reaches it).
 */
export function profileTop(profile: number[] | undefined): number {
  const n = pairCount(profile || []);
  if (!n) return 0;
  return (profile as number[])[(n - 1) * 2];
}

/** The largest difference between two neighbouring heights (the "jumps" smoothing reduces). */
export function maxNeighbourHeightDiff(profile: number[] | undefined): number {
  const hs = profileHeights(profile);
  let max = 0;
  for (let i = 1; i < hs.length; i++) max = Math.max(max, Math.abs(hs[i] - hs[i - 1]));
  return max;
}

/** The file PrusaSlicer reads the profile from inside a 3MF project. */
export const LAYER_PROFILE_FILE = 'Metadata/Slic3r_PE_layer_heights_profile.txt';

/** The name the task described; older/other builds may write it, so the reader accepts both. */
export const LAYER_PROFILE_FILE_ALT = 'Metadata/Prusa_Slicer_layer_heights_profile.txt';

/** One object's line of the profile file: the 1-based model object id and its flat pairs. */
export interface LayerProfileEntry {
  objectId: number;
  profile: number[];
}

/** PrusaSlicer's float formatting of the file (`%f`, six decimals, a point as the decimal separator). */
const fmtProfileNumber = (v: number) => (Number.isFinite(v) ? v.toFixed(6) : '0.000000');

/**
 * The text of `Metadata/Slic3r_PE_layer_heights_profile.txt`: one line per object, PrusaSlicer's own
 * format. An object without a usable profile (fewer than three pairs, fewer than PrusaSlicer's reader
 * accepts) is skipped; no entry means no file.
 */
export function serializeLayerProfiles(entries: LayerProfileEntry[]): string {
  const lines: string[] = [];
  for (const { objectId, profile } of entries) {
    if (!Number.isInteger(objectId) || objectId < 1) continue;
    const n = pairCount(profile);
    // PrusaSlicer's reader rejects fewer than three pairs; only write what it can read back
    if (n < 3) continue;
    const values = profile.slice(0, n * 2).map(fmtProfileNumber);
    lines.push(
      `object_id=${objectId}|${values[0]}${values
        .slice(1)
        .map((v) => `;${v}`)
        .join('')}`,
    );
  }
  if (!lines.length) return '';
  return lines.join('\n') + '\n';
}

/**
 * Parse the profile file. The rules are PrusaSlicer's reader: each line is `object_id=<n>|<values>`,
 * the values are an even count of numbers (`;`-separated), the object id is the 1-based model object
 * index. Invalid lines are dropped, a repeated id keeps the first profile.
 */
export function parseLayerProfiles(text: string): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split('|');
    if (parts.length !== 2) continue;
    const idParts = parts[0].split('=');
    if (idParts.length !== 2) continue;
    const id = parseInt(idParts[1], 10);
    if (!Number.isInteger(id) || id < 1 || out.has(id)) continue;
    const tokens = parts[1].split(';');
    // PrusaSlicer: at least three pairs and an even count
    if (tokens.length < 6 || tokens.length % 2 !== 0) continue;
    const values = tokens.map((t) => Number(t));
    if (!values.every((v) => Number.isFinite(v))) continue;
    out.set(id, values);
  }
  return out;
}

/** One point of a profile by pair index (the chart of the panel walks the pairs). */
export function profilePoint(profile: number[], index: number): { z: number; height: number } | undefined {
  const n = pairCount(profile);
  if (index < 0 || index >= n) return undefined;
  return { z: profile[index * 2], height: profile[index * 2 + 1] };
}
