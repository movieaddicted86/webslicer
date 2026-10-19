import type { ParsedGcode } from './types';

/**
 * Move window of the top visible layer for the horizontal slider. The three segment kinds share one
 * global move counter, so each kind needs its own bounds.
 */
export interface MoveWindow {
  /** highest move index of the top visible layer, per segment kind (empty kind = -1) */
  end: { extrusion: number; travel: number; wipe: number };
  /** lowest move index of the top visible layer */
  start: number;
}

/** Last entry of a sorted typed array (the arrays are ordered, so the last value is the maximum). */
function lastOf(arr: Uint32Array): number {
  return arr.length ? arr[arr.length - 1] : -1;
}

export function moveWindow(g: ParsedGcode, topLayer: number): MoveWindow {
  const hi = Math.max(0, Math.min(topLayer, g.layerCount - 1));
  const from = Math.min(g.layerStart[hi], g.segmentCount);
  const to = Math.min(g.layerStart[hi + 1], g.segmentCount);
  return {
    end: {
      extrusion: lastOf(g.moveIndex.subarray(from, to)),
      travel: lastOf(g.travelMove.subarray(g.travelLayerStart[hi], g.travelLayerStart[hi + 1])),
      wipe: lastOf(g.wipeMove.subarray(g.wipeLayerStart[hi], g.wipeLayerStart[hi + 1])),
    },
    start: from < to ? g.moveIndex[from] : 0,
  };
}

/** Index of `move` in a sorted move array, or -1. */
function indexOfMove(moves: Uint32Array, move: number): number {
  let lo = 0;
  let hi = moves.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (moves[mid] === move) return mid;
    if (moves[mid] < move) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/**
 * End point of the segment printed at `move` – where the nozzle stands after it. Used for the tool
 * position marker of the horizontal slider; the three kinds share one move counter, so the move
 * belongs to exactly one of them.
 */
export function toolPosition(g: ParsedGcode, move: number): [number, number, number] | undefined {
  const e = indexOfMove(g.moveIndex, move);
  if (e >= 0) return [g.positions[e * 6 + 3], g.positions[e * 6 + 4], g.positions[e * 6 + 5]];
  const t = indexOfMove(g.travelMove, move);
  if (t >= 0) return [g.travelPositions[t * 6 + 3], g.travelPositions[t * 6 + 4], g.travelPositions[t * 6 + 5]];
  const w = indexOfMove(g.wipeMove, move);
  if (w >= 0) return [g.wipePositions[w * 6 + 3], g.wipePositions[w * 6 + 4], g.wipePositions[w * 6 + 5]];
  return undefined;
}

/** Move indices of the top visible layer, in print order – the range of the horizontal slider. */
export function layerMoves(g: ParsedGcode, topLayer: number): Uint32Array {
  const hi = Math.max(0, Math.min(topLayer, g.layerCount - 1));
  const from = Math.min(g.layerStart[hi], g.segmentCount);
  const to = Math.min(g.layerStart[hi + 1], g.segmentCount);
  const out: number[] = [];
  for (let i = from; i < to; i++) out.push(g.moveIndex[i]);
  // travels and wipe moves of the same layer are interleaved by move index
  for (let i = g.travelLayerStart[hi]; i < g.travelLayerStart[hi + 1]; i++) out.push(g.travelMove[i]);
  for (let i = g.wipeLayerStart[hi]; i < g.wipeLayerStart[hi + 1]; i++) out.push(g.wipeMove[i]);
  out.sort((a, b) => a - b);
  return Uint32Array.from(out);
}
