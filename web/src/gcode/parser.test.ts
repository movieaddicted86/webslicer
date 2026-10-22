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
  const text = [
    'M83',
    ';Z:0.2',
    'T0',
    'G1 Z.2',
    'G1 X10 Y10',
    ';TYPE:External perimeter',
    'G1 X20 Y10 E1.0',
    'T1',
    'G1 X20 Y20 E1.0',
    '',
  ].join('\n');
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

/** Feature times are accumulated as distance / feedrate, like the layer times. */
test('feature times accumulate per feature type and add up to the layer times', () => {
  const g = parseGcode(
    [
      'M83',
      ';LAYER_CHANGE',
      ';Z:0.2',
      'G1 X0 Y0 Z0.2 F6000', // travel: 0.2 mm at 100 mm/s
      ';TYPE:External perimeter',
      'G1 X10 Y0 E0.5 F1200', // 10 mm at 20 mm/s = 0.5 s
      'G1 X10 Y10 E1.0 F600', // 10 mm at 10 mm/s = 1.0 s
      ';TYPE:Internal infill',
      'G1 X0 Y10 E1.5 F1800', // 10 mm at 30 mm/s
      'G1 X0 Y0 F9000', // travel: 10 mm at 150 mm/s
      '',
    ].join('\n'),
  );
  assert.ok(Math.abs(g.featureTime['External perimeter'] - 1.5) < 1e-5);
  assert.ok(Math.abs(g.featureTime['Internal infill'] - 10 / 30) < 1e-5);
  assert.ok(Math.abs(g.featureTime['Travel'] - (0.2 / 100 + 10 / 150)) < 1e-5);
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  const layerSeconds = Array.from(g.layerTime).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum(g.featureTime) - layerSeconds) < 1e-5, `${sum(g.featureTime)} != ${layerSeconds}`);
});

test('a wipe counts towards its feature, not towards travel', () => {
  const g = parseGcode(WIPE);
  // the loop (10 mm) plus the two 0.5 mm wipe moves, all at 30 mm/s, belong to the perimeter
  assert.ok(Math.abs(g.featureTime['External perimeter'] - (10 / 30 + 1 / 30)) < 1e-5);
  // travel is only the lift, the move to the perimeter and the move back to the origin
  const travel = 0.2 / 130 + Math.hypot(10, 10) / 130 + Math.hypot(21, 10) / 150;
  assert.ok(Math.abs(g.featureTime['Travel'] - travel) < 1e-5, `${g.featureTime['Travel']} != ${travel}`);
});

/**
 * B8: `arc_fitting` (off by default) makes PrusaSlicer emit G2/G3 instead of a run of G1 moves. The
 * parser used to skip them, so a fitted file lost whole perimeters from the preview.
 */
test('B8: a G2 arc is interpolated into segments that follow the circle', () => {
  // a quarter circle of radius 10 around (10, 0): from (0, 0) clockwise to (10, 10), over the top
  const g = parseGcode(
    ['M83', ';LAYER_CHANGE', ';Z:0.2', 'G1 X0 Y0 F6000', ';TYPE:External perimeter', 'G2 X10 Y10 I10 J0 E1.5', ''].join('\n'),
  );
  assert.ok(g.segmentCount > 1, 'the arc became several segments');
  // every vertex of the chain lies on the circle (the last one snaps to the rounded end point)
  for (let i = 0; i < g.segmentCount - 1; i++) {
    const x = g.positions[i * 6];
    const y = g.positions[i * 6 + 1];
    assert.ok(Math.abs(Math.hypot(x - 10, y) - 10) < 1e-3, `start ${i} on the circle`);
  }
  const end = g.positions[(g.segmentCount - 1) * 6 + 3];
  assert.equal(end, 10);
  // the chain is connected: each piece starts where the previous one ended
  for (let i = 1; i < g.segmentCount; i++) {
    assert.equal(g.positions[i * 6], g.positions[i * 6 - 3]);
    assert.equal(g.positions[i * 6 + 1], g.positions[i * 6 - 2]);
  }
  // the arc length of the quarter circle is ~15.71 mm, and the extrusion belongs to the perimeter
  assert.ok(Math.abs(g.featureLength['External perimeter'] - (Math.PI / 2) * 10) < 0.2);
});

