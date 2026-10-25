import type { VolumeType } from '../../api';
import type { IconName } from '../../icons/table';

/** The glyph that marks a sub-volume type in the add menu. */
export const VOLUME_ICONS: Record<VolumeType, string> = {
  ModelPart: '◆',
  ParameterModifier: '◧',
  SupportEnforcer: '▲',
  SupportBlocker: '⛔',
  NegativeVolume: '◌',
};

/**
 * The icon-table pictures of the same types, for the parts list: PrusaSlicer's own artwork for the part,
 * modifier and enforcer operators. The same keys and order as the map above, so the two stay readable
 * side by side.
 */
export const VOLUME_ICON_NAMES: Record<VolumeType, IconName> = {
  ModelPart: 'part',
  ParameterModifier: 'modifier',
  SupportEnforcer: 'supportEnforcer',
  SupportBlocker: 'supportBlocker',
  NegativeVolume: 'negativeVolume',
};
