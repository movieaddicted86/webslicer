/**
 * PrusaSlicer per-triangle paint encoding (TriangleSelector::serialize / 3MF attributes
 * slic3rpe:custom_supports, slic3rpe:custom_seam, slic3rpe:mmu_segmentation).
 *
 * Each triangle is a bit stream packed into hex nibbles (bit j of a nibble = stream bit):
 *   2 bits  number of split sides (0 = leaf)
 *   leaf:      2 bits state (0 none, 1 enforcer, 2 blocker; 3 = extended, 4 more bits)
 *   non-leaf:  2 bits special side, then the children recursively
 *
 * WebSlicer paints whole triangles only, so it writes "4" (enforcer) / "8" (blocker) and
 * reduces split triangles from PrusaSlicer files to their majority leaf state on import.
 */

export const PAINT_NONE = 0;
export const PAINT_ENFORCER = 1;
export const PAINT_BLOCKER = 2;

/** Attribute value for a whole-triangle state ("" for none). */
export function triangleStateToAttribute(state: number): string {
  if (state === PAINT_ENFORCER) return '4';
  if (state === PAINT_BLOCKER) return '8';
  if (state >= 3) {
    // extended state: bits 11 then 4 bits of state
    const bits = [0, 0, 1, 1, state & 1, (state >> 1) & 1, (state >> 2) & 1, (state >> 3) & 1];
    return bitsToHex(bits);
  }
  return '';
}

function bitsToHex(bits: number[]): string {
  let s = '';
  for (let i = 0; i < bits.length; i += 4) {
    let n = 0;
    for (let j = 0; j < 4; j++) if (bits[i + j]) n |= 1 << j;
    s += n.toString(16);
  }
  return s;
}

/** Decode a triangle attribute into the majority state of its leaves (count-based). */
export function attributeToTriangleState(attr: string | undefined): number {
  if (!attr) return PAINT_NONE;
  const bits: number[] = [];
  for (const ch of attr) {
    const n = parseInt(ch, 16);
    if (Number.isNaN(n)) return PAINT_NONE;
    for (let j = 0; j < 4; j++) bits.push((n >> j) & 1);
  }
  let pos = 0;
  const counts = new Map<number, number>();
  const read = (k: number): number => {
    let v = 0;
    for (let i = 0; i < k; i++) v |= (bits[pos++] || 0) << i;
    return v;
  };
  const walk = (depth: number) => {
    if (pos >= bits.length || depth > 20) return;
    const split = read(2);
    if (split === 0) {
      let state = read(2);
      if (state === 3) state = read(4);
      counts.set(state, (counts.get(state) || 0) + 1);
    } else {
      read(2); // special side
      for (let c = 0; c <= split; c++) walk(depth + 1);
    }
  };
  walk(0);
  let best = PAINT_NONE;
  let bestN = 0;
  let total = 0;
  for (const [s, n] of counts) {
    total += n;
    if (s !== PAINT_NONE && n > bestN) {
      best = s;
      bestN = n;
    }
  }
  return total && bestN * 2 >= total ? best : PAINT_NONE;
}

/** One char per triangle ('0', '4', '8' …) → states */
export function paintStringToStates(s: string | undefined): Uint8Array | undefined {
  if (!s) return undefined;
  const out = new Uint8Array(s.length);
  let any = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    out[i] = c === '4' ? PAINT_ENFORCER : c === '8' ? PAINT_BLOCKER : PAINT_NONE;
    if (out[i]) any = true;
  }
  return any ? out : undefined;
}
