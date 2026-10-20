/**
 * The runtime companions of the unions in this file: `VOLUME_TYPES` / `CUSTOM_GCODE_TYPES` enumerate
 * their union exhaustively, so the `Record<Union, …>` literals below stop compiling as soon as a
 * variant is added without being added to the array (and to the 3MF writer that maps it).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CUSTOM_GCODE_TYPES, VOLUME_TYPES, type CustomGcodeType, type VolumeType } from './index.js';

test('the type lists match their unions', () => {
  // `satisfies`-style exhaustiveness: a new variant makes this literal incomplete → compile error
  const volumeTypes: Record<VolumeType, number> = {
    ModelPart: 0,
    ParameterModifier: 1,
    SupportEnforcer: 2,
    SupportBlocker: 3,
    NegativeVolume: 4,
  };
  // the numeric values are PrusaSlicer's CustomGCode::Type ids in the 3MF XML
  const customGcodeTypes: Record<CustomGcodeType, number> = {
    color_change: 0,
    pause: 1,
    tool_change: 2,
    template: 3,
    custom: 4,
  };
  assert.deepEqual(VOLUME_TYPES, Object.keys(volumeTypes));
  assert.deepEqual(CUSTOM_GCODE_TYPES, Object.keys(customGcodeTypes));
});
