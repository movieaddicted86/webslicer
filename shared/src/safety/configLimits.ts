/**
 * Configuration limits (S1-d, T-032): what a value in a slice request may be before it is dangerous.
 *
 * S1-c reads the *finished G-code*; this module reads the *settings* that produce it, while a job is
 * still just a request. Nothing else bounded them: a typo (`temperature = 2150`, `bed_temperature =
 * 1100`) sliced happily and was only caught later – and only if the file was sent – by the wide
 * G-code catchers. Two levels, as decided in Q-005:
 *
 * - **Global typo catchers (block).** Wide enough that no legitimate machine trips them, narrow enough
 *   that a mistyped value cannot reach the slicer: hotend temperatures are `0` (off) or 150–450 °C,
 *   bed 0–150 °C, chamber 0–100 °C, nozzle 0.1–2.0 mm, layer height > 0 and at most twice the nozzle
 *   (see `LAYER_HEIGHT_NOZZLE_FACTOR`). `0` is what PrusaSlicer means by "off" and is allowed
 *   everywhere it is meaningful.
 * - **Soft ranges by `filament_type` (warn).** "PLA at 265 °C is unusual", "abs at bed 50 °C is
 *   unusual" – the printed material changes, not the machine, so a value outside the usual window is
 *   worth a confirmation but no block. The numbers come from PrusaSlicer 2.9.6's own system filament
 *   profiles (`resources/profiles/*.ini`): the observed range per type, rounded outwards. Source ranges:
 *
 *   | type          | hotend (2.9.6) | bed (2.9.6) |
 *   | ------------- | -------------- | ----------- |
 *   | PLA (PLA-CF)  | 175–250        | 30–80       |
 *   | PETG          | 210–285        | 60–110      |
 *   | ABS           | 230–270        | 70–110      |
 *   | ASA           | 220–275        | 55–110      |
 *   | TPU / FLEX    | 195–260        | 30–100      |
 *   | PA / NYLON    | 235–300        | 40–130      |
 *   | PC            | 255–290        | 95–120      |
 *
 * Each window below is that range, rounded outwards to a 5 °C step – a shipped preset is inside its
 * window by construction, and only a value clearly off the material's working window warns. The vendor
 * sweep (`server/scripts/limits-sweep.ts`) reports the resulting numbers; the task's example ("PLA at
 * 265 °C is unusual") still warns.
 *
 * Every check is pure and works on the raw config strings of a request, so the REST routes, the MCP
 * tools, the send gate and the vendor sweep share one implementation. Per-extruder vectors are checked
 * element-wise (`temperature = 215,2150` reports the second one); `nil` elements (nullable vectors)
 * and missing keys are skipped.
 */
import type { Config } from '../types/common.js';
import type { ConfigIssue, MaxTemperatures, SendIssue, SendIssueSeverity } from '../types/jobs.js';
import type { PhysicalPrinter } from '../types/presets.js';
/** The hotend temperature keys of the filament scope (one vector element per extruder). */
const HOTEND_KEYS = ['temperature', 'first_layer_temperature'] as const;
/** The bed temperature keys of the filament scope. */
const BED_KEYS = ['bed_temperature', 'first_layer_bed_temperature'] as const;
/** The chamber keys of the filament scope. */
const CHAMBER_KEYS = ['chamber_temperature', 'chamber_minimal_temperature'] as const;

/** The global typo catchers. `0` means "off" for PrusaSlicer and is always allowed. */
export const GLOBAL_LIMITS = {
  hotend: { min: 150, max: 450, unit: '°C' },
  bed: { min: 0, max: 150, unit: '°C' },
  chamber: { min: 0, max: 100, unit: '°C' },
  nozzleDiameter: { min: 0.1, max: 2.0, unit: 'mm' },
} as const;

