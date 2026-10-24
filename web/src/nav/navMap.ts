/**
 * The navigation map: one table that gives every function exactly one home. The rail, the menu and
 * the preset rows render their entries from here, so a function cannot be added twice by accident and
 * a removed duplicate leaves nothing behind.
 *
 * The file is deliberately free of runtime imports – the E2E suite reads the same table to check what
 * the UI renders.
 */
import type { IconName } from '../icons/table';

/** The regions that carry navigation: the far-left rail, the top bar's menu, a preset row, the bar, the tool strip. */
export type NavHome = 'rail' | 'menu' | 'preset-row' | 'top-bar' | 'strip';

/** The dialog a nav entry opens, with the payload the dialog reads. */
export type NavDialog = 'library' | 'printers' | 'preferences' | 'about' | 'importPresets';

/** What an export entry sends. */
export type ExportTarget = 'project' | 'settings' | 'bundle' | 'gcode' | 'saveProject' | 'saveGcode';

/** What an entry does. The hosts turn it into a store call (`navActions.ts`). */
export type NavAction =
  | { kind: 'view'; view: 'plater' | 'preview' | 'print' | 'filament' | 'printer' }
  | { kind: 'dialog'; dialog: NavDialog; payload?: unknown }
  | { kind: 'import' }
  | { kind: 'export'; target: ExportTarget }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'hidePanels' };

export interface NavEntry {
  /** stable function id; the hosts mark their elements with it (`data-nav-id`) */
  id: string;
  label: string;
  icon: IconName;
  home: NavHome;
  action: NavAction;
  /** the element's test hook, where the region has one per entry */
  testId?: string;
}

/** The app's places, in the order the rail shows them. */
export const RAIL_ENTRIES: readonly NavEntry[] = [
  {
    id: 'slicing',
    label: 'Slicing',
    icon: 'slicing',
    home: 'rail',
    action: { kind: 'view', view: 'plater' },
    testId: 'rail-slicing',
  },
  {
    id: 'library',
    label: 'Library',
    icon: 'library',
    home: 'rail',
    action: { kind: 'dialog', dialog: 'library', payload: 'open' },
    testId: 'rail-library',
  },
  {
    id: 'printers',
    label: 'Printers',
    icon: 'printers',
    home: 'rail',
    action: { kind: 'dialog', dialog: 'printers', payload: { tab: 'hosts' } },
    testId: 'rail-printers',
  },
  {
    id: 'preferences',
    label: 'Preferences',
    icon: 'settings',
    home: 'rail',
    action: { kind: 'dialog', dialog: 'preferences' },
    testId: 'rail-preferences',
  },
  {
    id: 'about',
    label: 'About',
    icon: 'about',
    home: 'rail',
    action: { kind: 'dialog', dialog: 'about' },
    testId: 'rail-about',
  },
];

/** The menu's own entries; the Export submenu's items follow. */
export const MENU_ENTRIES: readonly NavEntry[] = [
  { id: 'importModels', label: 'Import models…', icon: 'import', home: 'menu', action: { kind: 'import' } },
  {
    id: 'importPresets',
    label: 'Import presets…',
    icon: 'importPresets',
    home: 'menu',
    action: { kind: 'dialog', dialog: 'importPresets' },
  },
];

/** The items of Menu → Export ▸. */
export const EXPORT_ENTRIES: readonly NavEntry[] = [
  { id: 'exportProject', label: 'Export project as 3MF', icon: 'export', home: 'menu', action: { kind: 'export', target: 'project' } },
  {
    id: 'exportSettings',
    label: 'Export current settings (.ini)',
    icon: 'exportConfig',
    home: 'menu',
    action: { kind: 'export', target: 'settings' },
  },
  {
    id: 'exportBundle',
    label: 'Export presets (.ini bundle)',
    icon: 'exportBundle',
    home: 'menu',
    action: { kind: 'export', target: 'bundle' },
  },
  { id: 'exportGcode', label: 'Export G-code', icon: 'export', home: 'menu', action: { kind: 'export', target: 'gcode' } },
  {
    id: 'saveProjectToLibrary',
    label: 'Save project to library…',
    icon: 'save',
    home: 'menu',
    action: { kind: 'export', target: 'saveProject' },
  },
  {
    id: 'saveGcodeToLibrary',
    label: 'Save G-code to library…',
    icon: 'save',
    home: 'menu',
    action: { kind: 'export', target: 'saveGcode' },
  },
];

