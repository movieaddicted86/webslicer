export interface ParsedGcode {
  /** xyz pairs per segment (6 floats per segment) for extrusion moves */
  positions: Float32Array;
  /** feature type index per segment */
  types: Uint8Array;
  /** layer index per segment */
  layers: Uint32Array;
  /** tool index per segment */
  tools: Uint8Array;
  /** travel segments */
  travelPositions: Float32Array;
  travelLayers: Uint32Array;
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
