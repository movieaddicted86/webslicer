/**
 * The filament step of the configuration wizard: how its catalogue is grouped, and the filter that
 * choice puts on the preset selector.
 *
 * Pure string/array work so both halves are unit tested and `PresetSelect` holds no rule of its own.
 * The wizard's choice is a *filter*, never a deletion: an empty list means "show all", which is the
 * state every install starts in, so nothing changes until the user ticks something.
 */
import type { FilamentCatalogEntry, PresetSummary } from './api';

/** The material section of an entry: its `filament_type`, else "Other". */
export function materialOf(entry: { material?: string }): string {
  return entry.material?.trim() || 'Other';
}

/** One type section of a vendor, in the wizard's order. */
export interface FilamentSection {
  material: string;
  entries: FilamentCatalogEntry[];
}

/** One vendor tab of the wizard with its type sections. */
export interface FilamentVendorGroup {
  vendorId: string;
  vendorName: string;
  sections: FilamentSection[];
}

/** Whether an entry matches the step's text filter (name, material or vendor, case-insensitive). */
function matches(entry: FilamentCatalogEntry, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return entry.name.toLowerCase().includes(q) || materialOf(entry).toLowerCase().includes(q) || entry.vendorName.toLowerCase().includes(q);
}

/**
 * The catalogue grouped by vendor, then by material, with the text filter applied.
 *
 * Within a section the entries keep the catalogue's order (the bundles' order, which is
 * PrusaSlicer's), so two renders of the same data list identically.
 */
export function groupFilaments(entries: readonly FilamentCatalogEntry[], query = ''): FilamentVendorGroup[] {
  const vendors = new Map<string, FilamentVendorGroup>();
  for (const entry of entries) {
    if (!matches(entry, query)) continue;
    let vendor = vendors.get(entry.vendorId);
    if (!vendor) {
      vendor = { vendorId: entry.vendorId, vendorName: entry.vendorName, sections: [] };
      vendors.set(entry.vendorId, vendor);
    }
    const material = materialOf(entry);
    let section = vendor.sections.find((s) => s.material === material);
    if (!section) {
      section = { material, entries: [] };
      vendor.sections.push(section);
    }
    section.entries.push(entry);
  }
  return [...vendors.values()];
}

/** The entries of one vendor group that an installed printer can use. */
export function compatibleOf(group: FilamentVendorGroup): FilamentCatalogEntry[] {
  return group.sections.flatMap((s) => s.entries).filter((e) => e.compatible);
}

/**
 * The system filament presets the selector may show: everything when nothing is ticked (or the
 * escape hatch is on), otherwise the ticked ones plus user presets, the defaults and the preset that
 * is selected right now – a filter never hides the active choice.
 */
export function filterSystemFilaments(
  list: readonly PresetSummary[],
  selectedName: string,
  visibleNames: readonly string[],
  showAll: boolean,
): PresetSummary[] {
  if (!visibleNames.length || showAll) return [...list];
  const ticked = new Set(visibleNames);
  // the "- default -" presets are not part of the catalogue (nothing to tick), so they stay reachable
  return list.filter((p) => !p.system || p.name.startsWith('- default') || p.name === selectedName || ticked.has(p.name));
}
