/**
 * The paint wire format (q4-web-store): PrusaSlicer stores paint per triangle as a hex nibble
 * string (`slic3rpe:custom_supports` / `slic3rpe:custom_seam`); whole-triangle states encode as
 * "4" (enforcer) and "8" (blocker). MMU paint is one hex char per triangle: the extruder index.
 *
 * These codecs are plain array work and moved out of `three/paint.ts`, so the store and the server
 * request builder can use them without importing three.js.
 */

/** The three kinds of per-triangle paint the plater keeps. */
export type PaintKind = 'supports' | 'seam' | 'mmu';

const PAINT_ENFORCER = 1;
const PAINT_BLOCKER = 2;

/** Map an old per-triangle paint array through the subdivision parent table. */
export function remapPaint(old: Uint8Array | undefined, parent: Uint32Array): Uint8Array | undefined {
  if (!old) return undefined;
  const out = new Uint8Array(parent.length);
  for (let i = 0; i < parent.length; i++) out[i] = old[parent[i]] || 0;
  return out;
}

/** Encode a paint array as PrusaSlicer per-triangle hex strings joined by nothing: one char per triangle. */
export function encodePaint(paint: Uint8Array): string {
  let s = '';
  for (let i = 0; i < paint.length; i++) s += paint[i] === PAINT_ENFORCER ? '4' : paint[i] === PAINT_BLOCKER ? '8' : '0';
  return s;
}

/** MMU paint: one hex char per triangle = extruder index */
export function encodeMmu(paint: Uint8Array): string {
  let s = '';
  for (let i = 0; i < paint.length; i++) s += (paint[i] & 15).toString(16);
  return s;
}

export function decodeMmu(s: string | undefined, triCount: number): Uint8Array | undefined {
  if (!s) return undefined;
  const out = new Uint8Array(triCount);
  let any = false;
  for (let i = 0; i < Math.min(s.length, triCount); i++) {
    out[i] = parseInt(s[i], 16) || 0;
    if (out[i]) any = true;
  }
  return any ? out : undefined;
}

export function decodePaint(s: string | undefined, triCount: number): Uint8Array | undefined {
  if (!s) return undefined;
  const out = new Uint8Array(triCount);
  let any = false;
  for (let i = 0; i < Math.min(s.length, triCount); i++) {
    const c = s[i];
    out[i] = c === '4' ? PAINT_ENFORCER : c === '8' ? PAINT_BLOCKER : 0;
    if (out[i]) any = true;
  }
  return any ? out : undefined;
}
