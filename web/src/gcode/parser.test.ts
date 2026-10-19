import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGcode } from './parser';
import { MARKER_KINDS, type MarkerKind } from './types';

/**
 * Inline G-code shaped like PrusaSlicer 2.9 output: the `;Z:` comment opens the layer, the
 * retract/deretract pair flanks the travel to the first perimeter point, then an external
 * perimeter and a plain perimeter are printed.
 */
const SAMPLE = [
  'M83 ; use relative distances for extrusion',
  ';LAYER_CHANGE',
  ';Z:0.2',
  ';HEIGHT:0.2',
  'G1 E-2 F2400',
  'G1 Z.2 F7800',
  'G1 X10 Y10',
  'G1 E2 F2400',
  ';TYPE:External perimeter',
  ';WIDTH:0.45',
  'G1 F1800',
  'G1 X20 Y10 E1.98608',
  'G1 X20 Y20 E1.98608',
  ';TYPE:Perimeter',
  'G1 X10 Y20 E1.98608',
  ';LAYER_CHANGE',
  ';Z:0.4',
  ';HEIGHT:0.2',
  'G1 E-2 F2400',
  'G1 Z.4 F7800',
  'G1 X10 Y10',
  'G1 E2 F2400',
  ';TYPE:External perimeter',
  'G1 X20 Y10 E1.98608',
  'G1 X20 Y20 E1.98608',
  '',
].join('\n');

/** Wipe G-code: an extrusion, a retract, the wipe itself, then a travel to the next loop. */
const WIPE = [
  'M83',
  ';LAYER_CHANGE',
  ';Z:0.2',
  ';HEIGHT:0.2',
  'G1 Z.2 F7800',
  'G1 X10 Y10',
  ';TYPE:External perimeter',
  'G1 F1800',
  'G1 X20 Y10 E1.0',
  'G1 E-2 F2400',
  ';WIPE_START',
  'G1 X20.5 Y10 F1800',
  'G1 X21 Y10',
  ';WIPE_END',
  'G1 X0 Y0 F9000',
  'G1 E2 F2400',
  '',
].join('\n');

/** Positions come back as float32, so compare with a tolerance. */
const close = (actual: ArrayLike<number>, expected: number[], eps = 1e-5) => {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) < eps, `${i}: ${actual[i]} != ${expected[i]}`);
};

/** Positions of every marker of one kind, flattened (x, y, z, x, y, z, …). */
const markersOf = (text: string, kind: MarkerKind): number[] => {
  const g = parseGcode(text);
  const k = MARKER_KINDS.indexOf(kind);
  const out: number[] = [];
  for (let i = 0; i < g.markerCount; i++) {
    if (g.markerKind[i] === k) out.push(g.markerPositions[i * 3], g.markerPositions[i * 3 + 1], g.markerPositions[i * 3 + 2]);
  }
  return out;
};

test('retract and deretract are detected as standalone E moves', () => {
  const g = parseGcode(SAMPLE);
  // an E move inside a G1 with XYZ is an extrusion, not a marker
  assert.equal(g.segmentCount, 5);
  assert.equal(g.markerCount, 6); // one retract/deretract pair and one seam per layer
  close(markersOf(SAMPLE, 'retract'), [0, 0, 0, 10, 20, 0.2]);
  close(markersOf(SAMPLE, 'deretract'), [10, 10, 0.2, 10, 10, 0.4]);
});

test('an E move together with XYZ is an extrusion, not a marker', () => {
  const g = parseGcode(['M83', ';Z:0.2', 'G1 Z.2', 'G1 X10 Y10', ';TYPE:External perimeter', 'G1 X20 Y10 E1.9', ''].join('\n'));
  assert.equal(g.segmentCount, 1);
  assert.equal(g.markerCount, 1); // just the seam
  assert.equal(g.markerKind[0], MARKER_KINDS.indexOf('seam'));
});

