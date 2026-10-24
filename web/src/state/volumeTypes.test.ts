/**
 * F-25: `VolumeType` is declared once, in the shared contract (`shared/src/types/jobs.ts`). Every
 * web-side map keyed by it – the sidebar labels, the sidebar glyphs, the plater colours – has to
 * cover exactly that union, in the order `VOLUME_TYPES` gives. The `Record<VolumeType, …>` types
 * catch a missing key at compile time; this test also catches an extra one, or a map that drifts
 * in order from the contract (the type dropdown reads `VOLUME_TYPES`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VOLUME_TYPES } from '@webslicer/shared';
import { VOLUME_LABELS } from './types';
import { VOLUME_ICONS } from '../components/context/volumes';
import { VOLUME_COLORS } from '../three/viewer/colors';

test('the volume maps cover exactly the shared VolumeType union', () => {
  assert.deepEqual([...VOLUME_TYPES].sort(), [...Object.keys(VOLUME_LABELS)].sort());
  assert.deepEqual([...VOLUME_TYPES].sort(), [...Object.keys(VOLUME_ICONS)].sort());
  assert.deepEqual([...VOLUME_TYPES].sort(), [...Object.keys(VOLUME_COLORS)].sort());
});

test('the volume maps follow the contract order', () => {
  assert.deepEqual(Object.keys(VOLUME_LABELS), VOLUME_TYPES);
  assert.deepEqual(Object.keys(VOLUME_ICONS), VOLUME_TYPES);
  assert.deepEqual(Object.keys(VOLUME_COLORS), VOLUME_TYPES);
});
