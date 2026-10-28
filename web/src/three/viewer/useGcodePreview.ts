/**
 * The G-code preview (R-7): the toolpath lines, the travel and wipe lines, one `Points` per marker
 * kind and the tool marker, plus the layer range and the move slider. Moved out of `Viewer.tsx`
 * verbatim - the draw ranges and the collapsing of hidden feature types are what the preview shows.
 */
import { useEffect } from 'react';
import type { RefObject } from 'react';
import * as THREE from 'three';
import { FEATURE_COLORS, MARKER_COLORS, MARKER_KINDS, type MarkerKind, type ParsedGcode } from '../../gcode/types';
import { moveWindow, toolPosition } from '../../gcode/moves';
import { RANGE_SCHEMES, rangeColor, rangePosition, schemeRange, type PreviewColorMode } from '../../gcode/colorschemes';
import type { CustomGcode } from '../../api';
import { colorAtZ, normalizeColor } from '../../gcode/colorprint';
import type { View } from '../../state/types';
import { clearAndDispose } from './dispose';
import type { SceneRefs } from './types';
import {
  extrusionWidth,
  FALLBACK_EXTRUSION_WIDTH,
  pixelsPerMillimetre,
  ribbonGeometry,
  ToolpathMaterial,
  toolpathMode,
  wideToolpaths,
} from './pathwidth';

interface GcodeColoring {
  mode: PreviewColorMode;
  baseColor: string;
  codes: CustomGcode[];
  /** colour per tool (filament colours) */
  toolColors: string[];
  /** the plate fails the checks: the result is shown as outdated, one grey and no layer colours (Z-06) */
  outdated: boolean;
}

/** The position buffer of the toolpath geometry (one shared buffer for hairlines and ribbons). */
function posAttrArray(geometry: THREE.BufferGeometry): Float32Array {
  return geometry.getAttribute('position').array as Float32Array;
}

/** The look of a result that must not pass as current: one grey, low opacity, no scheme colours. */
const OUTDATED_GREY = 0x8e97a6;
const OUTDATED_OPACITY = 0.35;
/** The colours the travel, the wipe and the tool marker are drawn in when the result is current. */
const TRAVEL_COLOR = 0x3b8bd1;
const TRAVEL_OPACITY = 0.6;
const WIPE_OPACITY = 0.9;
const TOOL_MARKER_COLOR = 0xffd24d;

/** Fill the per-vertex colours of the toolpath lines for the given colour mode. */
function fillGcodeColors(colors: Float32Array, g: ParsedGcode, coloring: GcodeColoring) {
  const set = (i: number, c: THREE.Color) => {
    const o = i * 6;
    colors[o] = colors[o + 3] = c.r;
    colors[o + 1] = colors[o + 4] = c.g;
    colors[o + 2] = colors[o + 5] = c.b;
  };
  if (coloring.outdated) {
    // Z-06: a result whose plate no longer passes the checks keeps its lines but loses every colour
    const grey = new THREE.Color(OUTDATED_GREY);
    for (let i = 0; i < g.segmentCount; i++) set(i, grey);
    return;
  }
  if (coloring.mode === 'colorprint') {
    // one colour per layer, switched by colour changes
    const layerColor = Array.from(g.layerZ, (z) => new THREE.Color(colorAtZ(z, coloring.baseColor, coloring.codes)));
    for (let i = 0; i < g.segmentCount; i++) set(i, layerColor[g.layers[i]] ?? layerColor[0]);
    return;
  }
  if (coloring.mode === 'tool') {
    const toolColor = coloring.toolColors.map((c) => new THREE.Color(c));
    const fallback = new THREE.Color(coloring.baseColor);
    for (let i = 0; i < g.segmentCount; i++) set(i, toolColor[g.tools[i]] ?? fallback);
    return;
  }
  const scheme = RANGE_SCHEMES[coloring.mode];
  if (scheme) {
    const values = scheme.values(g);
    const range = schemeRange(g, coloring.mode);
    // 256-entry lookup table instead of interpolating per segment
    const lut = Array.from({ length: 256 }, (_, k) => new THREE.Color(...rangeColor(k / 255)));
    for (let i = 0; i < g.segmentCount; i++) {
      const v = scheme.perLayer ? values[g.layers[i]] : values[i];
      set(i, lut[Math.round(Math.min(1, Math.max(0, rangePosition(v, range, scheme.log))) * 255)]);
    }
    return;
  }
  const colorByType = g.featureTypes.map((t) => new THREE.Color(FEATURE_COLORS[t] || FEATURE_COLORS.Unknown));
  for (let i = 0; i < g.segmentCount; i++) set(i, colorByType[g.types[i]]);
}

