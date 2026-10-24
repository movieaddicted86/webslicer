/**
 * Vendor bundle updates (P2): the answer of `GET /api/vendors/updates` and what an install, a revert
 * or an install from a file changed.
 *
 * The check and every install happen **on the server** – the browser never talks to GitHub, and the
 * sources are fixed (host, repository, branch, vendor folder). `installed` and `available` are the
 * `config_version` of the bundle in use and the newest version upstream, so the two compare with the
 * same `compareVersions` the update notice uses.
 */
import type { PresetType } from './schema.js';

/** One installed vendor and what upstream offers for it. */
export interface VendorUpdate {
  id: string;
  name: string;
  /** the `config_version` of the bundle in use (`undefined` when the bundle carries none) */
  installed?: string;
  /** the newest version the upstream `index.idx` lists, compatible with this engine or not */
  available?: string;
  /** `available` may run on the installed PrusaSlicer (`min_slic3r_version`/`max_slic3r_version`) */
  compatible: boolean;
  /** a newer compatible version exists – what the Update button needs */
  update: boolean;
  /** why `update` is false although `available` is newer (the engine range, or the current version) */
  reason?: string;
  /** the upstream page of the vendor folder (the fixed source, for the user to read) */
  url?: string;
  /** a previous bundle is kept (`<id>.ini.prev`) or a newer data-dir copy can be dropped */
  canRevert: boolean;
  /** when the observation behind `available` was made */
  checkedAt?: string;
}

/** What `GET /api/vendors/updates` answers. */
export interface VendorUpdateList {
  /** `false` with `WEBSLICER_UPDATE_CHECK=off`: no outbound request is made at all */
  enabled: boolean;
  /** when the last check ran, `null` before the first one */
  checkedAt: string | null;
  vendors: VendorUpdate[];
}

/**
 * One reason a downloaded bundle was refused. `type` is a preset type, or `bundle` for a finding about
 * the file itself (its version, its vendor, an unusable key name).
 */
export interface BundleRefusal {
  type: PresetType | 'bundle';
  /** the preset the finding belongs to, or the file name for a `bundle` finding */
  preset: string;
  rule: string;
  message: string;
}

/** A user preset that inherits from a system preset the new bundle no longer contains. */
export interface VendorPresetWithoutParent {
  type: PresetType;
  name: string;
  /** the `inherits` name that disappeared */
  parent: string;
}

/** What an install, a revert or an install from a file changed. */
export interface VendorUpdateResult {
  vendor: string;
  /** the `config_version` in use before the change */
  from?: string;
  /** the `config_version` in use afterwards */
  to?: string;
  /**
   * User presets that inherit from a system preset the new bundle no longer has (the aliases of
   * `renamed_from` are honoured). Nothing is deleted or rewritten: the list is the report the user
   * sees after the install.
   */
  orphaned: VendorPresetWithoutParent[];
}
