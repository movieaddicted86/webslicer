/**
 * T-045: the variable layer height profile – the adaptive algorithm, smoothing, the brush and the
 * PrusaSlicer profile file format (AC-1, AC-2, AC-4 and the roundtrip half of AC-3).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adaptiveProfile,
  applyBrush,
  clampLayerHeight,
  layerHeightLimits,
  maxNeighbourHeightDiff,
  parseLayerProfiles,
  profileHeightAt,
  profileHeights,
  profileTop,
  serializeLayerProfiles,
  smoothProfile,
  surfaceDeviation,
  LAYER_PROFILE_FILE,
} from './layerProfile.js';

/** A UV sphere as a triangle soup (radius `r`, `segments` around, `rings` from pole to pole). */
function sphere(r: number, segments = 48, rings = 24): { positions: Float32Array; indices: Uint32Array } {
  const positions: number[] = [];
  const index = (i: number, j: number) => i * (rings + 1) + j;
  for (let i = 0; i <= segments; i++) {
    const phi = (i / segments) * Math.PI * 2;
    for (let j = 0; j <= rings; j++) {
      const theta = (j / rings) * Math.PI;
      positions.push(r * Math.sin(theta) * Math.cos(phi), r * Math.sin(theta) * Math.sin(phi), r * Math.cos(theta) + r);
    }
  }
  const indices: number[] = [];
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < rings; j++) {
      const a = index(i, j);
      const b = index(i + 1, j);
      const c = index(i + 1, j + 1);
      const d = index(i, j + 1);
      indices.push(a, b, c, a, c, d);
    }
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}

/** A vertical box: walls only matter to the adaptive algorithm, the top/bottom are flat facets. */
function box(w: number, d: number, h: number): { positions: Float32Array; indices: Uint32Array } {
  const v = [0, 0, 0, w, 0, 0, w, d, 0, 0, d, 0, 0, 0, h, w, 0, h, w, d, h, 0, d, h];
  const f = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  return { positions: Float32Array.from(v), indices: Uint32Array.from(f) };
}

const LIMITS = { min: 0.05, max: 0.3 };

test('layerHeightLimits: configured values, and the nozzle factor for an automatic 0', () => {
  assert.deepEqual(layerHeightLimits(0.4, 0.05, 0.3), { min: 0.05, max: 0.3 });
  assert.deepEqual(layerHeightLimits(0.4, 0, 0), { min: 0.1, max: 0.3 });
  assert.deepEqual(layerHeightLimits(0.6, 0, 0), { min: 0.15, max: 0.45 });
  // a max below the min must not produce an empty interval
  assert.deepEqual(layerHeightLimits(0.4, 0.2, 0.1), { min: 0.2, max: 0.2 });
});

test('clampLayerHeight keeps heights inside the printer limits', () => {
  assert.equal(clampLayerHeight(0.01, LIMITS), 0.05);
  assert.equal(clampLayerHeight(1, LIMITS), 0.3);
  assert.equal(clampLayerHeight(0.2, LIMITS), 0.2);
  assert.equal(clampLayerHeight(Number.NaN, LIMITS), 0.05);
});

test('surfaceDeviation: finest at quality 0, coarsest at 1, the nominal in the middle', () => {
  assert.ok(Math.abs(surfaceDeviation(0, LIMITS, 0.2) - LIMITS.min) < 1e-9);
  assert.ok(Math.abs(surfaceDeviation(0.5, LIMITS, 0.2) - 0.2) < 1e-9);
  assert.ok(Math.abs(surfaceDeviation(1, LIMITS, 0.2) - LIMITS.max) < 1e-9);
  const a = surfaceDeviation(0.25, LIMITS, 0.2);
  assert.ok(a > LIMITS.min && a < 0.2);
});