test('wipe segments are excluded from extrusion and travel and counted separately', () => {
  const g = parseGcode(WIPE);
  assert.equal(g.segmentCount, 1); // only "G1 X20 Y10 E1.0" extrudes
  assert.equal(g.wipeCount, 2);
  assert.equal(g.travelPositions.length / 6, 3); // "G1 X10 Y10", "G1 X0 Y0" and the lift is a travel too
  // the wipe geometry is between the two ;WIPE_START / ;WIPE_END markers
  close(g.wipePositions.slice(0, 6), [20, 10, 0.2, 20.5, 10, 0.2]);
  close(g.wipePositions.slice(6), [20.5, 10, 0.2, 21, 10, 0.2]);
  assert.equal(g.wipeLayerStart.length, g.layerCount + 1);
  assert.equal(g.wipeLayerStart[1], 2);
});

test('the seam sits at the first point of every external perimeter loop', () => {
  close(markersOf(SAMPLE, 'seam'), [10, 10, 0.2, 10, 10, 0.4]);
});

test('a tool change is marked once per change', () => {
  const text = ['M83', ';Z:0.2', 'T0', 'G1 Z.2', 'G1 X10 Y10', ';TYPE:External perimeter', 'G1 X20 Y10 E1.0', 'T1', 'G1 X20 Y20 E1.0', ''].join('\n');
  const g = parseGcode(text);
  close(markersOf(text, 'tool_change'), [20, 10, 0.2]); // T0 is no change, T1 is
  assert.deepEqual(Array.from(g.tools), [0, 1]); // the segment before T1 keeps tool 0
});

test('a colour change (M600) is marked at its position', () => {
  const text = [
    'M83',
    ';Z:0.2',
    'G1 Z.2',
    'G1 X10 Y10',
    ';TYPE:External perimeter',
    'G1 X20 Y10 E1.0',
    ';LAYER_CHANGE',
    ';Z:0.4',
    'G1 Z.4',
    'M600',
    ';TYPE:External perimeter',
    'G1 X20 Y20 E1.0',
    '',
  ].join('\n');
  close(markersOf(text, 'color_change'), [20, 10, 0.4]);
});

test('move indices are monotonic across extrusions, travels and wipes', () => {
  const g = parseGcode(WIPE);
  assert.equal(g.moveIndex.length, g.segmentCount);
  assert.equal(g.travelMove.length, g.travelPositions.length / 6);
  const all = [...g.moveIndex, ...g.travelMove, ...g.wipeMove].sort((a, b) => a - b);
  assert.deepEqual(all, [0, 1, 2, 3, 4, 5]); // 0/1 travels, 2 extrusion, 3/4 wipe, 5 travel
  assert.deepEqual(Array.from(g.moveIndex), [2]);
  assert.deepEqual(Array.from(g.wipeMove), [3, 4]);
  assert.deepEqual(Array.from(g.travelMove), [0, 1, 5]);
});

test('move indices of a full sample are strictly increasing per segment kind', () => {
  const g = parseGcode(SAMPLE);
  for (let i = 1; i < g.segmentCount; i++) assert.ok(g.moveIndex[i] > g.moveIndex[i - 1], `extrusion ${i}`);
  for (let i = 1; i < g.travelMove.length; i++) assert.ok(g.travelMove[i] > g.travelMove[i - 1], `travel ${i}`);
  for (let i = 1; i < g.markerMove.length; i++) assert.ok(g.markerMove[i] >= g.markerMove[i - 1], `marker ${i}`);
  // the "cut the top layer at a move" lookup: every extrusion of layer 1 comes after the last move of layer 0
  assert.ok(g.moveIndex[g.layerStart[1]] > g.moveIndex[g.layerStart[1] - 1]);
});

test('marker arrays have one entry per marker and a known kind', () => {
  const g = parseGcode(SAMPLE);
  assert.equal(g.markerKind.length, g.markerCount);
  assert.equal(g.markerPositions.length, g.markerCount * 3);
  assert.equal(g.markerLayer.length, g.markerCount);
  assert.equal(g.markerMove.length, g.markerCount);
  for (let i = 0; i < g.markerCount; i++) assert.ok(g.markerKind[i] < MARKER_KINDS.length);
});

test('a G-code without markers yields empty marker arrays', () => {
  const g = parseGcode(['M83', ';Z:0.2', 'G1 Z.2', 'G1 X10 Y10', ';TYPE:Solid infill', 'G1 X20 Y10 E1.0', ''].join('\n'));
  assert.equal(g.markerCount, 0);
  assert.equal(g.wipeCount, 0);
  assert.equal(g.segmentCount, 1);
});