function coloringKey(c: GcodeColoring): string {
  const outdated = c.outdated ? 'outdated|' : '';
  if (c.mode === 'colorprint')
    return `${outdated}colorprint|${c.baseColor}|${c.codes.map((x) => `${x.type}:${x.printZ}:${x.color ?? ''}`).join(',')}`;
  if (c.mode === 'tool') return `${outdated}tool|${c.baseColor}|${c.toolColors.join(',')}`;
  return `${outdated}${c.mode}`;
}

/**
 * The outdated look of the whole preview (Z-06): every line, marker and the tool marker in one grey at
 * low opacity, so a result whose plate fails the checks cannot be mistaken for a current one. The
 * materials are transparent from the start, so switching the look costs no shader rebuild.
 */
function applyOutdatedLook(refs: SceneRefs, outdated: boolean) {
  const lines = refs.gcodeLines?.material as THREE.LineBasicMaterial | undefined;
  if (lines) lines.opacity = outdated ? OUTDATED_OPACITY : 1;
  const ribbons = refs.gcodeRibbons?.material as ToolpathMaterial | undefined;
  if (ribbons) ribbons.opacity = outdated ? OUTDATED_OPACITY : 1;
  const travel = refs.travelLines?.material as THREE.LineBasicMaterial | undefined;
  if (travel) {
    travel.color.set(outdated ? OUTDATED_GREY : TRAVEL_COLOR);
    travel.opacity = outdated ? OUTDATED_OPACITY : TRAVEL_OPACITY;
  }
  const wipe = refs.wipeLines?.material as THREE.LineBasicMaterial | undefined;
  if (wipe) {
    wipe.color.set(outdated ? OUTDATED_GREY : MARKER_COLORS.wipe);
    wipe.opacity = outdated ? OUTDATED_OPACITY : WIPE_OPACITY;
  }
  for (const [kind, points] of refs.markerPoints ?? []) {
    const material = points.material as THREE.PointsMaterial;
    material.color.set(outdated ? OUTDATED_GREY : MARKER_COLORS[kind]);
    material.opacity = outdated ? OUTDATED_OPACITY : 1;
  }
  const cone = refs.toolMarker?.material as THREE.MeshBasicMaterial | undefined;
  if (cone) {
    cone.color.set(outdated ? OUTDATED_GREY : TOOL_MARKER_COLOR);
    cone.opacity = outdated ? OUTDATED_OPACITY : 1;
  }
}

