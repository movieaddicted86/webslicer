import type { Config } from '../api';

/** One option in which a preset differs from its saved state. */
interface PresetDiffEntry {
  key: string;
  /** saved value ('' when the key only exists in the current config) */
  from: string;
  /** current value ('' when the key was removed) */
  to: string;
}

/**
 * Options in which `current` differs from `saved`, like PrusaSlicer's "Unsaved Changes" list.
 * Keys that exist only on one side count as changed (added with `from: ''`, removed with `to: ''`),
 * unchanged keys are dropped, and the result is sorted by key so the dialog order is stable.
 */
export function presetDiff(saved: Config, current: Config): PresetDiffEntry[] {
  const keys = new Set([...Object.keys(saved), ...Object.keys(current)]);
  const out: PresetDiffEntry[] = [];
  for (const key of keys) {
    const from = saved[key] ?? '';
    const to = current[key] ?? '';
    if (from !== to) out.push({ key, from, to });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Apply the changes of an old preset to the newly selected preset: `newSaved` supplies every value
 * that was not touched, the old preset's changed keys are taken from `oldCurrent`. Keys the schema
 * does not know for that preset type are skipped, so switching between preset types cannot inject
 * options the target cannot hold (e.g. per-extruder printer vectors). A key the old preset cleared
 * is transferred as the empty value – that is how PrusaSlicer and this app express "no value"
 * (`nullable` options like `idle_temperature`), and the target slot renders it the same way.
 */
export function transferChanges(newSaved: Config, oldSaved: Config, oldCurrent: Config, validKeys: Iterable<string>): Config {
  const out: Config = { ...newSaved };
  const valid = new Set(validKeys);
  for (const { key, to } of presetDiff(oldSaved, oldCurrent)) {
    if (valid.has(key)) out[key] = to;
  }
  return out;
}

/**
 * One line for the dialog: a value shortened to `max` characters, the full value stays in `title`.
 * G-code and multi-value options are long, and the table must not be torn apart by them.
 */
export function shortValue(value: string, max = 60): string {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}
