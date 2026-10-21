import type { VolumeType } from '../../api';

/** The glyph that marks a sub-volume type in the sidebar and in the add menu. */
export const VOLUME_ICONS: Record<VolumeType, string> = {
  ModelPart: '◆',
  ParameterModifier: '◧',
  SupportEnforcer: '▲',
  SupportBlocker: '⛔',
  NegativeVolume: '◌',
};