/** One entry per settings view, in the cog of the preset row. */
export const SETTINGS_ENTRIES: readonly NavEntry[] = [
  {
    id: 'settingsPrint',
    label: 'Edit print settings',
    icon: 'settings',
    home: 'preset-row',
    action: { kind: 'view', view: 'print' },
  },
  {
    id: 'settingsFilament',
    label: 'Edit filament settings',
    icon: 'settings',
    home: 'preset-row',
    action: { kind: 'view', view: 'filament' },
  },
  {
    id: 'settingsPrinter',
    label: 'Edit printer settings',
    icon: 'settings',
    home: 'preset-row',
    action: { kind: 'view', view: 'printer' },
  },
];

/** The printer dropdown's way into the printer setup – the same dialog as the rail's Printers. */
export const PRESET_PRINTERS_ENTRY: NavEntry = {
  id: 'printersVendor',
  label: 'Add / remove printers…',
  icon: 'printers',
  home: 'preset-row',
  action: { kind: 'dialog', dialog: 'printers', payload: { tab: 'vendor' } },
};

/** The bar's actions; their labels change with their state, so they are not rendered from the table. */
export const TOP_BAR_ENTRIES: readonly NavEntry[] = [
  { id: 'undo', label: 'Undo', icon: 'undo', home: 'top-bar', action: { kind: 'undo' }, testId: 'undo-button' },
  { id: 'redo', label: 'Redo', icon: 'redo', home: 'top-bar', action: { kind: 'redo' }, testId: 'redo-button' },
  {
    id: 'hidePanels',
    label: 'Hide the side panels',
    icon: 'hidePanels',
    home: 'top-bar',
    action: { kind: 'hidePanels' },
    testId: 'hide-panels',
  },
];

/**
 * The Prepare | Preview switch in the tool strip (L-4). It moved out of the top bar, which no longer
 * carries view tabs; the tool strip is its one home, next to the tools it shares the scene with.
 */
export const STRIP_VIEW_ENTRIES: readonly NavEntry[] = [
  { id: 'viewPlater', label: 'Prepare', icon: 'plater', home: 'strip', action: { kind: 'view', view: 'plater' }, testId: 'view-plater' },
  {
    id: 'viewPreview',
    label: 'Preview',
    icon: 'preview',
    home: 'strip',
    action: { kind: 'view', view: 'preview' },
    testId: 'view-preview',
  },
];

/** Every entry of the map, the table the tests and the hosts share. */
export const NAV_ENTRIES: readonly NavEntry[] = [
  ...RAIL_ENTRIES,
  ...MENU_ENTRIES,
  ...EXPORT_ENTRIES,
  ...SETTINGS_ENTRIES,
  PRESET_PRINTERS_ENTRY,
  ...TOP_BAR_ENTRIES,
  ...STRIP_VIEW_ENTRIES,
];

/** The entry of a function id; a missing id is a programming error, the tests catch it. */
export function navEntry(id: string): NavEntry {
  const entry = NAV_ENTRIES.find((e) => e.id === id);
  if (!entry) throw new Error(`unknown navigation entry "${id}"`);
  return entry;
}

/** The settings entry of one preset type, for the cog in that preset's row. */
export function settingsEntryFor(type: 'print' | 'filament' | 'printer'): NavEntry {
  return navEntry(`settings${type[0].toUpperCase()}${type.slice(1)}`);
}
