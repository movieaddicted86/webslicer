/**
 * Slicer schema: what `/api/schema` returns and what the server derives from the PrusaSlicer
 * command line help (R-2, F-08).
 */

/** Types of preset a configuration option can belong to. */
export type PresetType = 'print' | 'filament' | 'printer' | 'sla_print' | 'sla_material';

/** Value shape of an option as the slicer help text describes it. */
export type OptionType =
  | 'float'
  | 'int'
  | 'percent'
  | 'float_or_percent'
  | 'string'
  | 'bool'
  | 'enum'
  | 'point'
  | 'point3'
  | 'points'
  | 'floats'
  | 'ints'
  | 'bools'
  | 'strings'
  | 'percents'
  | 'floats_or_percents';

/** PrusaSlicer's simple / advanced / expert setting visibility. */
export type Mode = 'simple' | 'advanced' | 'expert';

export interface OptionDef {
  key: string;
  label: string;
  tooltip: string;
  category: string;
  type: OptionType;
  default: string;
  enumValues?: string[];
  enumLabels?: string[];
  sidetext?: string;
  mode?: Mode;
  /** Preset types this option belongs to. */
  presetTypes: PresetType[];
  /** Value is one-per-extruder (filament / printer extruder options). */
  perExtruder?: boolean;
  nullable?: boolean;
  multiline?: boolean;
  gcode?: boolean;
  /** Printer technology the option applies to. */
  technology: 'FFF' | 'SLA' | 'any';
}

export interface LayoutGroup {
  title: string;
  keys: string[];
}

export interface LayoutPage {
  title: string;
  groups: LayoutGroup[];
}

export interface TabLayout {
  presetType: PresetType;
  title: string;
  pages: LayoutPage[];
}

export interface Schema {
  slicerVersion: string;
  options: Record<string, OptionDef>;
  layout: TabLayout[];
  presetKeys: Record<PresetType, string[]>;
}