test('AC-1: adaptive on a sphere – thin layers near the poles, thick at the equator', () => {
  const s = sphere(10);
  const profile = adaptiveProfile(s, 0.15, 0.05, 0.3, 0.2);
  assert.ok(profile.length > 20, `profile has ${profile.length / 2} pairs`);
  assert.equal(profile.length % 2, 0);
  const zs = profile.filter((_, i) => i % 2 === 0);
  const hs = profileHeights(profile);
  assert.equal(hs.length, zs.length);
  // every height is inside the limits
  for (const h of hs) assert.ok(h >= 0.05 - 1e-9 && h <= 0.3 + 1e-9, `height ${h}`);
  // the profile covers the sphere: 0 .. 20 mm, and its last Z is exactly the top (PrusaSlicer discards
  // a profile whose second-to-last value is not within 1e-3 of the object top)
  assert.ok(zs[0] <= 1e-6);
  assert.ok(Math.abs(profileTop(profile) - 20) < 1e-6, `profile ends at ${profileTop(profile)}`);
  // quality, not the nominal: the extremes are thinner than the equator
  const n = hs.length;
  const bottom = hs.slice(0, Math.max(1, Math.floor(n * 0.1)));
  const middle = hs.slice(Math.floor(n * 0.4), Math.ceil(n * 0.6));
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(avg(bottom) < avg(middle), `bottom ${avg(bottom)} vs middle ${avg(middle)}`);
  // and thinner than the fixed 0.2 mm profile, so the slice has more layers
  const fixed = Math.ceil(20 / 0.2);
  assert.ok(n > fixed, `${n} layers vs ${fixed} at 0.2 mm`);
});

test('AC-1: a coarser quality gives thicker layers on the same sphere', () => {
  const s = sphere(10);
  const fine = adaptiveProfile(s, 0, 0.05, 0.3, 0.2);
  const coarse = adaptiveProfile(s, 1, 0.05, 0.3, 0.2);
  assert.ok(profileHeights(fine).length > profileHeights(coarse).length);
});

test('AC-1: a box has its thinnest layers at the flat top and bottom', () => {
  const profile = adaptiveProfile(box(20, 20, 20), 0.5, 0.05, 0.3, 0.2);
  const hs = profileHeights(profile);
  assert.ok(hs.length > 0);
  // walls are vertical: the layers are at the maximum, the flat top pulls the last one up to it
  assert.ok(hs.every((h) => h > 0.05));
  assert.ok(Math.abs(profileTop(profile) - 20) < 1e-6);
});

test('adaptiveProfile: an empty or degenerate mesh gives no profile', () => {
  assert.deepEqual(adaptiveProfile({ positions: new Float32Array(0) }, 0.5, 0.05, 0.3), []);
  assert.deepEqual(adaptiveProfile({ positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]) }, 0.5, 0.05, 0.3), []);
});

test('AC-2: smoothing reduces the jumps between neighbouring heights', () => {
  const profile = [0, 0.1, 0.1, 0.3, 0.4, 0.1, 0.5, 0.3, 0.8, 0.1, 1.1, 0.3, 1.4, 0.1];
  const before = maxNeighbourHeightDiff(profile);
  const smoothed = smoothProfile(profile, 0.5, false, LIMITS);
  const after = maxNeighbourHeightDiff(smoothed);
  assert.ok(after < before, `jump ${before} -> ${after}`);
  // the z grid is untouched
  assert.deepEqual(
    smoothed.filter((_, i) => i % 2 === 0),
    profile.filter((_, i) => i % 2 === 0),
  );
  // everything stays inside the limits
  for (const h of profileHeights(smoothed)) assert.ok(h >= 0.05 - 1e-9 && h <= 0.3 + 1e-9);
});

test('AC-2: keep-min keeps a local minimum from being smoothed up', () => {
  const profile = [0, 0.3, 0.2, 0.05, 0.4, 0.3, 0.6, 0.3, 0.8, 0.3];
  const smoothed = smoothProfile(profile, 1, true, LIMITS);
  assert.equal(profileHeights(smoothed)[1], 0.05);
  const without = smoothProfile(profile, 1, false, LIMITS);
  assert.ok(profileHeights(without)[1] > 0.05);
});

