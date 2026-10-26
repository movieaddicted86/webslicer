/**
 * The printer-safety profile of a **printer preset** (T-085): the answer to the hotend question, kept
 * server-side per preset name so a user who only exports G-code is protected as well.
 *
 * Three answers, three limits: a PTFE-lined hotend must not go above 240 °C (the liner decomposes
 * above it), an all-metal one is only held to the global 450 °C typo catcher, and "other" is a number
 * the owner typed within the global window. A profile never widens a limit: a print host bound to the
 * same preset keeps its own `PhysicalPrinter.safety`, and when both exist the stricter one wins.
 */
import type { ConfigIssue } from '../types/jobs.js';
import type { HotendType, PrinterSafety, PrinterSafetyProfile, PrinterSafetyRecord } from '../types/presets.js';

/** The hotend limit of a PTFE-lined hotend (T-080, P-2); above it the liner decomposes. */
export const PTFE_MAX_HOTEND = 240;
/** The hotend limit of an all-metal hotend: the global typo catcher, i.e. no narrower limit. */
export const ALL_METAL_MAX_HOTEND = 450;
/** The window a typed ("other") hotend limit has to sit in – the global catcher's own window. */
export const OTHER_HOTEND_MIN = 150;
export const OTHER_HOTEND_MAX = 450;
/** The widest bed temperature a profile may carry – the global catcher's ceiling. */
export const MAX_BED_LIMIT = 150;

/** The limit an answer sets (PTFE 240, all-metal 450, "other" the typed number), or `undefined`. */
export function hotendLimitOf(type: HotendType, other?: number): number | undefined {
  if (type === 'ptfe') return PTFE_MAX_HOTEND;
  if (type === 'all-metal') return ALL_METAL_MAX_HOTEND;
  if (other === undefined || !Number.isFinite(other) || other < OTHER_HOTEND_MIN || other > OTHER_HOTEND_MAX) return undefined;
  return Math.round(other);
}

/** The profile of one preset, or `undefined` when it was never answered (no migration, T-085). */
export function profileOf(record: PrinterSafetyRecord | undefined, presetName: string | undefined): PrinterSafetyProfile | undefined {
  if (!record || !presetName) return undefined;
  const profile = record[presetName];
  if (!profile || !Number.isFinite(profile.maxHotend)) return undefined;
  return profile;
}

/**
 * What a preset's safety amounts to, as the checks compare against it: the stored profile's limits
 * plus the fact that a bound host may have answered the same question in the print-host form (T-080).
 */
export interface PresetSafetyAnswer {
  profile?: PrinterSafetyProfile;
  /** a print host bound to this preset carries its own safety limits */
  hostAnswered?: boolean;
}

/** The limits a preset contributes to the checks; `undefined` when it was never answered. */
export function presetSafetyOf(answer: PresetSafetyAnswer | undefined): PrinterSafety | undefined {
  const profile = answer?.profile;
  if (!profile) return undefined;
  return { maxHotend: profile.maxHotend, ...(profile.maxBed !== undefined && { maxBed: profile.maxBed }) };
}

/**
 * The stricter of a host's own limits and its preset's profile: the smaller limit of each kind.
 *
 * Neither side is relaxed – a host that says 240 °C keeps 240 °C even when its preset says 300 °C, and
 * the other way round. A kind only one side sets is taken as it is.
 */
export function combinedSafety(host: PrinterSafety | undefined, profile: PrinterSafetyProfile | undefined): PrinterSafety | undefined {
  const merge = (a: number | undefined, b: number | undefined): number | undefined =>
    a === undefined ? b : b === undefined ? a : Math.min(a, b);
  const maxHotend = merge(host?.maxHotend, profile?.maxHotend);
  const maxBed = merge(host?.maxBed, profile?.maxBed);
  if (maxHotend === undefined && maxBed === undefined) return undefined;
  return { ...(maxHotend !== undefined && { maxHotend }), ...(maxBed !== undefined && { maxBed }) };
}

/**
 * The `config.no_printer_safety` warning of a preset that was never answered (T-085, AC-2).
 *
 * A warning, not a block: the machine may well be all-metal, and refusing every slice until a question
 * is answered would stop an install that worked before. It is what the Slice footer shows, and the
 * link beside it opens the printer setup at the safety question.
 */
export function presetSafetyMissingIssue(presetName: string | undefined, answer?: PresetSafetyAnswer): ConfigIssue[] {
  // an answer from either side (the wizard's record, or the host form of T-080) ends the warning
  if (!presetName || answer?.profile || answer?.hostAnswered) return [];
  return [
    {
      rule: 'config.no_printer_safety',
      severity: 'warn',
      message: `No hotend type set for this printer – temperatures are only checked against the global ${ALL_METAL_MAX_HOTEND} °C ceiling.`,
      key: 'hotend_type',
      value: '',
      limit: `${OTHER_HOTEND_MIN}–${OTHER_HOTEND_MAX} °C`,
    },
  ];
}
