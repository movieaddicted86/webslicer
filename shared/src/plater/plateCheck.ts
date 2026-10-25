/**
 * Plate checks before slicing: what PrusaSlicer refuses or warns about, computed from plain
 * axis-aligned footprints so both the browser (before a long slice) and the server (every path that
 * queues a job) can run the same rules.
 *
 * The rules were measured against PrusaSlicer 2.9.6 (see `.ai/reports/T-034.md`):
 * - an object whose bounding box leaves the bed polygon or exceeds the print height is refused
 *   ("All objects are outside of the print volume.", no output file);
 * - two instances whose toolpaths collide (their footprints overlap by more than about
 *   2 × the first-layer extrusion width) are refused ("gcode path conflict found between …");
 * - a skirt/brim that runs past the print area is only blocked by PrusaSlicer's GUI, not by the
 *   2.9 CLI – the task asks WebSlicer to follow the GUI here, so those issues block.
 *
 * The geometry is plain numbers so the rules can be unit tested without a renderer. Reading the
 * footprints of a plater (the browser's objects, the server's stored meshes) is the caller's part.
 */
import type { Config } from '../types/index.js';
import { toBool, splitVector } from '../values.js';
import { bedShapeOf, type BedShape } from './packing.js';

/** An instance's axis-aligned footprint in printer coordinates. */
export interface InstanceFootprint {
  objectId: string;
  objectName: string;
  instanceId: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** top of the instance (mm above the bed) */
  maxZ: number;
}

/** The print/printer settings the checks read, already parsed. */
export interface PlateRules {
  bed: BedShape;
  maxHeight: number;
  /** number of skirt loops (0 = no skirt) */
  skirts: number;
  skirtDistance: number;
  /** first-layer extrusion width, the width of one skirt loop */
  firstLayerWidth: number;
  /** brim width (0 = no brim) */
  brimWidth: number;
  completeObjects: boolean;
  clearanceRadius: number;
}

export type PlateIssueCode =
  'plate.outside' | 'plate.too_tall' | 'plate.skirt_outside' | 'plate.brim_outside' | 'plate.overlap' | 'plate.clearance';

export interface PlateIssue {
  code: PlateIssueCode;
  /** `block` disables "Slice now"; `warn` only lists the issue */
  severity: 'block' | 'warn';
  message: string;
  objectIds: string[];
}

/** Numerical slack for "exactly on the border": bed edges are touching, not crossing. */
const EPS = 1e-6;

/**
 * PrusaSlicer's toolpath conflict threshold as a factor of the first-layer extrusion width. Measured
 * on 2.9.6: a 0.4 mm nozzle fails at 0.77 mm penetration and accepts 0.76 mm, so the limit is a
 * little under 2 widths; 2.9 keeps rejecting beyond it regardless of object size or nozzle width.
 */
const CONFLICT_FACTOR = 1.9;

/** Ray casting: true when (x, y) lies inside the polygon or on its boundary. */
export function pointInPolygon(x: number, y: number, poly: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (onSegment(x, y, xi, yi, xj, yj)) return true;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function onSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): boolean {
  const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  if (Math.abs(cross) > EPS) return false;
  return px >= Math.min(ax, bx) - EPS && px <= Math.max(ax, bx) + EPS && py >= Math.min(ay, by) - EPS && py <= Math.max(ay, by) + EPS;
}

/** Liang–Barsky: does the segment enter the rectangle (corners inclusive)? */
function segmentCrossesRect(ax: number, ay: number, bx: number, by: number, x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [ax - x0, x1 - ax, ay - y0, y1 - ay];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < EPS) {
      if (q[i] < 0) return false;
      continue;
    }
    const r = q[i] / p[i];
    if (p[i] < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return t0 <= t1;
}

/**
 * True when the rectangle lies inside the bed polygon – a real polygon test, not the polygon's
 * bounding box, so the notch of an L-shaped bed counts as outside.
 */
export function rectInsidePolygon(minX: number, minY: number, maxX: number, maxY: number, poly: Array<[number, number]>): boolean {
  if (maxX - minX <= EPS || maxY - minY <= EPS) return false;
  if (!pointInPolygon((minX + maxX) / 2, (minY + maxY) / 2, poly)) return false;
  // a simple polygon that encloses the centre but not the whole rectangle has an edge cutting it
  const x0 = minX + EPS;
  const y0 = minY + EPS;
  const x1 = maxX - EPS;
  const y1 = maxY - EPS;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (segmentCrossesRect(poly[j][0], poly[j][1], poly[i][0], poly[i][1], x0, y0, x1, y1)) return false;
  }
  return true;
}

/**
 * Parse the settings the checks read out of the printer and print configs. An absent key falls back
 * to PrusaSlicer's own default (`skirts` 1, `skirt_distance` 6, `brim_type` outer_only, `brim_width` 0,
 * `first_layer_extrusion_width` 0 = the default width), so a preset that leaves them out is checked
 * the way the slicer would slice it.
 */
export function plateRulesOf(printerCfg: Config, printCfg: Config): PlateRules {
  const nozzle = Number(splitVector(printerCfg.nozzle_diameter || '0.4')[0]) || 0.4;
  const width = (key: string) => {
    const raw = (printCfg[key] || '').trim();
    // the slicer also accepts a percentage ("200%"), which is a share of the layer height
    if (raw.endsWith('%')) return (Number(raw.slice(0, -1)) / 100) * (Number(printCfg.first_layer_height) || 0.2) || nozzle;
    return Number(raw) || 0;
  };
  const firstLayerWidth = width('first_layer_extrusion_width');
  const brimType = (printCfg.brim_type || 'outer_only').trim();
  const brim = brimType !== 'none' && brimType !== 'no_brim' && brimType !== '';
  const num = (key: string, fallback: number) => {
    const raw = (printCfg[key] || '').trim();
    return raw === '' ? fallback : Number(raw) || 0;
  };
  return {
    bed: bedShapeOf(printerCfg),
    maxHeight: Number(printerCfg.max_print_height) || 200,
    skirts: Math.max(0, Math.floor(num('skirts', 1))),
    skirtDistance: num('skirt_distance', 6),
    firstLayerWidth: firstLayerWidth > 0 ? firstLayerWidth : nozzle,
    brimWidth: brim ? Math.max(0, num('brim_width', 0)) : 0,
    completeObjects: toBool(printCfg.complete_objects),
    clearanceRadius: Math.max(0, num('extruder_clearance_radius', 0)),
  };
}

