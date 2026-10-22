/**
 * Extruder indices of the plater (B2). The extruder count is a property of the printer preset
 * (`nozzle_diameter`); shrinking it leaves values behind that point past the end – a `TypeError`
 * in the store (`filament[n]` is undefined) and an unreachable choice in the UI. Everything that
 * remembers an extruder therefore goes through the helpers here: 1-based values fall back to
 * extruder 1, 0-based slot indices into the last remaining slot.
 */
import type { PlaterObject } from '../state/types';

/** A 1-based extruder value clamped into `1…count`; 0 ("default") and garbage stay 0. */
export function clampExtruder(value: number, count: number): number {
  const n = Math.max(1, Math.floor(count));
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), n) === value ? value : 1;
}

/** A 0-based filament slot index clamped into `0…count-1` (0 for an empty list). */
export function clampExtruderSlot(index: number, count: number): number {
  const last = Math.max(0, Math.floor(count) - 1);
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(Math.floor(index), last));
}

/**
 * MMU paint values above `count` fall back to extruder 1; 0 (unpainted) stays. Returns the array
 * itself when nothing changes, so a caller can keep object identity.
 */
export function clampMmuPaint(paint: Uint8Array | undefined, count: number): Uint8Array | undefined {
  if (!paint) return paint;
  const n = Math.max(1, Math.floor(count));
  let changed = false;
  const out = new Uint8Array(paint.length);
  for (let i = 0; i < paint.length; i++) {
    const v = paint[i];
    out[i] = v > n ? 1 : v;
    if (out[i] !== v) changed = true;
  }
  return changed ? out : paint;
}

/**
 * Clamp the extruder of every object, volume and its MMU paint to `count` extruders. Objects that
 * do not change keep their identity, so the viewer only refreshes what really moved.
 */
export function clampObjectExtruders(objects: PlaterObject[], count: number): PlaterObject[] {
  return objects.map((o) => {
    const extruder = clampExtruder(o.extruder, count);
    const volumes = o.volumes.map((v) => {
      const ve = clampExtruder(v.extruder, count);
      return ve === v.extruder ? v : { ...v, extruder: ve };
    });
    const mmu = clampMmuPaint(o.paint?.mmu, count);
    const paint = o.paint ? (mmu === o.paint.mmu ? o.paint : { ...o.paint, mmu }) : o.paint;
    const volumesChanged = volumes.some((v, i) => v !== o.volumes[i]);
    if (extruder === o.extruder && !volumesChanged && paint === o.paint) return o;
    return { ...o, extruder, ...(volumesChanged && { volumes }), ...(paint !== o.paint && { paint }) };
  });
}