function buildGcode(refs: SceneRefs, g: ParsedGcode, coloring: GcodeColoring) {
  // B1: the toolpaths of the previous preview are GPU resources; `clear()` would leave them behind
  clearAndDispose(refs.gcodeGroup);
  refs.gcodeLines = undefined;
  refs.gcodeRibbons = undefined;
  refs.pathSizeKey = undefined;
  refs.travelLines = undefined;
  refs.wipeLines = undefined;
  refs.markerPoints = undefined;
  refs.toolMarker = undefined;
  const colors = new Float32Array(g.positions.length);
  fillGcodeColors(colors, g, coloring);
  refs.colorKey = coloringKey(coloring);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(g.positions.slice(), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true }));
  lines.frustumCulled = false;
  // hidden features keep using zero-length hairlines; the fat ribbons below share this buffer, so
  // changing the visible features or the layer range never rebuilds either geometry
  refs.gcodeGroup.add(lines);
  refs.gcodeLines = lines;
  const widths = Float32Array.from(g.width, extrusionWidth);
  const ribbonGeo = ribbonGeometry(posAttrArray(geo), colors, widths);
  const ribbons = new THREE.Mesh(ribbonGeo, new ToolpathMaterial(ribbonGeo));
  ribbons.frustumCulled = false;
  refs.gcodeGroup.add(ribbons);
  refs.gcodeRibbons = ribbons;
  lines.visible = false;

  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(g.travelPositions, 3));
  const travel = new THREE.LineSegments(
    tg,
    new THREE.LineBasicMaterial({ color: TRAVEL_COLOR, transparent: true, opacity: TRAVEL_OPACITY }),
  );
  travel.frustumCulled = false;
  travel.visible = false;
  refs.gcodeGroup.add(travel);
  refs.travelLines = travel;

  if (g.wipeCount) {
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.BufferAttribute(g.wipePositions, 3));
    const wipe = new THREE.LineSegments(
      wg,
      new THREE.LineBasicMaterial({ color: MARKER_COLORS.wipe, transparent: true, opacity: WIPE_OPACITY }),
    );
    wipe.frustumCulled = false;
    wipe.visible = false;
    refs.gcodeGroup.add(wipe);
    refs.wipeLines = wipe;
  }

  // one Points object per marker kind: toggling a kind only flips its visibility
  const points = new Map<MarkerKind, THREE.Points>();
  for (let k = 0; k < MARKER_KINDS.length; k++) {
    let n = 0;
    for (let i = 0; i < g.markerCount; i++) if (g.markerKind[i] === k) n++;
    if (!n) continue;
    const arr = new Float32Array(n * 3);
    const layer = new Uint32Array(n);
    const move = new Uint32Array(n);
    let w = 0;
    for (let i = 0; i < g.markerCount; i++) {
      if (g.markerKind[i] !== k) continue;
      arr[w * 3] = g.markerPositions[i * 3];
      arr[w * 3 + 1] = g.markerPositions[i * 3 + 1];
      arr[w * 3 + 2] = g.markerPositions[i * 3 + 2];
      layer[w] = g.markerLayer[i];
      move[w] = g.markerMove[i];
      w++;
    }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const kind = MARKER_KINDS[k];
    const mp = new THREE.Points(
      mg,
      new THREE.PointsMaterial({ color: new THREE.Color(MARKER_COLORS[kind]), size: 3, sizeAttenuation: false, transparent: true }),
    );
    mp.frustumCulled = false;
    mp.visible = false;
    // markers of one kind are sorted by layer and move (both grow in G-code order), so the window of
    // a layer is a contiguous range found by binary search – no per-frame allocation
    mp.userData = { layer, move, count: n };
    refs.gcodeGroup.add(mp);
    points.set(kind, mp);
  }
  refs.markerPoints = points;

  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(1.5, 4, 16),
    new THREE.MeshBasicMaterial({ color: TOOL_MARKER_COLOR, transparent: true, depthTest: false }),
  );
  cone.rotation.x = Math.PI / 2; // PrusaSlicer's marker points along +Z
  cone.visible = false;
  cone.renderOrder = 30;
  // A small screen-visible head marker is what makes the Move slider's current position visible even
  // when a partially printed top layer is hidden among the finished layers below it.
  refs.gcodeGroup.add(cone);
  refs.toolMarker = cone;

  refs.gcodeRef = g;
}

/**
 * How much of the top visible layer is printed. `cut === undefined` means the whole layer; otherwise
 * everything up to and including the global move `cut` is drawn.
 */
interface Cut {
  extrusion: number;
  travel: number;
  wipe: number;
  marker: number;
}

/** Number of leading segments of a sorted move array whose move index is <= cut. */
function countUpTo(moves: Uint32Array, from: number, to: number, cut: number | undefined): number {
  if (cut === undefined) return to - from;
  let n = 0;
  for (let i = from; i < to; i++) {
    if (moves[i] > cut) break;
    n++;
  }
  return n;
}

