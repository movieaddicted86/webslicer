/**
 * Reading the plater state the specs assert on, and the canvas geometry they click.
 *
 * The rounding lives *inside* the evaluated function: `page.evaluate` serialises the source text, so a
 * reference to a module-level helper would not exist in the page.
 */
import type { Page } from '@playwright/test';
import { read } from './app';

export interface PlaterSnapshot {
  selectedIds: string[];
  selectedInstanceId: string | null;
  selectedVolumeId: string | null;
  transformMode: string;
  paintMode: string | null;
  paintTool: string;
  brushRadius: number;
  placeOnFace: boolean;
  view: string;
  mode: string;
  sliceDirty: boolean;
  undo: number;
  redo: number;
  objects: Array<{
    id: string;
    name: string;
    triangles: number;
    extruder: number;
    size: number[];
    modelId: boolean;
    visible: boolean;
    config: Record<string, string>;
    paint: { supports: number; seam: number; mmu: number } | null;
    volumes: Array<{ id: string; name: string; type: string; extruder: number; position: number[]; size: number[] }>;
    ranges: Array<{ minZ: number; maxZ: number; layerHeight: string | null }>;
    instances: Array<{ id: string; position: number[]; rotation: number[]; scale: number[] }>;
  }>;
}

/** The plater state the steps change, rounded so float noise cannot fake a difference. */
export function plater(page: Page): Promise<PlaterSnapshot> {
  return read(page, (s) => {
    const r = (v: number) => Number(v.toFixed(6));
    return {
      selectedIds: s.selectedIds,
      selectedInstanceId: s.selectedInstanceId ?? null,
      selectedVolumeId: s.selectedVolumeId ?? null,
      transformMode: s.transformMode,
      paintMode: s.paintMode ?? null,
      paintTool: s.paintTool,
      brushRadius: s.brushRadius,
      placeOnFace: s.placeOnFace,
      view: s.view,
      mode: s.mode,
      sliceDirty: s.sliceDirty,
      undo: s.undoStack.length,
      redo: s.redoStack.length,
      objects: s.objects.map((o) => ({
        id: o.id,
        name: o.name,
        triangles: o.triangles,
        extruder: o.extruder,
        size: o.size.map(r),
        modelId: !!o.modelId,
        visible: o.visible,
        config: o.config,
        paint: o.paint
          ? {
              supports: o.paint.supports ? Array.from(o.paint.supports).filter(Boolean).length : 0,
              seam: o.paint.seam ? Array.from(o.paint.seam).filter(Boolean).length : 0,
              mmu: o.paint.mmu ? Array.from(o.paint.mmu).filter(Boolean).length : 0,
            }
          : null,
        volumes: o.volumes.map((v) => ({ id: v.id, name: v.name, type: v.type, extruder: v.extruder, position: v.position.map(r), size: v.size.map(r) })),
        ranges: o.ranges.map((x) => ({ minZ: x.minZ, maxZ: x.maxZ, layerHeight: x.config.layer_height ?? null })),
        instances: o.instances.map((i) => ({ id: i.id, position: i.position.map(r), rotation: i.rotation.map(r), scale: i.scale.map(r) })),
      })),
    };
  });
}

/** The CSS box of the viewer canvas (clicks are relative to it). */
export async function canvasBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator('.viewer canvas').boundingBox();
  if (!box) throw new Error('the viewer canvas has no box');
  return box;
}