test('B8: the chord error of an interpolated arc stays below 0.05 mm', () => {
  // a full circle at R=10 needs a fine step: no vertex may sit far off the circle
  const g = parseGcode(['M83', ';Z:0.2', 'G1 X0 Y0', ';TYPE:Perimeter', 'G3 X0.0 Y0.0 I10 J0 E8', ''].join('\n'));
  assert.ok(g.segmentCount > 30, `the full circle became ${g.segmentCount} segments`);
  let worst = 0;
  for (let i = 0; i < g.segmentCount; i++) {
    const x = g.positions[i * 6 + 3];
    const y = g.positions[i * 6 + 4];
    worst = Math.max(worst, Math.abs(Math.hypot(x - 10, y) - 10));
  }
  assert.ok(worst <= 0.05 + 1e-6, `worst deviation ${worst}`);
  // the whole extrusion lands in the layer and in the perimeter, none is lost at the wrap-around
  assert.ok(Math.abs(g.featureLength.Perimeter - 2 * Math.PI * 10) < 0.2);
});

test('B8: a G2 goes clockwise and a G3 counter-clockwise', () => {
  const cw = parseGcode(['M83', ';Z:0.2', 'G1 X0 Y0', ';TYPE:Perimeter', 'G2 X10 Y10 I10 J0 E1.5', ''].join('\n'));
  const ccw = parseGcode(['M83', ';Z:0.2', 'G1 X0 Y0', ';TYPE:Perimeter', 'G3 X10 Y10 I10 J0 E1.5', ''].join('\n'));
  // both end at the same point, but they take different ways round the centre (10, 0)
  assert.equal(cw.positions[(cw.segmentCount - 1) * 6 + 3], 10);
  assert.equal(ccw.positions[(ccw.segmentCount - 1) * 6 + 3], 10);
  // from the start at angle 180° to the end at 90° around (10, 0): clockwise is the quarter arc
  // through 135° (above the centre), counter-clockwise the three-quarter one through 0° (below it)
  const first = (p: typeof cw) => p.positions[4];
  assert.ok(first(cw) > 0, `clockwise goes above the centre (y ${first(cw)})`);
  assert.ok(first(ccw) < 0, `counter-clockwise goes below the centre (y ${first(ccw)})`);
  // the shorter arc is a quarter; the longer one is three quarters
  assert.ok(Math.abs(cw.featureLength.Perimeter - (Math.PI / 2) * 10) < 0.2, 'clockwise takes the short way');
  assert.ok(Math.abs(ccw.featureLength.Perimeter - ((3 * Math.PI) / 2) * 10) < 0.3, 'counter-clockwise takes the long way');
});

test('B8: an R arc picks the centre that gives the shorter sweep', () => {
  // from (0,0) to (10,0) with R=10 clockwise: the short 60° arc bulges ~1.34 mm up
  const g = parseGcode(['M83', ';Z:0.2', 'G1 X0 Y0', ';TYPE:Perimeter', 'G2 X10 Y0 R10 E2', ''].join('\n'));
  let maxY = -Infinity;
  for (let i = 0; i < g.segmentCount; i++) maxY = Math.max(maxY, g.positions[i * 6 + 4]);
  assert.ok(Math.abs(maxY - (10 - Math.sqrt(100 - 25))) < 0.2, `max y ${maxY}`);
  // the short arc is a sixth of the circle; the long one would be 5/6
  assert.ok(Math.abs(g.featureLength.Perimeter - (Math.PI / 3) * 10) < 0.2);
});

test('B8: a G2/G3 without a centre is drawn as the straight line it spans', () => {
  const g = parseGcode(['M83', ';Z:0.2', 'G1 X0 Y0', ';TYPE:Perimeter', 'G3 X10 Y0 E1', ''].join('\n'));
  assert.equal(g.segmentCount, 1);
  assert.equal(g.positions[3], 10);
});
