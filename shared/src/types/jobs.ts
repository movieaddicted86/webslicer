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
  /**
   * Variable layer height profile (T-045): flat `[z0, h0, z1, h1, …]` pairs on the object's own Z axis,
   * written into the 3MF as PrusaSlicer's `Slic3r_PE_layer_heights_profile.txt`. Where a profile and a
   * height range both set a layer height, the profile wins (PrusaSlicer's behaviour).
   */
  layerProfile?: number[];
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

/** One finding of the G-code preflight (S1-c): a send-gate issue plus the line it stands on. */
export interface PreflightIssue extends SendIssue {
  /** 1-based line number in the file */
  line: number;
  /** the line as it stands in the file (comments included, trimmed) */
  text: string;
}

/**
 * The stored preflight result of a job (`GcodeInfo.preflight`). `version` names the rule set that
 * produced it, so a newer server can re-scan a stored file instead of trusting old rules.
 */
export interface PreflightResult {
  version: number;
  /** at most one cap per rule, in line order */
  issues: PreflightIssue[];
  /** how often each rule fired – the capped-out issues included */
  counts: Record<string, number>;
  /**
   * The highest hotend/bed temperature the file really commands (q6-preflight, N3). The stored rule
   * set keeps only the global catchers, so this is what the send gate compares with the target
   * printer's `safety` limits. A result without it (an older rule set) is re-scanned.
   */
  maxTemperatures?: MaxTemperatures;
  /**
   * The scan of the **settings** that produce the file (T-080, P-1): the custom G-code of the merged
   * config and the plater's custom G-code entries, read with the same rules. It is what protects a
   * binary output, whose body the preflight never reads.
   */
  config?: ConfigPreflightScan;
}

/**
 * The settings side of the preflight: the custom G-code a job carries, scanned before the slicer runs
 * (`start_gcode`, `end_gcode`, the plater's entries, …). Same rule ids and severity as the file scan,
 * so the send gate and the preview treat both alike. `line` counts inside the block the finding came
 * from; the message names the setting, because the file line of a binary output is not readable.
 */
export interface ConfigPreflightScan {
  version: number;
  issues: PreflightIssue[];
  counts: Record<string, number>;
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
  /** what the preflight found in the output (S1-c); missing means "not scanned" */
  preflight?: PreflightResult;
  sizeBytes: number;
}

/** The highest temperature a job asks for, per kind (S1-d) – what a printer's safety profile is compared against. */
export interface MaxTemperatures {
  hotend: number;
  bed: number;
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
  /** the configuration-limit warnings of the request (S1-d); a block never reaches a job */
  configIssues?: ConfigIssue[];
  /**
   * The highest hotend/bed temperature the request asks for (S1-d). The send dialog compares it against
   * the safety profile of the chosen host; a job from before S1-d has no field (the server reads its
   * stored request instead).
   */
  temperatures?: MaxTemperatures;
}

/** Server-sent event of a running job (`/api/jobs/<id>/events`). */
export interface JobEvent {
  type: 'progress' | 'log' | 'done' | 'error' | 'status';
  percent?: number;
  message?: string;
  line?: string;
  job?: JobRecord;
}

/** `block` refuses a send (unless it is overridden with a reason); `warn` only asks for a confirmation. */
export type SendIssueSeverity = 'block' | 'warn';

/**
 * One finding of the send gate (S1-b): `rule` is the stable id (`send.preset_mismatch`,
 * `send.no_binding`, later `preflight.*`), `message` is written for the person about to print.
 */
export interface SendIssue {
  rule: string;
  severity: SendIssueSeverity;
  message: string;
}

/**
 * One finding of the configuration limits (S1-d): a `SendIssue` that also names the setting behind it
 * – the key (`temperature[1]`, `nozzle_diameter`), the value as it was sent and the limit it broke.
 * The slice routes answer with these, so the client can point at the field.
 */
export interface ConfigIssue extends SendIssue {
  key: string;
  value: string;
  limit: string;
}

/** What `POST /api/jobs/:id/send` answers when the upload was accepted. */
export interface SendResult {
  ok: boolean;
  message: string;
  /** what the send was accepted despite: warnings, or the blocks an override covered */
  issues: SendIssue[];
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
  /** variable layer height profile (T-045), read from PrusaSlicer's `Slic3r_PE_layer_heights_profile.txt` */
  layerProfile?: number[];
}