/**
 * The widest layer height as a multiple of the nozzle diameter.
 *
 * The task asked for "≤ nozzle", but the 2.9.6 vendor sweep found 638 print-preset/printer pairs
 * above that – shipped drafts up to **1.6×** the nozzle (`0.4mm 0.25nozzle` on a 0.25 mm Voron, a
 * 0.3 mm ULTRADRAFT on a 0.2 mm nozzle), which PrusaSlicer slices without complaint. A block at 1×
 * would refuse presets the slicer itself ships, so the catcher sits at 2× – still far below a typo
 * (`layer_height = 10` on a 0.4 mm nozzle is caught), and the vendor sweep reports 0 blocks.
 */
export const LAYER_HEIGHT_NOZZLE_FACTOR = 2;

/** The severity of each rule of this module. */
export const CONFIG_LIMIT_SEVERITY: Readonly<Record<string, SendIssueSeverity>> = {
  'config.hotend_limit': 'block',
  'config.bed_limit': 'block',
  'config.chamber_limit': 'block',
  'config.nozzle_diameter': 'block',
  'config.layer_height': 'block',
  'config.filament_temperature': 'warn',
  'config.filament_bed_temperature': 'warn',
  'send.printer_limit': 'block',
};

/** A hotend/bed window a material is usually printed in, and where the numbers come from. */
export interface SoftRange {
  hotend?: readonly [number, number];
  bed?: readonly [number, number];
}

/**
 * The soft ranges by `filament_type`. A range is a warning window, not a limit: it is widened beyond
 * the observed system-preset values (see the module doc) so that ordinary material variants do not
 * warn on every slice.
 */
export const FILAMENT_SOFT_RANGES: Readonly<Record<string, SoftRange>> = {
  PLA: { hotend: [175, 255], bed: [30, 85] },
  PETG: { hotend: [205, 290], bed: [55, 115] },
  ABS: { hotend: [225, 280], bed: [65, 120] },
  ASA: { hotend: [215, 285], bed: [50, 120] },
  TPU: { hotend: [190, 260], bed: [25, 100] },
  PA: { hotend: [230, 300], bed: [40, 130] },
  PC: { hotend: [255, 300], bed: [90, 125] },
};

/** Where a `filament_type` value lands in the soft range table; `undefined` for anything else. */
export function softRangeOf(filamentType: string): SoftRange | undefined {
  const t = filamentType.trim().toUpperCase().replace(/\s+/g, '');
  if (!t) return undefined;
  if (FILAMENT_SOFT_RANGES[t]) return FILAMENT_SOFT_RANGES[t];
  // a suffixed variant ("PLA-CF", "NYLON-CF", "ASA ...") uses the base material's window
  const base = Object.keys(FILAMENT_SOFT_RANGES).find((key) => t === key || t.startsWith(`${key}-`) || t.startsWith(`${key}_`));
  if (base) return FILAMENT_SOFT_RANGES[base];
  // the 2.9.6 bundles spell some materials differently
  if (t === 'FLEX' || t.startsWith('TPU')) return FILAMENT_SOFT_RANGES.TPU;
  if (t === 'NYLON' || t.startsWith('NYLON')) return FILAMENT_SOFT_RANGES.PA;
  return undefined;
}

/** A numeric value of a config: `215`, `0.4`, `nil`, or something that is not a number at all. */
type Element = { kind: 'number'; value: number } | { kind: 'nil' } | { kind: 'other'; text: string };

function elementOf(text: string): Element {
  const t = text.trim();
  if (t === '') return { kind: 'nil' };
  if (t.toLowerCase() === 'nil') return { kind: 'nil' };
  const n = Number(t);
  return t !== '' && Number.isFinite(n) ? { kind: 'number', value: n } : { kind: 'other', text: t };
}

/** The elements of a config value; a scalar is a one-element vector. */
function elementsOf(raw: string | undefined): { index: number; text: string; element: Element }[] {
  if (raw === undefined) return [];
  return raw.split(',').map((text, index) => ({ index, text, element: elementOf(text) }));
}

