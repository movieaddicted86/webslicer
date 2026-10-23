import {
  Combine,
  Copy,
  LayoutGrid,
  Minus,
  Move,
  PanelBottom,
  Plus,
  Redo2,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  Scaling,
  Scissors,
  Settings,
  Split,
  SquarePlus,
  SquareSplitHorizontal,
  SquareX,
  Trash2,
  Undo2,
  Ungroup,
  X,
} from 'lucide-react';

/**
 * One icon per plater action, so an action looks the same in the object toolbar, in Simple mode and
 * in the rows of the object list (T-036). Named by the action, not by the picture.
 */
export const ACTION_ICONS = {
  undo: Undo2,
  redo: Redo2,
  move: Move,
  rotate: RotateCw,
  scale: Scaling,
  placeOnFace: PanelBottom,
  arrange: LayoutGrid,
  /** the gear next to Arrange: spacing, rotations, alignment (T-043) */
  arrangeSettings: Settings,
  addInstance: Plus,
  removeInstance: Minus,
  duplicate: Copy,
  delete: Trash2,
  /** "delete all" – a boxed cross, so it does not repeat the trash can of "delete" */
  deleteAll: SquareX,
  /** discard a change, back to the preset value */
  reset: RotateCcw,
  /** set an instance as its own object */
  instanceToObject: SquareSplitHorizontal,
  splitToObjects: Split,
  splitToParts: Ungroup,
  /** merge the selected objects into one */
  merge: Combine,
  /** cut the selected object with a plane (T-044) */
  cut: Scissors,
  remove: X,
  close: X,
  refresh: RefreshCw,
  save: Save,
  addVolume: SquarePlus,
} as const;
