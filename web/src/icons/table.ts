import {
  Combine,
  Copy,
  FolderPlus,
  LibraryBig,
  Minus,
  PencilLine,
  RefreshCw,
  Split,
  SquarePlus,
  SquareSplitHorizontal,
  SquareX,
  Tags,
  Ungroup,
  Upload,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { PrusaIconFile } from './prusa';

/**
 * One icon per function, named by what the action does rather than by the picture (I-1). Every
 * component takes its icon from here, so the picture of a function can be swapped in one place.
 *
 * A function uses PrusaSlicer's icon when the icon map (`docs/design/Icons-and-UX.md`) has one;
 * lucide covers the generic chrome Prusa has no artwork for (close, refresh, chevrons) and the
 * functions without a Prusa counterpart (split, merge, rename a preset).
 */
export type IconSource = { source: 'prusa'; file: PrusaIconFile } | { source: 'lucide'; icon: LucideIcon };

export const ICON_TABLE = {
  // plater actions
  undo: { source: 'prusa', file: 'tb_undo' },
  redo: { source: 'prusa', file: 'tb_redo' },
  move: { source: 'prusa', file: 'move' },
  rotate: { source: 'prusa', file: 'rotate' },
  scale: { source: 'prusa', file: 'scale' },
  placeOnFace: { source: 'prusa', file: 'place' },
  arrange: { source: 'prusa', file: 'layout' },
  arrangeSettings: { source: 'prusa', file: 'cog' },
  addInstance: { source: 'prusa', file: 'rectangle_add' },
  removeInstance: { source: 'lucide', icon: Minus },
  duplicate: { source: 'lucide', icon: Copy },
  delete: { source: 'prusa', file: 'delete_button' },
  deleteAll: { source: 'lucide', icon: SquareX },
  reset: { source: 'prusa', file: 'undo_r' },
  instanceToObject: { source: 'lucide', icon: SquareSplitHorizontal },
  splitToObjects: { source: 'lucide', icon: Split },
  splitToParts: { source: 'lucide', icon: Ungroup },
  merge: { source: 'lucide', icon: Combine },
  addVolume: { source: 'lucide', icon: SquarePlus },

  // tools
  cut: { source: 'prusa', file: 'cut' },
  paintSupports: { source: 'prusa', file: 'paint_supports' },
  paintSeam: { source: 'prusa', file: 'paint_seams' },
  paintMmu: { source: 'prusa', file: 'paint_multi_material' },
  layerHeight: { source: 'prusa', file: 'variable_layer_height' },

  // top bar
  import: { source: 'prusa', file: 'add_object' },
  importPresets: { source: 'prusa', file: 'import_config' },
  library: { source: 'lucide', icon: LibraryBig },
  export: { source: 'prusa', file: 'export_gcode' },
  exportConfig: { source: 'prusa', file: 'export_config' },
  exportBundle: { source: 'prusa', file: 'export_config_bundle' },
  exportToLocal: { source: 'prusa', file: 'save_print_to_local' },
  sendToHost: { source: 'prusa', file: 'connect_gcode' },
  printers: { source: 'prusa', file: 'printer_physical' },
  save: { source: 'prusa', file: 'tb_save' },
  open: { source: 'prusa', file: 'tb_load' },
  settings: { source: 'prusa', file: 'cog' },

  // dialogs and chrome
  remove: { source: 'lucide', icon: X },
  close: { source: 'lucide', icon: X },
  refresh: { source: 'lucide', icon: RefreshCw },
  rename: { source: 'lucide', icon: PencilLine },
  folderPlus: { source: 'lucide', icon: FolderPlus },
  upload: { source: 'lucide', icon: Upload },
  toolLabels: { source: 'lucide', icon: Tags },
} as const satisfies Record<string, IconSource>;

/** The function names the app may render – the keys of the one table. */
export type IconName = keyof typeof ICON_TABLE;
