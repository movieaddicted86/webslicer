/** Kinds of G-code markers shown in the preview (PrusaSlicer's marker list). */
export type MarkerKind = 'retract' | 'deretract' | 'seam' | 'wipe' | 'tool_change' | 'color_change';

/** Marker kinds in the order the parser stores them in `ParsedGcode.markerKind`. */
export const MARKER_KINDS: MarkerKind[] = ['retract', 'deretract', 'seam', 'wipe', 'tool_change', 'color_change'];

/** PrusaSlicer's marker colours. */
export const MARKER_COLORS: Record<MarkerKind, string> = {
  retract: '#ff00ff',
  deretract: '#00ff80',
  seam: '#c8c8c8',
  wipe: '#ffff00',
  tool_change: '#ff0000',
  color_change: '#7a8ba8',
};

export interface ParsedGcode {
  /** xyz pairs per segment (6 floats per segment) for extrusion moves */
  positions: Float32Array;
  /** feature type index per segment */
  types: Uint8Array;
  /** layer index per segment */
  layers: Uint32Array;
  /** tool index per segment */
  tools: Uint8Array;
  /** global move index per extrusion segment (G-code order, strictly increasing) */
  moveIndex: Uint32Array;
  /** travel segments */
  travelPositions: Float32Array;
  travelLayers: Uint32Array;
  /** global move index per travel segment, in the same counter as `moveIndex` */
  travelMove: Uint32Array;
  /** wipe segments (between ;WIPE_START and ;WIPE_END) – neither extrusions nor travels */
  wipePositions: Float32Array;
  wipeLayers: Uint32Array;
  wipeMove: Uint32Array;
  /** first wipe segment per layer (length layerCount+1) */
  wipeLayerStart: Uint32Array;
  wipeCount: number;
  /** markers, in G-code order: kind index into `MARKER_KINDS`, position, layer, move index */
  markerKind: Uint8Array;
  markerPositions: Float32Array;
  markerLayer: Uint32Array;
  markerMove: Uint32Array;
  markerCount: number;
  /** z per layer */
  layerZ: Float32Array;
  layerCount: number;
  featureTypes: string[];
  /** first segment index per layer (length layerCount+1) */
  layerStart: Uint32Array;
  travelLayerStart: Uint32Array;
  bbox: { min: [number, number, number]; max: [number, number, number] };
  segmentCount: number;
  /** per-feature extrusion length (mm) */
  featureLength: Record<string, number>;
  /** per-feature estimated time (s), from feedrates like `layerTime`; travel under `"Travel"` */
  featureTime: Record<string, number>;
  /** per extrusion segment: feedrate (mm/s) */
  speed: Float32Array;
  /** per extrusion segment: part cooling fan (%) */
  fan: Float32Array;
  /** per extrusion segment: nozzle temperature (°C) */
  temperature: Float32Array;
  /** per extrusion segment: extrusion width (mm, from ;WIDTH:) */
  width: Float32Array;
  /** per extrusion segment: layer height (mm, from ;HEIGHT:) */
  height: Float32Array;
  /** per extrusion segment: volumetric flow (mm³/s) */
  flow: Float32Array;
  /** estimated time per layer (s), from feedrates and move lengths (no acceleration) */
  layerTime: Float32Array;
}

export const FEATURE_COLORS: Record<string, string> = {
  Perimeter: '#ffe64d',
  'External perimeter': '#ff7d38',
  'Overhang perimeter': '#1f1fff',
  'Internal infill': '#b03029',
  'Solid infill': '#9654cc',
  'Top solid infill': '#f04040',
  Ironing: '#ff8c69',
  'Bridge infill': '#4d80ba',
  'Gap fill': '#ffffff',
  'Skirt/Brim': '#00876e',
  'Support material': '#00ff00',
  'Support material interface': '#008000',
  'Wipe tower': '#b3e3ab',
  Custom: '#5ed194',
  Unknown: '#a0a0a0',
};