const nameOf = (f: InstanceFootprint) => `"${f.objectName}"`;

/** Every issue of one plate, blocking ones first. Pure: no three.js, no store. */
export function checkFootprints(footprints: InstanceFootprint[], rules: PlateRules): PlateIssue[] {
  const issues: PlateIssue[] = [];
  const ids = (fps: InstanceFootprint[]) => [...new Set(fps.map((f) => f.objectId))];

  // --- off the bed / above the print height
  for (const f of footprints) {
    if (!rectInsidePolygon(f.minX, f.minY, f.maxX, f.maxY, rules.bed.points)) {
      issues.push({
        code: 'plate.outside',
        severity: 'block',
        message: `Object ${nameOf(f)} is outside the print volume.`,
        objectIds: [f.objectId],
      });
    }
    if (f.maxZ > rules.maxHeight + EPS) {
      issues.push({
        code: 'plate.too_tall',
        severity: 'block',
        message: `Object ${nameOf(f)} is taller than the print height (${rules.maxHeight} mm).`,
        objectIds: [f.objectId],
      });
    }
  }

  // --- brim: every instance grown by its own brim
  if (rules.brimWidth > 0) {
    const outside = footprints.filter(
      (f) =>
        !rectInsidePolygon(
          f.minX - rules.brimWidth,
          f.minY - rules.brimWidth,
          f.maxX + rules.brimWidth,
          f.maxY + rules.brimWidth,
          rules.bed.points,
        ),
    );
    if (outside.length) {
      issues.push({
        code: 'plate.brim_outside',
        severity: 'block',
        message: `The ${rules.brimWidth} mm brim of ${outside.map(nameOf).join(', ')} runs outside the print volume.`,
        objectIds: ids(outside),
      });
    }
  }

  // --- skirt: the union of all footprints, grown by the distance plus the loop widths (v1: bbox)
  if (rules.skirts > 0 && footprints.length) {
    const grow = rules.skirtDistance + rules.skirts * rules.firstLayerWidth;
    const minX = Math.min(...footprints.map((f) => f.minX)) - grow;
    const minY = Math.min(...footprints.map((f) => f.minY)) - grow;
    const maxX = Math.max(...footprints.map((f) => f.maxX)) + grow;
    const maxY = Math.max(...footprints.map((f) => f.maxY)) + grow;
    if (!rectInsidePolygon(minX, minY, maxX, maxY, rules.bed.points)) {
      issues.push({
        code: 'plate.skirt_outside',
        severity: 'block',
        message: `A ${rules.skirts}-loop skirt ${rules.skirtDistance} mm from the objects runs outside the print volume.`,
        objectIds: [...new Set(footprints.map((f) => f.objectId))],
      });
    }
  }

  // --- overlap: PrusaSlicer refuses toolpaths that collide ("gcode path conflicts found …")
  const limit = rules.firstLayerWidth * CONFLICT_FACTOR;
  for (let i = 0; i < footprints.length; i++) {
    for (let j = i + 1; j < footprints.length; j++) {
      const a = footprints[i];
      const b = footprints[j];
      const penX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
      const penY = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
      if (penX <= 0 || penY <= 0) continue;
      const depth = Math.min(penX, penY);
      if (depth > limit) {
        issues.push({
          code: 'plate.overlap',
          severity: 'block',
          message: `G-code path conflict between ${nameOf(a)} and ${nameOf(b)}: their footprints overlap by ${depth.toFixed(2)} mm.`,
          objectIds: [...new Set([a.objectId, b.objectId])],
        });
      }
    }
  }

  // --- sequential printing: PrusaSlicer 2.9 slices this, but the head can hit the neighbour
  if (rules.completeObjects && rules.clearanceRadius > 0) {
    for (let i = 0; i < footprints.length; i++) {
      for (let j = i + 1; j < footprints.length; j++) {
        const a = footprints[i];
        const b = footprints[j];
        if (a.objectId === b.objectId) continue;
        const gapX = Math.max(a.minX - b.maxX, b.minX - a.maxX, 0);
        const gapY = Math.max(a.minY - b.maxY, b.minY - a.maxY, 0);
        const gap = Math.hypot(gapX, gapY);
        if (gap < rules.clearanceRadius) {
          issues.push({
            code: 'plate.clearance',
            severity: 'warn',
            message: `Sequential printing: ${nameOf(a)} and ${nameOf(b)} are ${gap.toFixed(1)} mm apart, less than the extruder clearance radius (${rules.clearanceRadius} mm).`,
            objectIds: [...new Set([a.objectId, b.objectId])],
          });
        }
      }
    }
  }

  return issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'block' ? -1 : 1));
}

/** True when an instance's bounding box (world coordinates) leaves the bed polygon or is too tall. */
export function boxOutside(
  box: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } },
  bedPoints: Array<[number, number]>,
  maxHeight: number,
): boolean {
  return !rectInsidePolygon(box.min.x, box.min.y, box.max.x, box.max.y, bedPoints) || box.max.z > maxHeight + EPS;
}
