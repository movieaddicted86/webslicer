/**
 * The safety profiles of the printer presets (T-085) and the one-time risk-notice acknowledgement.
 *
 * Both files live in the data dir and are read through the atomic JSON store (B7): a crash leaves
 * either the old or the new file, and a corrupt one is quarantined instead of read as "no answer".
 *
 * The profile is keyed by the printer **preset name**, which is what a slice request carries
 * (`printer.name`) – so a user who only exports G-code is protected too, without a print host. A preset
 * without a record was never answered and stays a warning (no migration).
 */
import path from 'node:path';
import { config } from '../config.js';
import { readJson, writeJson } from '../storage/jsonStore.js';
import { appVersion } from './version.js';
import type { PrinterSafetyProfile, PrinterSafetyRecord, RiskNoticeStatus } from '@webslicer/shared';

function safetyFile(): string {
  return path.join(config.dataDir, 'printer_safety.json');
}

function noticeFile(): string {
  return path.join(config.dataDir, 'risk_notice.json');
}

/** Serialises the read-modify-write of both files, like the printer store's chain. */
let writes: Promise<unknown> = Promise.resolve();

function update<T>(fn: () => Promise<T>): Promise<T> {
  const next = writes.then(fn, fn);
  writes = next.catch(() => undefined);
  return next;
}

/** Every stored profile, keyed by preset name. */
export async function printerSafetyRecord(): Promise<PrinterSafetyRecord> {
  const { value } = await readJson<PrinterSafetyRecord>(safetyFile());
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

/** Store one profile; an answer of `undefined` deletes the record ("Ask me later" stores nothing). */
export function setPrinterSafety(presetName: string, profile: PrinterSafetyProfile | undefined): Promise<PrinterSafetyRecord> {
  return update(async () => {
    const record = await printerSafetyRecord();
    const next = { ...record };
    if (profile) next[presetName] = profile;
    else delete next[presetName];
    await writeJson(safetyFile(), next);
    return next;
  });
}

/** Drop the profile of a preset that no longer exists (a deleted user printer preset). */
export function forgetPrinterSafety(presetName: string): Promise<PrinterSafetyRecord> {
  return setPrinterSafety(presetName, undefined);
}

/** Follow a preset rename, so an answered printer keeps its profile. */
export function renamePrinterSafety(from: string, to: string): Promise<void> {
  return update(async () => {
    const record = await printerSafetyRecord();
    if (!(from in record)) return;
    const next = { ...record, [to]: record[from] };
    delete next[from];
    await writeJson(safetyFile(), next);
  });
}

/** Put a whole record back (the rollback of a preset rename). */
export function setPrinterSafetyRecord(record: PrinterSafetyRecord): Promise<void> {
  return update(async () => {
    await writeJson(safetyFile(), record);
  });
}

/** The major component of a version string (`1.0.0-rc.5` → `1`); `undefined` when there is none. */
export function majorOf(version: string | undefined): string | undefined {
  const match = /^(\d+)\./.exec((version ?? '').trim());
  return match?.[1];
}

/** What is stored between runs: the version the notice was acknowledged for. */
interface StoredNotice {
  version: string;
  acknowledgedAt: string;
}

/**
 * Whether the risk notice still has to be shown: never acknowledged, or acknowledged for another
 * **major** version. A minor or patch release does not ask again – the notice is not a nag.
 */
export function noticeStatusOf(stored: StoredNotice | undefined, current: string): RiskNoticeStatus {
  if (!stored?.version) return { acknowledged: false };
  const sameMajor = majorOf(stored.version) !== undefined && majorOf(stored.version) === majorOf(current);
  return {
    acknowledged: sameMajor,
    version: stored.version,
    acknowledgedAt: stored.acknowledgedAt,
  };
}

/** The acknowledgement as the API hands it out. */
export async function riskNoticeStatus(): Promise<RiskNoticeStatus> {
  const { value } = await readJson<StoredNotice>(noticeFile());
  return noticeStatusOf(value, await appVersion());
}

/** Store the acknowledgement for the running version. */
export function acknowledgeRiskNotice(): Promise<RiskNoticeStatus> {
  return update(async () => {
    const version = await appVersion();
    const stored: StoredNotice = { version, acknowledgedAt: new Date().toISOString() };
    await writeJson(noticeFile(), stored);
    return noticeStatusOf(stored, version);
  });
}

/** Forget the acknowledgement, so the notice shows again (the About dialog's "show it again"). */
export function forgetRiskNotice(): Promise<RiskNoticeStatus> {
  return update(async () => {
    await writeJson(noticeFile(), {});
    return { acknowledged: false };
  });
}
