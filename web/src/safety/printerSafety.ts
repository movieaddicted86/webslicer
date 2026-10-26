/**
 * The printer-preset safety answer in the browser (T-085): the stored profile of the active printer
 * preset and the warning of a preset nobody answered.
 *
 * There is no second copy of a limit here – the numbers come from `@webslicer/shared`, which is also
 * what the server checks with. This module only says *which* answer applies.
 */
import { presetSafetyMissingIssue, profileOf, type ConfigIssue } from '@webslicer/shared';
import type { PhysicalPrinter, PrinterSafety, PrinterSafetyProfile, PrinterSafetyRecord } from '../api';

/** The answer of the active printer preset, resolved once per render. */
export interface PresetSafetyState {
  presetName: string;
  /** the stored profile, `undefined` when nobody answered for this preset */
  profile?: PrinterSafetyProfile;
  /** the limits the slice check compares against (`undefined` = only the global catchers) */
  limits?: PrinterSafety;
  /** a print host bound to this preset answered the same question in the T-080 form */
  hostAnswered: boolean;
}

/** Resolve the answer of one preset from the record, the hosts and the preset name. */
export function presetSafetyState(
  record: PrinterSafetyRecord | undefined,
  hosts: readonly PhysicalPrinter[],
  presetName: string,
): PresetSafetyState {
  const profile = profileOf(record, presetName);
  const bound = hosts.filter((h) => h.presetName === presetName);
  return {
    presetName,
    profile,
    limits: profile ? { maxHotend: profile.maxHotend, ...(profile.maxBed !== undefined && { maxBed: profile.maxBed }) } : undefined,
    hostAnswered: bound.some((h) => !!h.safety && Object.keys(h.safety).length > 0),
  };
}

/** The warning of a preset nobody answered (T-085, AC-2): shown in the Slice footer, never blocks. */
export function presetSafetyWarnings(state: PresetSafetyState): ConfigIssue[] {
  return presetSafetyMissingIssue(state.presetName, { profile: state.profile, hostAnswered: state.hostAnswered });
}

/** How a limit message labels the answer it comes from. */
export function profileLabel(profile: PrinterSafetyProfile | undefined): string | undefined {
  if (!profile) return undefined;
  if (profile.hotendType === 'ptfe') return 'PTFE-lined hotend';
  if (profile.hotendType === 'all-metal') return 'all-metal hotend';
  return 'custom hotend limit';
}
