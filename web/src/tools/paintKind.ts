/**
 * Mapping between a paint tool id and the paint kind the viewer paints with (T-046). The three paint
 * tools are separate entries of the registry, while the painting code (and the project file) speaks
 * of `PaintKind`.
 */
import type { PaintKind } from '../three/paint';
import type { ToolId } from './registry';

/** The paint kind of a tool id, `undefined` for every other tool. */
export function paintKindOf(tool: ToolId | undefined): PaintKind | undefined {
  switch (tool) {
    case 'paintSupports':
      return 'supports';
    case 'paintSeam':
      return 'seam';
    case 'paintMmu':
      return 'mmu';
    default:
      return undefined;
  }
}

/** The tool that paints a kind (the inverse of `paintKindOf`). */
export function paintToolOf(kind: PaintKind): ToolId {
  return kind === 'supports' ? 'paintSupports' : kind === 'seam' ? 'paintSeam' : 'paintMmu';
}