test('smoothProfile: a zero radius and an empty profile are returned unchanged', () => {
  const profile = [0, 0.2, 0.2, 0.3];
  assert.deepEqual(smoothProfile(profile, 0, false), profile);
  assert.deepEqual(smoothProfile([], 1, false), []);
});

test('applyBrush adds and subtracts within its radius, tapering to the edge', () => {
  const profile = [0, 0.2, 0.2, 0.2, 0.4, 0.2, 0.6, 0.2, 0.8, 0.2, 1.0, 0.2];
  const thicker = applyBrush(profile, 0.4, 0.3, 0.05, LIMITS);
  const hs = profileHeights(thicker);
  // the centre gets the full delta, the edge of the window nothing
  assert.ok(Math.abs(hs[2] - 0.25) < 1e-9);
  assert.ok(Math.abs(hs[0] - 0.2) < 1e-9);
  assert.ok(hs[1] > 0.2 && hs[1] < 0.25);
  // subtracting clamps at the printer minimum
  const thinner = applyBrush(profile, 0.4, 1, -0.5, LIMITS);
  for (const h of profileHeights(thinner)) assert.ok(Math.abs(h - 0.05) < 1e-9);
  // a delta of 0 changes nothing
  assert.deepEqual(applyBrush(profile, 0.4, 0.3, 0), profile);
});

test('profileHeightAt and profileTop read the flat layout', () => {
  const profile = [0, 0.2, 0.2, 0.1, 0.3, 0.25];
  assert.equal(profileHeightAt(profile, 0), 0.2);
  assert.equal(profileHeightAt(profile, 0.25), 0.1);
  assert.equal(profileHeightAt(profile, 1), 0.25);
  assert.equal(profileHeightAt(undefined, 1), undefined);
  assert.ok(Math.abs(profileTop(profile) - 0.3) < 1e-9);
});

test('AC-3: the profile file is PrusaSlicer format and roundtrips', () => {
  const profile = [0, 0.2, 0.2, 0.1, 0.3, 0.25, 0.55, 0.2];
  const text = serializeLayerProfiles([
    { objectId: 1, profile },
    { objectId: 2, profile: [0, 0.2] },
  ]);
  assert.equal(LAYER_PROFILE_FILE, 'Metadata/Slic3r_PE_layer_heights_profile.txt');
  // one line, PrusaSlicer's `object_id=N|z;h;…` with six decimals; too-short profiles are skipped
  assert.equal(text, 'object_id=1|0.000000;0.200000;0.200000;0.100000;0.300000;0.250000;0.550000;0.200000\n');
  const parsed = parseLayerProfiles(text);
  assert.deepEqual(
    parsed.get(1),
    profile.map((v) => Number(v.toFixed(6))),
  );
  assert.equal(parsed.has(2), false);
  // no entry, no file
  assert.equal(serializeLayerProfiles([{ objectId: 1, profile: [] }]), '');
});

test('parseLayerProfiles follows PrusaSlicer: even count, at least three pairs, first id wins', () => {
  const text = [
    'object_id=3|0;0.2;0.2;0.2;0.4;0.2',
    'object_id=3|9;9;9;9;9;9',
    'object_id=0|0;0.2;0.2;0.2;0.4;0.2',
    'object_id=4|0;0.2;0.2;0.2',
    'garbage',
    'object_id=5|0;0.2;0.2;0.2;0.4;oops',
    '',
  ].join('\n');
  const parsed = parseLayerProfiles(text);
  assert.deepEqual([...parsed.keys()], [3]);
  assert.deepEqual(parsed.get(3), [0, 0.2, 0.2, 0.2, 0.4, 0.2]);
});
