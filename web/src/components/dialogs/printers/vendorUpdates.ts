/**
 * The Vendor profiles view: which rows a user sees and what each row may say.
 *
 * The server answers every installed vendor with the newest version its upstream index lists – that
 * is not the same as an update. A version that is older than the one in use, a pre-release
 * (`2.0.0-alpha1`) or one this PrusaSlicer cannot run is no update, and the row must not suggest one:
 * an arrow from `1.1.0` to `0.1.0` reads as a downgrade. The status rules live here, without React,
 * so they are unit tested; the section only renders them.
 */
import { compareVersions, type VendorUpdate } from '@webslicer/shared';

/** What one row means for the user. */
export type VendorRowStatus =
  /** a newer stable bundle this engine can run – the only status with an Update action */
  | 'update'
  /** nothing newer: equal, older or unknown upstream version */
  | 'current'
  /** upstream's newest is a pre-release – never offered, only labelled behind "Show all vendors" */
  | 'prerelease'
  /** newer, but it needs another PrusaSlicer version */
  | 'incompatible';

/** One vendor as the section shows it. */
export interface VendorRow {
  id: string;
  name: string;
  installed?: string;
  /** only set when it is worth showing: the offered update, or the version behind "Show all" */
  available?: string;
  status: VendorRowStatus;
  /** the server's explanation for a version it does not offer (engine range) */
  reason?: string;
  canRevert: boolean;
}

/** `2.0.0-alpha1`, `1.0.0-rc.3`: the profile repository ships those next to the releases. */
export function isPreRelease(version: string): boolean {
  return /^[0-9][0-9A-Za-z.+]*-[0-9A-Za-z.-]+$/.test(version.trim());
}

/** One server row as the view shows it; `available` is kept only where it explains something. */
export function vendorRow(v: VendorUpdate): VendorRow {
  const base: VendorRow = {
    id: v.id,
    name: v.name,
    ...(v.installed ? { installed: v.installed } : {}),
    status: 'current',
    canRevert: v.canRevert,
  };
  if (!v.available) return base;
  if (isPreRelease(v.available)) return { ...base, available: v.available, status: 'prerelease' };
  // the comparison is repeated here on purpose: the row must never claim an update the click cannot run
  if (compareVersions(v.available, v.installed ?? '0') <= 0) return base;
  if (!v.compatible) {
    return { ...base, available: v.available, status: 'incompatible', ...(v.reason ? { reason: v.reason } : {}) };
  }
  return { ...base, available: v.available, status: 'update' };
}

export interface VendorViewOptions {
  /** vendors the user has printers or a selected printer preset from */
  relevant: ReadonlySet<string>;
  /** "Show all vendors" is open */
  showAll: boolean;
}

export interface VendorView {
  /** the rows to render; empty when everything is current, so the summary line is the whole answer */
  rows: VendorRow[];
  /** the vendors with an offered update – what "Update all" and the summary count */
  updates: VendorRow[];
  /** how many vendors the toggle would reveal */
  hidden: number;
}

/**
 * The rows of the current state. Everything current means no list at all (the summary line says it);
 * otherwise the default view holds the vendors with an update plus the user's own vendors, and the
 * rest waits behind the toggle.
 */
export function vendorView(vendors: readonly VendorUpdate[], { relevant, showAll }: VendorViewOptions): VendorView {
  const all = vendors.map(vendorRow);
  const updates = all.filter((r) => r.status === 'update');
  if (showAll) return { rows: all, updates, hidden: 0 };
  const rows = updates.length ? all.filter((r) => r.status === 'update' || relevant.has(r.id)) : [];
  return { rows, updates, hidden: all.length - rows.length };
}

/** The one summary sentence, with the count of vendors that have an update. */
export function summaryLine(updateCount: number): string {
  if (updateCount === 0) return 'All vendor profiles are up to date';
  if (updateCount === 1) return '1 vendor has an update';
  return `${updateCount} vendors have updates`;
}

/**
 * The `live` folder of the profile repository, taken from any vendor page URL – the one source link
 * of the view. Unknown URLs answer `undefined`, so no link is shown rather than a guessed one.
 */
export function repositoryUrl(vendorPageUrl: string | undefined): string | undefined {
  if (!vendorPageUrl) return undefined;
  const match = /^(https:\/\/github\.com\/prusa3d\/PrusaSlicer-settings\/tree\/[^/]+\/live)\/[^/]+\/?$/.exec(vendorPageUrl);
  return match?.[1];
}
