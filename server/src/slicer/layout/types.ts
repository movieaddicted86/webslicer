/** Types of the curated layout tables: the tab tree and the metadata of a well-known option. */
import type { Mode, OptionType, PresetType } from '@webslicer/shared';

export interface KnownOption {
  label?: string;
  type?: OptionType;
  vector?: boolean;
  enumLabels?: string[];
  sidetext?: string;
  mode?: Mode;
  presetType?: PresetType;
  nullable?: boolean;
  multiline?: boolean;
  gcode?: boolean;
}

interface Group {
  title: string;
  keys: string[];
}
interface Page {
  title: string;
  groups: Group[];
}
export interface Tab {
  presetType: PresetType;
  title: string;
  pages: Page[];
}
