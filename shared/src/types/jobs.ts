/**
 * Slicing jobs and the objects a slice request carries (R-2, F-08), plus their runtime companions:
 * the const arrays sit next to the unions they enumerate so the two cannot drift apart.
 */
import type { Config } from './common.js';

/** Sub-volume kinds of a 3MF project (PrusaSlicer's `volume_type`). */
export type VolumeType = 'ModelPart' | 'ParameterModifier' | 'SupportEnforcer' | 'SupportBlocker' | 'NegativeVolume';

/** Every `VolumeType`, in the order PrusaSlicer knows them. */
export const VOLUME_TYPES: VolumeType[] = ['ModelPart', 'ParameterModifier', 'SupportEnforcer', 'SupportBlocker', 'NegativeVolume'];

/** Kinds of custom G-code inserted at a print Z. */
export type CustomGcodeType = 'color_change' | 'pause' | 'tool_change' | 'template' | 'custom';

/** Every `CustomGcodeType`; the index is the numeric id in 3MF's custom G-code XML. */
export const CUSTOM_GCODE_TYPES: CustomGcodeType[] = ['color_change', 'pause', 'tool_change', 'template', 'custom'];

/** Custom G-code inserted before printing the layer at `printZ` (PrusaSlicer's vertical slider "+"). */
export interface CustomGcode {
  printZ: number;
  type: CustomGcodeType;
  /** 1-based extruder (colour change / tool change) */
  extruder?: number;
  /** colour after a colour change, "#RRGGBB" */
  color?: string;
  /** pause message or custom G-code text */
  extra?: string;
}

/** Height-range modifier (object Z, mm) with the settings that apply between the two heights. */
export interface LayerRangeInput {
  minZ: number;
  maxZ: number;
  config: Config;
}

export type ThumbnailFormat = 'PNG' | 'JPG' | 'QOI';

export interface ThumbnailInput {
  width: number;
  height: number;
  format: ThumbnailFormat;
  /** base64 image data */
  data: string;
}

export interface SliceVolumeInput {
  modelId: string;
  name: string;
  type: VolumeType;
  /** transform relative to the object (column-major 4x4) */
  transform: number[];
  config?: Config;
  extruder?: number;
}

export interface SliceObjectInput {
  modelId: string;
  name: string;
  /** transform of instance 1 (kept for older clients) */
  transform: number[];
  /** all instance transforms (including the first) when the object has more than one instance */
  instances?: number[][];
  config?: Config;
  extruder?: number;
  volumes?: SliceVolumeInput[];
  /** per-triangle paint of the main mesh: one char per triangle ('0' none, '4' enforcer, '8' blocker) */
  supportPaint?: string;
  seamPaint?: string;
  /** one hex char per triangle = extruder index */
  mmuPaint?: string;
  ranges?: LayerRangeInput[];
}

export interface SliceRequest {
  objects: SliceObjectInput[];
  /** previews rendered by the browser, embedded into the G-code by the server */
  thumbnails?: ThumbnailInput[];
  /** colour changes, pauses and custom G-code at layer heights */
  customGcodes?: CustomGcode[];
  print: { name: string; config: Config };
  filaments: Array<{ name: string; config: Config }>;
  printer: { name: string; config: Config };
  outputName?: string;
  /** Emit binary G-code (.bgcode) when the printer supports it. Default: ASCII (previewable). */
  binaryGcode?: boolean;
}

/** What the server parsed out of a G-code; every field is optional because the slicer may skip it. */
export interface GcodeInfo {
  generator?: string;
  estimatedTime?: string;
  estimatedTimeSeconds?: number;
  estimatedFirstLayerTime?: string;
  filamentUsedMm?: number[];
  filamentUsedCm3?: number[];
  filamentUsedG?: number[];
  filamentCost?: number[];
  totalFilamentG?: number;
  totalFilamentCost?: number;
  layerHeight?: number;
  firstLayerHeight?: number;
  maxZ?: number;
  layers?: number;
  /** warnings PrusaSlicer printed while the job still produced a G-code */
  warnings?: string[];
  sizeBytes: number;
}

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export interface JobRecord {
  id: string;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  percent: number;
  message: string;
  error?: string;
  outputName: string;
  technology: 'FFF' | 'SLA';
  info?: GcodeInfo;
  presets: { print: string; filaments: string[]; printer: string };
  objectNames: string[];
}

/** Server-sent event of a running job (`/api/jobs/<id>/events`). */
export interface JobEvent {
  type: 'progress' | 'log' | 'done' | 'error' | 'status';
  percent?: number;
  message?: string;
  line?: string;
  job?: JobRecord;
}

/** One sub-volume of a 3MF project: a triangle range inside the object mesh plus its settings. */
export interface ProjectVolume {
  name: string;
  type: VolumeType;
  /** first/last triangle index inside the object's mesh */
  first: number;
  last: number;
  config: Config;
  extruder?: number;
  /** PrusaSlicer volume matrix (row-major 4x4, 16 values) if present */
  matrix?: number[];
}

/** One object of a 3MF project. */
export interface ProjectObject {
  name: string;
  config: Config;
  extruder?: number;
  /** instance transforms (column-major 4x4, includes the first) in build order */
  instances: number[][];
  volumes: ProjectVolume[];
  supportPaint?: string;
  seamPaint?: string;
  mmuPaint?: string;
  ranges?: LayerRangeInput[];
}
