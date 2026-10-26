/**
 * Plate checks before slicing: what PrusaSlicer refuses or warns about, from plain footprints (the
 * instance's convex hull on the bed, or its box), so the browser and every server path queue jobs with
 * the same rules.
 *
 * Measured against PrusaSlicer 2.9.6: an object that leaves the bed polygon or exceeds the print
 * height is refused, and two instances whose toolpaths collide (overlap by more than about 2 × the
 * first-layer extrusion width) are refused. A skirt or brim past the print area is blocked by the GUI
 * only, but blocks here too. The hull makes the check conservative for a concave part and never looser
 * than the slicer. Plain numbers, so it is unit-tested without a renderer; reading the footprints is
 * the caller's part.
 */
import type { Config } from '../types/index.js';
import { toBool, splitVector } from '../values.js';
import { bedShapeOf, type BedShape } from './packing.js';
import { boxHull, hullGap, hullInsidePolygon, hullPenetration, pointInPolygon, unionHull, type Hull } from './hull.js';

/**
 * An instance's footprint on the bed. `hull` is the real outline (the convex hull of the instance's
 * XY projection); the bounding box stays for the cheap reject and for callers that only have a box.
 */
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
  /** convex hull of the instance on the bed, counter-clockwise; absent = the bounding box */
  hull?: Hull;
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

/** Ray casting: true when (x, y) lies inside the polygon or on its boundary (hull.ts holds it). */
export { pointInPolygon };

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
 * bounding box, so the notch of an L-shaped bed counts as outside. The rectangle is checked as the
 * box hull it is; `hullInsidePolygon` does the same for any outline.
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

/** The instance's real outline: its hull when it has one, else its bounding box. */
export function hullOf(f: InstanceFootprint): Hull {
  return f.hull && f.hull.length ? f.hull : boxHull(f.minX, f.minY, f.maxX, f.maxY);
}

/** The convex hull of all instances' outlines – the outline the skirt follows. `null` when empty. */
export function combinedFootprint(footprints: InstanceFootprint[]): Hull | null {
  if (!footprints.length) return null;
  return unionHull(footprints.map(hullOf));
}

/** Every issue of one plate, blocking ones first. Pure: no three.js, no store. */
export function checkFootprints(footprints: InstanceFootprint[], rules: PlateRules): PlateIssue[] {
  const issues: PlateIssue[] = [];
  const ids = (fps: InstanceFootprint[]) => [...new Set(fps.map((f) => f.objectId))];

  // --- off the bed / above the print height: the real outline, not its bounding box
  for (const f of footprints) {
    if (!hullInsidePolygon(hullOf(f), rules.bed.points)) {
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
    const outside = footprints.filter((f) => !hullInsidePolygon(hullOf(f), rules.bed.points, rules.brimWidth));
    if (outside.length) {
      issues.push({
        code: 'plate.brim_outside',
        severity: 'block',
        message: `The ${rules.brimWidth} mm brim of ${outside.map(nameOf).join(', ')} runs outside the print volume.`,
        objectIds: ids(outside),
      });
    }
  }

  // --- skirt: PrusaSlicer draws it as the convex hull of the objects at that distance
  if (rules.skirts > 0 && footprints.length) {
    const grow = rules.skirtDistance + rules.skirts * rules.firstLayerWidth;
    const skirt = combinedFootprint(footprints);
    if (!skirt || !hullInsidePolygon(skirt, rules.bed.points, grow)) {
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
      // the boxes are the cheap reject; the penetration itself comes from the outlines (SAT)
      if (Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) <= 0 || Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY) <= 0) continue;
      const depth = hullPenetration(hullOf(a), hullOf(b));
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
        // the box gap is an upper bound of the outline gap: it can only skip a real warning
        const gapX = Math.max(a.minX - b.maxX, b.minX - a.maxX, 0);
        const gapY = Math.max(a.minY - b.maxY, b.minY - a.maxY, 0);
        if (Math.hypot(gapX, gapY) >= rules.clearanceRadius) continue;
        const gap = hullGap(hullOf(a), hullOf(b));
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

/**
 * True when a hull (world coordinates) leaves the bed polygon or its top exceeds the print height –
 * the "outside" half of the plate check for callers that hold a footprint, e.g. a row's badge.
 */
export function hullOutsideBed(hull: Hull, top: number, bedPoints: Array<[number, number]>, maxHeight: number): boolean {
  return !hullInsidePolygon(hull, bedPoints) || top > maxHeight + EPS;
}