/** `temperature[1]` when a vector has more than one element, `temperature` otherwise. */
function keyLabel(key: string, index: number, size: number): string {
  return size > 1 ? `${key}[${index}]` : key;
}

/** A number as it reads in a message: `2150`, `0.4`. */
function num(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

function issue(rule: string, key: string, value: string, message: string, limit: string): ConfigIssue {
  return { rule, severity: CONFIG_LIMIT_SEVERITY[rule] ?? 'warn', message, key, value, limit };
}

/** A temperature vector against a hard window; `0` stays allowed, `nil`/missing are skipped. */
function temperatureIssues(
  rule: string,
  key: string,
  raw: string | undefined,
  window: { min: number; max: number; unit: string },
  what: string,
): ConfigIssue[] {
  const out: ConfigIssue[] = [];
  const items = elementsOf(raw);
  for (const { index, text, element } of items) {
    if (element.kind !== 'number' || element.value === 0) continue;
    if (element.value >= window.min && element.value <= window.max) continue;
    const label = keyLabel(key, index, items.length);
    const limit = `${window.min}–${window.max} ${window.unit} (or 0)`;
    out.push(
      issue(
        rule,
        label,
        text.trim(),
        `${label} = ${num(element.value)} ${window.unit} is outside the allowed ${limit} – the ${what} would not be reached or would be damaged.`,
        limit,
      ),
    );
  }
  return out;
}

/** A numeric vector against a hard window (no "off" value). */
function rangeIssues(
  rule: string,
  key: string,
  raw: string | undefined,
  window: { min: number; max: number; unit: string },
  message: (label: string, value: number, limit: string) => string,
): ConfigIssue[] {
  const out: ConfigIssue[] = [];
  const items = elementsOf(raw);
  for (const { index, text, element } of items) {
    if (element.kind !== 'number') continue;
    if (element.value >= window.min && element.value <= window.max) continue;
    const label = keyLabel(key, index, items.length);
    const limit = `${window.min}–${window.max} ${window.unit}`;
    out.push(issue(rule, label, text.trim(), message(label, element.value, limit), limit));
  }
  return out;
}

/**
 * The issues of one config section.
 *
 * - `filament`: the hotend, bed and chamber temperatures, plus the soft ranges of its `filament_type`.
 * - `printer`: `nozzle_diameter`.
 * - `print` / `sla_print`: `layer_height` (against `options.nozzleDiameter` when the caller knows it).
 */
export function checkConfigValues(
  type: 'filament' | 'printer' | 'print' | 'sla_print' | 'sla_material',
  config: Readonly<Config>,
  options: { nozzleDiameter?: string } = {},
): ConfigIssue[] {
  const out: ConfigIssue[] = [];
  if (type === 'filament' || type === 'sla_material') {
    for (const key of HOTEND_KEYS) out.push(...temperatureIssues('config.hotend_limit', key, config[key], GLOBAL_LIMITS.hotend, 'hotend'));
    for (const key of BED_KEYS) out.push(...temperatureIssues('config.bed_limit', key, config[key], GLOBAL_LIMITS.bed, 'bed'));
    for (const key of CHAMBER_KEYS)
      out.push(...temperatureIssues('config.chamber_limit', key, config[key], GLOBAL_LIMITS.chamber, 'chamber'));
    if (type === 'filament') {
      // a value that already broke a hard limit is not reported a second time as "unusual"
      const blocked = new Set(out.map((i) => i.key));
      out.push(...softRangeIssues(config).filter((i) => !blocked.has(i.key)));
    }
    return out;
  }
  if (type === 'printer') {
    out.push(
      ...rangeIssues('config.nozzle_diameter', 'nozzle_diameter', config.nozzle_diameter, GLOBAL_LIMITS.nozzleDiameter, nozzleMessage),
    );
    return out;
  }
  out.push(...layerHeightIssues(config.layer_height, options.nozzleDiameter));
  return out;
}

/** `layer_height` has to be positive and cannot exceed the nozzle. `nil` is skipped. */
function layerHeightIssues(raw: string | undefined, nozzleRaw: string | undefined): ConfigIssue[] {
  if (raw === undefined) return [];
  const element = elementOf(raw);
  if (element.kind === 'nil') return [];
  if (element.kind !== 'number') {
    return [issue('config.layer_height', 'layer_height', raw.trim(), `layer_height = "${raw.trim()}" is not a number.`, '> 0 mm')];
  }
  if (element.value <= 0) {
    return [
      issue('config.layer_height', 'layer_height', raw.trim(), `layer_height = ${num(element.value)} mm must be greater than 0.`, '> 0 mm'),
    ];
  }
  // the nozzle is a printer value; a request without one (or a `nil` nozzle) cannot be compared
  const nozzle = elementsOf(nozzleRaw).find((n) => n.element.kind === 'number' && n.element.value > 0);
  if (nozzle?.element.kind === 'number' && element.value > nozzle.element.value * LAYER_HEIGHT_NOZZLE_FACTOR) {
    const max = nozzle.element.value * LAYER_HEIGHT_NOZZLE_FACTOR;
    const limit = `at most ${num(LAYER_HEIGHT_NOZZLE_FACTOR)}× the nozzle diameter (${num(max)} mm)`;
    return [
      issue(
        'config.layer_height',
        'layer_height',
        raw.trim(),
        `layer_height = ${num(element.value)} mm is more than ${num(LAYER_HEIGHT_NOZZLE_FACTOR)}× the nozzle diameter (${num(nozzle.element.value)} mm).`,
        limit,
      ),
    ];
  }
  return [];
}

/**
 * The soft-range warnings of one filament config.
 *
 * `filament_type` is a per-extruder vector as well, and element *i* of it belongs to element *i* of
 * the temperatures; a type vector shorter than the temperatures repeats its last entry (the way
 * PrusaSlicer resizes per-extruder vectors). A type outside the table (PVA, HIPS, …) warns for no
 * range at all – a material WebSlicer knows nothing about cannot be judged.
 */
function softRangeIssues(config: Readonly<Config>): ConfigIssue[] {
  const out: ConfigIssue[] = [];
  const types = elementsOf(config.filament_type);
  const typeAt = (index: number): string => {
    if (!types.length) return '';
    return types[Math.min(index, types.length - 1)].text.trim();
  };
  const check = (rule: string, key: string, kind: keyof SoftRange): void => {
    const values = elementsOf(config[key]);
    for (const { index, text, element } of values) {
      if (element.kind !== 'number' || element.value === 0) continue;
      const type = typeAt(index);
      const window = softRangeOf(type)?.[kind];
      if (!window) continue;
      if (element.value >= window[0] && element.value <= window[1]) continue;
      const label = keyLabel(key, index, values.length);
      const limit = `${window[0]}–${window[1]} °C for ${type}`;
      out.push(
        issue(
          rule,
          label,
          text.trim(),
          `${label} = ${num(element.value)} °C is unusual for ${type} (usual: ${window[0]}–${window[1]} °C) – the print result may suffer.`,
          limit,
        ),
      );
    }
  };
  check('config.filament_temperature', 'temperature', 'hotend');
  check('config.filament_temperature', 'first_layer_temperature', 'hotend');
  check('config.filament_bed_temperature', 'bed_temperature', 'bed');
  check('config.filament_bed_temperature', 'first_layer_bed_temperature', 'bed');
  return out;
}

/** What the checks need of a slice request: the three config sections. */
export interface ConfigLimitRequest {
  print?: { config?: Readonly<Config> };
  printer?: { config?: Readonly<Config> };
  filaments?: ReadonlyArray<{ config?: Readonly<Config> }>;
}

/**
 * The temperature keys one config section may contribute, whatever section it is (q6-preflight, N3).
 * A request can carry `temperature = 999` in its *printer* config: the slicer may or may not keep it
 * after the merge, but a value that far off is a typo and must not reach it in the first place.
 */
function sectionTemperatures(
  type: 'filament' | 'printer' | 'print' | 'sla_print' | 'sla_material',
  config: Readonly<Config>,
): ConfigIssue[] {
  const out: ConfigIssue[] = [];
  for (const key of HOTEND_KEYS) out.push(...temperatureIssues('config.hotend_limit', key, config[key], GLOBAL_LIMITS.hotend, 'hotend'));
  for (const key of BED_KEYS) out.push(...temperatureIssues('config.bed_limit', key, config[key], GLOBAL_LIMITS.bed, 'bed'));
  for (const key of CHAMBER_KEYS)
    out.push(...temperatureIssues('config.chamber_limit', key, config[key], GLOBAL_LIMITS.chamber, 'chamber'));
  if (type === 'filament') {
    // a value that already broke a hard limit is not reported a second time as "unusual"
    const blocked = new Set(out.map((i) => i.key));
    out.push(...softRangeIssues(config).filter((i) => !blocked.has(i.key)));
  }
  return out;
}

/** A per-object or per-range `layer_height` at `where` (`object[1]`, `object[1].range[0]`). */
export function objectLayerHeightIssues(layerHeight: string | undefined, nozzleDiameter: string | undefined, where: string): ConfigIssue[] {
  return layerHeightIssues(layerHeight, nozzleDiameter).map((issue) => ({
    ...issue,
    key: `${where}.${issue.key}`,
    message: `${where}: ${issue.message}`,
  }));
}

/** The identity of an issue for de-duplication: the same finding reported by two views is one. */
function issueId(issue: ConfigIssue): string {
  return `${issue.rule}|${issue.key}|${issue.value}`;
}

/**
 * Every limit issue of a slice request, the way the server checks it before queueing a job.
 *
 * On top of {@link checkConfigLimits} (the preset sections), this adds what the single-section view
 * misses (q6-preflight, N3):
 *
 * - **temperatures in the printer and print sections** – a `temperature = 999` in a printer config is
 *   checked like a filament one, and the soft ranges of a print section's `filament_type` too,
 * - the **merged config** the slicer really receives (`options.merged`, from `mergeConfigs`) – so a
 *   value that only becomes visible through the merge is still caught,
 * - the **per-object and per-height-range `layer_height`** overrides, checked against the nozzle like
 *   the print preset's.
 *
 * A finding that two of these views produce is reported once, under its first (most specific) key.
 */
export function checkRequestConfigLimits(
  request: ConfigLimitRequest & {
    objects?: ReadonlyArray<{ config?: Readonly<Config>; ranges?: ReadonlyArray<{ config?: Readonly<Config> }> }>;
    merged?: Readonly<Config>;
  },
): ConfigIssue[] {
  const out: ConfigIssue[] = [];
  const seen = new Set<string>();
  const add = (issues: ConfigIssue[]): void => {
    for (const issue of issues) {
      const id = issueId(issue);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(issue);
    }
  };
  add(checkConfigLimits(request));
  const printer = request.printer?.config ?? {};
  const print = request.print?.config ?? {};
  add(sectionTemperatures('printer', printer));
  add(sectionTemperatures('print', print));
  const nozzle = printer.nozzle_diameter;
  for (const [index, object] of (request.objects ?? []).entries()) {
    add(objectLayerHeightIssues(object.config?.layer_height, nozzle, `object[${index}]`));
    for (const [rangeIndex, range] of (object.ranges ?? []).entries()) {
      add(objectLayerHeightIssues(range.config?.layer_height, nozzle, `object[${index}].range[${rangeIndex}]`));
    }
  }
  if (request.merged) {
    add(sectionTemperatures('print', request.merged));
    add(
      rangeIssues('config.nozzle_diameter', 'nozzle_diameter', request.merged.nozzle_diameter, GLOBAL_LIMITS.nozzleDiameter, nozzleMessage),
    );
    add(layerHeightIssues(request.merged.layer_height, request.merged.nozzle_diameter ?? nozzle));
  }
  return out;
}

/** The nozzle message, shared by the printer section and the merged view. */
function nozzleMessage(label: string, value: number, limit: string): string {
  return `${label} = ${num(value)} mm is outside the sensible ${limit} – a nozzle that size cannot be printed with.`;
}

/**
 * Every limit issue of a slice request: the printer's nozzle, the print's layer height against it,
 * and each filament's temperatures and soft ranges.
 *
 * The key of a filament issue is prefixed with `filament[<i>].` only when the request has more than
 * one filament, so a single-material job reads `temperature[0]` and a multi-material one says which
 * extruder it means.
 */
export function checkConfigLimits(request: ConfigLimitRequest): ConfigIssue[] {
  const printer = request.printer?.config ?? {};
  const print = request.print?.config ?? {};
  const filaments = request.filaments?.length ? request.filaments : [{ config: {} }];
  const out: ConfigIssue[] = [];
  out.push(...checkConfigValues('printer', printer));
  const sla = printer.printer_technology === 'SLA';
  out.push(...checkConfigValues(sla ? 'sla_print' : 'print', print, { nozzleDiameter: printer.nozzle_diameter }));
  for (let i = 0; i < filaments.length; i++) {
    const issues = checkConfigValues('filament', filaments[i].config ?? {});
    for (const found of issues) out.push(filaments.length > 1 ? { ...found, key: `filament[${i}].${found.key}` } : found);
  }
  return out;
}

/** The blocking issues of a request (the slice routes refuse with these). */
export function blockingConfigIssues(issues: readonly ConfigIssue[]): ConfigIssue[] {
  return issues.filter((i) => i.severity === 'block');
}

/** The highest temperature a job asks for, per kind – what a printer's safety profile compares against. */
export type { MaxTemperatures } from '../types/jobs.js';

/** The highest hotend/bed temperature of a request (0 when it sets none). */
export function maxTemperaturesOf(request: ConfigLimitRequest): MaxTemperatures {
  const max: MaxTemperatures = { hotend: 0, bed: 0 };
  for (const filament of request.filaments?.length ? request.filaments : []) {
    for (const key of HOTEND_KEYS) for (const v of numbersOf(filament.config?.[key])) max.hotend = Math.max(max.hotend, v);
    for (const key of BED_KEYS) for (const v of numbersOf(filament.config?.[key])) max.bed = Math.max(max.bed, v);
  }
  return max;
}

function numbersOf(raw: string | undefined): number[] {
  return elementsOf(raw)
    .map((e) => e.element)
    .filter((e): e is { kind: 'number'; value: number } => e.kind === 'number')
    .map((e) => e.value);
}

/** The safety profile of one physical printer (S1-d), narrow limits for a known machine. */
type PrinterSafety = NonNullable<PhysicalPrinter['safety']>;

/**
 * The `send.printer_limit` issues of a job: a temperature the job asks for above what the target
 * printer may reach. A block – the G-code was sliced for a machine that can do it, the target is not.
 */
export function printerLimitIssues(temperatures: MaxTemperatures | undefined, safety: PrinterSafety | undefined): SendIssue[] {
  if (!temperatures || !safety) return [];
  const out: SendIssue[] = [];
  if (safety.maxHotend !== undefined && temperatures.hotend > safety.maxHotend) {
    out.push({
      rule: 'send.printer_limit',
      severity: 'block',
      message: `This G-code heats the hotend to ${num(temperatures.hotend)} °C, but the target printer is limited to ${num(safety.maxHotend)} °C.`,
    });
  }
  if (safety.maxBed !== undefined && temperatures.bed > safety.maxBed) {
    out.push({
      rule: 'send.printer_limit',
      severity: 'block',
      message: `This G-code heats the bed to ${num(temperatures.bed)} °C, but the target printer is limited to ${num(safety.maxBed)} °C.`,
    });
  }
  return out;
}
