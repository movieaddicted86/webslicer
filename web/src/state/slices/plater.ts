/**
 * The plater slice, composed (q4-web-store): the objects on the bed and every action that acts on
 * them, split into the per-area parts next to this file. Painting (`./paint`), height ranges
 * (`./ranges`), cut (`./cut`) and the layer profile (`./profile`) keep their own slices; the plater
 * actions live in `./objects`, `./volumes`, `./instances`, `./transform`, `./split` and `./merge`.
 *
 * Every part declares its own `<X>Slice` interface and is spread into this creator, so the store
 * still composes the six named slices and the public action names are unchanged. Other slices'
 * state is read through `get()` on the combined store (R-6).
 */
import type { StateCreator } from 'zustand';
import { createPaintSlice, type PaintSlice } from './paint';
import { createRangeSlice, type RangeSlice } from './ranges';
import { createCutSlice, type CutSlice } from './cut';
import { createProfileSlice, type ProfileSlice } from './profile';
import { createObjectSlice, type ObjectSlice } from './objects';
import { createVolumeSlice, type VolumeSlice } from './volumes';
import { createInstanceSlice, type InstanceSlice } from './instances';
import { createTransformSlice, type TransformSlice } from './transform';
import { createSplitSlice, type SplitSlice } from './split';
import { createMergeSlice, type MergeSlice } from './merge';
import type { State } from '../types';

export type PlaterSlice = PaintSlice &
  RangeSlice &
  CutSlice &
  ProfileSlice &
  ObjectSlice &
  VolumeSlice &
  InstanceSlice &
  TransformSlice &
  SplitSlice &
  MergeSlice;

export const createPlaterSlice: StateCreator<State, [], [], PlaterSlice> = (set, get) => ({
  ...createPaintSlice(set, get),
  ...createRangeSlice(set, get),
  ...createCutSlice(set, get),
  ...createProfileSlice(set, get),
  ...createObjectSlice(set, get),
  ...createVolumeSlice(set, get),
  ...createInstanceSlice(set, get),
  ...createTransformSlice(set, get),
  ...createSplitSlice(set, get),
  ...createMergeSlice(set, get),
});
