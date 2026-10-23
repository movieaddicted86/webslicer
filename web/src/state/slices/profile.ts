/**
 * The variable layer height part of the plater slice (T-045): the selected object's continuous layer
 * height profile, its adaptive/smooth/reset actions and the manual brush.
 *
 * The algorithms are pure functions of `@webslicer/shared`; this slice only reads the object's mesh
 * (a triangle soup in the object's own frame, so the profile's Z is the object's Z), the printer's
 * layer height limits and the print profile's layer height, then stores the resulting profile on the
 * object. Every action is one undo step; the profile itself is what the slice request carries.
 */
import { adaptiveProfile, applyBrush, smoothProfile } from '@webslicer/shared';
import { geometrySoup } from '../../plater/meshInfo';
import type { SlicePart } from '../types';
import { DEFAULT_PROFILE_SETTINGS, printerLayerLimits, type ProfileSettings } from '../../plater/layerProfile';

export interface ProfileSlice {
  /** the panel's settings (quality, smooth radius, brush) */
  profileSettings: ProfileSettings;
  setProfileSettings: (patch: Partial<ProfileSettings>) => void;
  /** replace the selected object's profile with an adaptive one (PrusaSlicer's "Adaptive") */
  applyAdaptive: (objectId: string) => void;
  /** smooth the selected object's profile ("Smooth") */
  applySmooth: (objectId: string) => void;
  /** drop the profile: the object prints with its fixed layer height ("Reset") */
  resetProfile: (objectId: string) => void;
  /** the brush of the chart: add/subtract layer height around `z`; a drag records one undo step */
  brushProfile: (objectId: string, z: number, delta: number, undoable?: boolean) => void;
}

/** The nominal layer height of the print profile (the middle of the adaptive quality curve). */
function nominalHeight(print: Record<string, string>): number | undefined {
  const n = Number(print.layer_height);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export const createProfileSlice: SlicePart<ProfileSlice> = (set, get) => {
  /** Store a profile of one object as one undo step (`undoable` false for the rest of a brush drag). */
  const store = (objectId: string, profile: number[] | undefined, undoable = true) => {
    if (undoable) get().recordHistory();
    set((s) => ({
      objects: s.objects.map((o) => (o.id === objectId ? { ...o, layerProfile: profile && profile.length ? profile : undefined } : o)),
      sliceDirty: true,
    }));
  };
  return {
    profileSettings: { ...DEFAULT_PROFILE_SETTINGS },
    setProfileSettings: (patch) => set((s) => ({ profileSettings: { ...s.profileSettings, ...patch } })),
    applyAdaptive: (objectId) => {
      const s = get();
      const o = s.objects.find((x) => x.id === objectId);
      if (!o) return;
      const limits = printerLayerLimits(s.presets.printer.current);
      const soup = geometrySoup(o.geometry);
      const profile = adaptiveProfile(
        { positions: soup },
        s.profileSettings.quality,
        limits.min,
        limits.max,
        nominalHeight(s.presets.print.current),
      );
      if (!profile.length) {
        s.toast('info', 'Adaptive: the object has no measurable surface');
        return;
      }
      store(objectId, profile);
    },
    applySmooth: (objectId) => {
      const s = get();
      const o = s.objects.find((x) => x.id === objectId);
      if (!o?.layerProfile) return;
      const limits = printerLayerLimits(s.presets.printer.current);
      const profile = smoothProfile(o.layerProfile, s.profileSettings.radius, s.profileSettings.keepMin, limits);
      store(objectId, profile);
    },
    resetProfile: (objectId) => {
      const o = get().objects.find((x) => x.id === objectId);
      if (!o?.layerProfile) return;
      store(objectId, undefined);
    },
    brushProfile: (objectId, z, delta, undoable = true) => {
      const s = get();
      const o = s.objects.find((x) => x.id === objectId);
      if (!o?.layerProfile) return;
      const limits = printerLayerLimits(s.presets.printer.current);
      const profile = applyBrush(o.layerProfile, z, s.profileSettings.brushRadius, delta, limits);
      store(objectId, profile, undoable);
    },
  };
};