/** First index in a sorted array whose value is >= `value`. */
function lowerBound(arr: Uint32Array, value: number, len: number): number {
  let lo = 0;
  let hi = len;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index in a sorted array whose value is > `value`. */
function upperBound(arr: Uint32Array, value: number, len: number): number {
  let lo = 0;
  let hi = len;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Apply the visible layer and move windows without rebuilding the shared position buffers. */
export function applyGcodeRange(
  refs: SceneRefs,
  gcode: ParsedGcode,
  range: [number, number],
  cut: Cut,
  showTravel: boolean,
  markers: Record<MarkerKind, boolean>,
  visibility: Record<string, boolean>,
) {
  if (!refs.gcodeLines) return;
  const lo = Math.max(0, Math.min(range[0], gcode.layerCount - 1));
  const hi = Math.max(lo, Math.min(range[1], gcode.layerCount - 1));
  const startSeg = gcode.layerStart[lo];
  const endSeg = gcode.layerStart[hi + 1];
  // the bottom layers stay complete, only the top layer is cut by the horizontal slider
  const cutSeg = countUpTo(gcode.moveIndex, gcode.layerStart[hi], endSeg, cut.extrusion);
  const drawnSegs = gcode.layerStart[hi] - startSeg + cutSeg;
  refs.gcodeLines.geometry.setDrawRange(startSeg * 2, drawnSegs * 2);
  if (refs.gcodeRibbons) {
    const geometry = refs.gcodeRibbons.geometry as THREE.InstancedBufferGeometry;
    // An instanced draw range clips the quad, not its instances. Limit the instance count and let
    // the shader select from the shared buffers at the first segment of the window.
    geometry.setDrawRange(0, Infinity);
    geometry.instanceCount = drawnSegs;
    ((refs.gcodeRibbons.material as ToolpathMaterial).uniforms.uFirst.value as number) = startSeg;
  }
  // hidden feature types are collapsed to zero-length segments
  const posAttr = refs.gcodeLines.geometry.getAttribute('position') as THREE.BufferAttribute;
  const src = gcode.positions;
  const dst = posAttr.array as Float32Array;
  const hidden = gcode.featureTypes.map((t) => visibility[t] === false);
  if (hidden.some(Boolean) || (refs.gcodeLines.userData.masked as boolean)) {
    for (let i = startSeg; i < startSeg + drawnSegs; i++) {
      const o = i * 6;
      if (hidden[gcode.types[i]]) {
        dst[o + 3] = src[o];
        dst[o + 4] = src[o + 1];
        dst[o + 5] = src[o + 2];
      } else {
        dst[o + 3] = src[o + 3];
        dst[o + 4] = src[o + 4];
        dst[o + 5] = src[o + 5];
      }
    }
    posAttr.needsUpdate = true;
    const ribbonPositions = refs.gcodeRibbons?.geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute | undefined;
    if (ribbonPositions) {
      ribbonPositions.data.needsUpdate = true;
      const material = refs.gcodeRibbons?.material as ToolpathMaterial | undefined;
      if (material) material.refresh('position');
    }
    refs.gcodeLines.userData.masked = hidden.some(Boolean);
    refs.gcodeLines.geometry.computeBoundingSphere();
  }
  if (refs.travelLines) {
    const ts = gcode.travelLayerStart[lo];
    const te = gcode.travelLayerStart[hi + 1];
    const tn = te - ts - countUpTo(gcode.travelMove, gcode.travelLayerStart[hi], te, cut.travel);
    refs.travelLines.visible = showTravel;
    refs.travelLines.geometry.setDrawRange(ts * 2, tn * 2);
  }
  if (refs.wipeLines) {
    const ws = gcode.wipeLayerStart[lo];
    const we = gcode.wipeLayerStart[hi + 1];
    const wn = we - ws - countUpTo(gcode.wipeMove, gcode.wipeLayerStart[hi], we, cut.wipe);
    refs.wipeLines.visible = markers.wipe;
    refs.wipeLines.geometry.setDrawRange(ws * 2, wn * 2);
  }
  if (refs.markerPoints) {
    for (let k = 0; k < MARKER_KINDS.length; k++) {
      const kind = MARKER_KINDS[k];
      const points = refs.markerPoints.get(kind);
      if (!points) continue;
      const { layer, move, count } = points.userData as { layer: Uint32Array; move: Uint32Array; count: number };
      // markers of one kind are ordered by layer, so a layer is a contiguous range; only the top
      // layer is additionally cut at the slider's move. Both ends come from binary searches.
      const from = lowerBound(layer, lo, count);
      const to = Math.min(upperBound(layer, hi, count), upperBound(move, cut.marker, count));
      points.geometry.setDrawRange(from, Math.max(0, to - from));
      points.visible = markers[kind];
    }
  }
  if (refs.toolMarker) {
    const pos =
      cut.extrusion < 0 && cut.travel < 0 && cut.wipe < 0 ? undefined : toolPosition(gcode, Math.max(cut.extrusion, cut.travel, cut.wipe));
    refs.toolMarker.visible = !!pos && hi >= lo;
    if (pos) refs.toolMarker.position.set(pos[0], pos[1], pos[2]);
  }
}

interface GcodePreviewOptions {
  gcode?: ParsedGcode;
  view: View;
  /** visible layer range */
  range: [number, number];
  /** position of the horizontal slider inside the top layer, `undefined` for the whole layer */
  moveCut?: number;
  showTravel: boolean;
  markerVis: Record<MarkerKind, boolean>;
  featureVis: Record<string, boolean>;
  colorMode: PreviewColorMode;
  customGcodes: CustomGcode[];
  filamentColour?: string;
  /** per-tool filament colours, joined - the identity of the colouring */
  toolColorKey: string;
  /** the plate fails the checks while a result is on screen: draw the result greyed out (Z-06) */
  outdated: boolean;
}

/** The ribbon width follows zoom, projection and canvas size without rebuilding any segment. */
export function updatePreviewPathSize(refs: SceneRefs): void {
  if (!refs.gcodeRibbons) return;
  const height = refs.renderer.getSize(new THREE.Vector2()).y;
  const scale = pixelsPerMillimetre(refs.renderer, refs.camera, refs.controls.target);
  const key = `${height}:${scale.toFixed(4)}:${refs.camera.type}`;
  if (key === refs.pathSizeKey) return;
  const wide = toolpathMode(window.location.search) === 'adaptive' && wideToolpaths(scale, FALLBACK_EXTRUSION_WIDTH);
  refs.gcodeRibbons.visible = wide;
  if (refs.gcodeLines) refs.gcodeLines.visible = !wide;
  const material = refs.gcodeRibbons.material as ToolpathMaterial;
  material.uniforms.resolution.value = height;
  const ortho = refs.camera as THREE.OrthographicCamera;
  material.setFovScale(ortho.isOrthographicCamera ? 1 / (2 * scale) : Math.tan((refs.persp.fov * Math.PI) / 360) / height);
  const markerScale = Math.max(0.6, 8 / scale);
  refs.toolMarker?.scale.setScalar(markerScale);
  refs.pathSizeKey = key;
}

export function useGcodePreview(refsRef: RefObject<SceneRefs | null>, options: GcodePreviewOptions) {
  const {
    gcode,
    view,
    range,
    moveCut,
    showTravel,
    markerVis,
    featureVis,
    colorMode,
    customGcodes,
    filamentColour,
    toolColorKey,
    outdated,
  } = options;
  useEffect(() => {
    const refs = refsRef.current;
    if (!refs) return;
    const coloring: GcodeColoring = {
      mode: colorMode,
      baseColor: normalizeColor(filamentColour),
      codes: customGcodes,
      toolColors: toolColorKey.split(','),
      outdated,
    };
    if (gcode && refs.gcodeRef !== gcode) buildGcode(refs, gcode, coloring);
    else if (gcode && refs.gcodeLines && refs.colorKey !== coloringKey(coloring)) {
      // recolour in place (colour mode, colour changes edited, or the plate started/stopped failing)
      const attr = refs.gcodeLines.geometry.getAttribute('color') as THREE.BufferAttribute;
      fillGcodeColors(attr.array as Float32Array, gcode, coloring);
      attr.needsUpdate = true;
      const ribbonColors = refs.gcodeRibbons?.geometry.getAttribute('instanceColorStart') as THREE.InterleavedBufferAttribute | undefined;
      if (ribbonColors) {
        ribbonColors.data.needsUpdate = true;
        const material = refs.gcodeRibbons?.material as ToolpathMaterial | undefined;
        if (material) material.refresh('color');
      }
      refs.colorKey = coloringKey(coloring);
    }
    if (!gcode) {
      clearAndDispose(refs.gcodeGroup);
      refs.gcodeRef = undefined;
      refs.gcodeLines = undefined;
    }
    if (gcode) applyOutdatedLook(refs, outdated);
    refs.gcodeGroup.visible = view === 'preview' && !!gcode;
    if (gcode) {
      const topLayer = Math.max(0, Math.min(range[1], gcode.layerCount - 1));
      const window = moveWindow(gcode, topLayer);
      const cut =
        moveCut === undefined
          ? { ...window.end, marker: Number.MAX_SAFE_INTEGER }
          : { extrusion: moveCut, travel: moveCut, wipe: moveCut, marker: moveCut };
      applyGcodeRange(refs, gcode, range, cut, showTravel, markerVis, featureVis);
      updatePreviewPathSize(refs);
    }
    // `refsRef` is a stable ref object owned by the Viewer; its content changes without a re-render
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable ref, not a dependency
  }, [gcode, view, range, moveCut, showTravel, markerVis, featureVis, colorMode, customGcodes, filamentColour, toolColorKey, outdated]);
}
