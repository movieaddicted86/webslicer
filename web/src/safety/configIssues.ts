/**
 * The configuration limits in the browser (S1-e): the checks the server runs before slicing (S1-d,
 * `@webslicer/shared` → `checkConfigLimits`) applied to the presets the editor is changing, so a
 * mistyped value is visible at the field instead of only as a 400 after pressing "Slice now".
 *
 * There is deliberately no second implementation of any limit here: this module only builds the
 * same request the server would see (`print`, `printer` and the filament slots the plater sends) and
 * hands the issues back with the field they belong to. The server stays the authority – a request it
 * refuses is still refused, whatever this module predicted.
 */
import { checkConfigLimits, presetLimitIssues, type Config, type ConfigIssue, type PrinterSafety } from '@webslicer/shared';

/** The current configs of the presets, as the plater holds them. */
export interface LimitPresets {
  print: Readonly<Config>;
  printer: Readonly<Config>;
  /** every filament slot; the slice request sends the first `extruderCount` of them */
  filaments: ReadonlyArray<Readonly<Config>>;
}

/** The preset section a limit issue belongs to (the settings tab that shows the field). */
export type LimitSection = 'print' | 'filament' | 'printer';

/** What an issue points at: the settings tab, the filament slot and the option key. */
export interface IssueTarget {
  section: LimitSection;
  /** filament slot (`0` outside the filament tab) */
  filamentIndex: number;
  /** option key without the per-extruder element: `temperature` for `temperature[1]` */
  key: string;
}

/** The filament slots the slice request carries – same slice as `buildSliceRequest`. */
function slotsOf(presets: LimitPresets, extruderCount: number): number {
  return Math.max(0, Math.floor(extruderCount) || 0);
}

/**
 * A stable key for one preset combination. Two renders with the same configs compute the issues once;
 * the key is also the debounce guard of `useLimitIssues`. The printer-safety answer is part of it, so a
 * profile stored while the editors are open re-runs the check.
 */
export function configKeyOf(presets: LimitPresets, extruderCount: number, safety?: PresetSafetyKey): string {
  const n = slotsOf(presets, extruderCount);
  return JSON.stringify([presets.printer, presets.print, presets.filaments.slice(0, n), safety ?? null]);
}

/** The part of the printer-safety answer a limit result depends on. */
export interface PresetSafetyKey {
  presetName: string;
  limits?: PrinterSafety;
  /** how the message names the answer ("PTFE-lined hotend") */
  label?: string;
}

/** How many computed results are kept; enough for the last few configs of one editing session. */
const CACHE_SIZE = 8;

/** The memoised results, oldest entry evicted first. */
const cache = new Map<string, ConfigIssue[]>();

/**
 * The limit issues of the current presets: the call the slice routes make (`checkConfigLimits` over
 * print/printer/filaments) plus the printer preset's own ceilings (`presetLimitIssues`, T-085),
 * memoised per config/safety combination.
 */
export function limitIssuesOf(presets: LimitPresets, extruderCount: number, safety?: PresetSafetyKey): ConfigIssue[] {
  const key = configKeyOf(presets, extruderCount, safety);
  const cached = cache.get(key);
  if (cached) return cached;
  const n = slotsOf(presets, extruderCount);
  const request = {
    print: { config: presets.print },
    printer: { config: presets.printer },
    filaments: presets.filaments.slice(0, n).map((config) => ({ config })),
  };
  const issues = checkConfigLimits(request);
  issues.push(...presetLimitIssues(request, safety?.limits, { existing: issues, label: safety?.label }));
  cache.set(key, issues);
  if (cache.size > CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return issues;
}

/** The section a rule of the shared check belongs to. */
function sectionOf(rule: string): LimitSection {
  if (rule === 'config.nozzle_diameter') return 'printer';
  if (rule === 'config.layer_height') return 'print';
  return 'filament';
}

/** `filament[1].temperature[0]` → slot 1, key `temperature`. */
const FILAMENT_PREFIX = /^filament\[(\d+)\]\.(.+)$/;

/** The settings field of one issue – what a click in the slice panel opens. */
export function issueTargetOf(issue: ConfigIssue): IssueTarget {
  let key = issue.key;
  let filamentIndex = 0;
  const prefixed = FILAMENT_PREFIX.exec(key);
  if (prefixed) {
    filamentIndex = Number(prefixed[1]);
    key = prefixed[2];
  }
  const element = key.indexOf('[');
  if (element > 0) key = key.slice(0, element);
  return { section: sectionOf(issue.rule), filamentIndex, key };
}

/**
 * The issue of one settings field, if any: a blocking one wins over a soft-range warning. Issues of
 * another filament slot do not count, so the editor never marks an extruder the user is not editing.
 */
export function fieldIssueOf(
  issues: readonly ConfigIssue[],
  section: LimitSection,
  key: string,
  filamentIndex = 0,
): ConfigIssue | undefined {
  const matching = issues.filter((issue) => {
    const target = issueTargetOf(issue);
    if (target.section !== section || target.key !== key) return false;
    return section !== 'filament' || target.filamentIndex === filamentIndex;
  });
  return matching.find((issue) => issue.severity === 'block') ?? matching[0];
}
