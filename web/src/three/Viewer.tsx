import { useRef, useMemo } from 'react';
import { useStore } from '../state/store';
import { VIEWS } from '../plater/camera';
import { printerLayerLimits } from '../plater/layerProfile';
import { useKeyboardShortcuts } from './viewer/useKeyboardShortcuts';
import type { SceneRefs } from './viewer/types';
import { useGizmo } from './viewer/useGizmo';
import { usePlaterObjects } from './viewer/usePlaterObjects';
import { useBed } from './viewer/useBed';
import { useCamera, useCameraState } from './viewer/useCamera';
import { useGcodePreview } from './viewer/useGcodePreview';
import { useScene } from './viewer/useScene';
import { useShells } from './viewer/useShells';
import { useCutPlane } from './viewer/useCutPlane';
import { normalizeColor } from '../gcode/colorprint';
import { paintKindOf } from '../tools/paintKind';
import { ToolBar } from '../components/tools/ToolBar';
import { ToolDock } from '../components/tools/ToolDock';

export { VOLUME_COLORS } from './viewer/colors';

export function Viewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const refsRef = useRef<SceneRefs | null>(null);
  const { ortho, request: camRequest, toggleOrtho, requestCamera } = useCameraState();

  const objects = useStore((s) => s.objects);
  const selectedIds = useStore((s) => s.selectedIds);
  const selectedVolumeId = useStore((s) => s.selectedVolumeId);
  const selectedInstanceId = useStore((s) => s.selectedInstanceId);
  const transformMode = useStore((s) => s.transformMode);
  const bedShape = useStore((s) => s.presets.printer.current.bed_shape || '0x0,200x0,200x200,0x200');
  const maxHeight = useStore((s) => Number(s.presets.printer.current.max_print_height || 200));
  const printer = useStore((s) => s.presets.printer.current);
  // the layer height gradient's range (T-045); memoised so it does not re-run the object effect
  const layerLimits = useMemo(() => printerLayerLimits(printer), [printer]);
  const view = useStore((s) => s.view);
  const gcode = useStore((s) => s.gcode);
  const range = useStore((s) => s.previewLayerRange);
  const showTravel = useStore((s) => s.previewShowTravel);
  const featureVis = useStore((s) => s.previewFeatureVisibility);
  const moveCut = useStore((s) => s.previewMoveCut);
  const markerVis = useStore((s) => s.previewMarkers);
  const colorMode = useStore((s) => s.previewColorMode);
  const customGcodes = useStore((s) => s.customGcodes);
  const filamentColour = useStore((s) => s.presets.filament[0]?.current.filament_colour);
  const toolColorKey = useStore((s) => s.presets.filament.map((f) => normalizeColor(f.current.filament_colour)).join(','));
  const placeOnFace = useStore((s) => s.activeTool === 'placeOnFace');
  // the paint kind of the open paint tool, what the stroke code and the object colours read (T-046)
  const paintMode = useStore((s) => paintKindOf(s.activeTool));
  /** "Shells": the plater meshes shown translucent over the toolpaths */
  const shells = useStore((s) => s.previewShowShells) && view === 'preview' && !!gcode;
  // vendor bed model/texture of the selected printer ("vendor|model.stl|texture.svg", empty when none)
  const bedAssetKey = useStore((s) => {
    const p = s.presets.printer;
    if (!p.vendorId || !p.printerModel) return '';
    const m = s.vendors.flatMap((v) => v.models).find((x) => x.vendorId === p.vendorId && x.id === p.printerModel);
    return m && (m.bedModel || m.bedTexture) ? `${m.vendorId}|${m.bedModel || ''}|${m.bedTexture || ''}` : '';
  });

  // --- init scene
  useScene(refsRef, containerRef);

  useBed(refsRef, bedShape, bedAssetKey);

  // --- perspective / orthographic (PrusaSlicer's K), and the camera commands: standard views,
  // zoom to selection, fit the bed
  useCamera(refsRef, ortho, camRequest);

  // --- objects and the transform gizmo
  usePlaterObjects(refsRef, {
    objects,
    selectedIds,
    selectedVolumeId,
    selectedInstanceId,
    view,
    bedShape,
    maxHeight,
    gcode,
    paintMode,
    shells,
    layerLimits,
  });
  useGizmo(refsRef, { objects, selectedIds, selectedVolumeId, selectedInstanceId, transformMode, view, paintMode });

  useShells(refsRef, shells, objects);

  // --- the translucent cut plane of the cut panel (T-044)
  useCutPlane(refsRef);

  // --- gcode
  useGcodePreview(refsRef, {
    gcode,
    view,
    range,
    moveCut,
    showTravel,
    markerVis,
    featureVis,
    colorMode,
    customGcodes,
    filamentColour,
    toolColorKey,
  });

  // keyboard
  useKeyboardShortcuts(requestCamera, toggleOrtho);

  return (
    <div className={`viewer ${placeOnFace ? 'place-on-face' : ''}`} ref={containerRef}>
      {/* T-046: the tool bar on the left edge and the open tool's panel next to it, over the 3D view */}
      <ToolBar />
      <ToolDock />
      {placeOnFace && <div className="viewer-banner">Place on face: click the face that should lie flat on the bed (Esc to cancel)</div>}
      {paintMode && (
        <div className="viewer-banner">
          {paintMode === 'mmu'
            ? 'Paint extruder: left = selected extruder · right / Shift+left = reset to object extruder · Esc = done'
            : `${paintMode === 'supports' ? 'Paint supports' : 'Paint seam'}: left = brush tool · right = blocker · Shift+left = erase · Esc = done`}
        </div>
      )}
      <div className="viewer-hint">
        {view === 'plater' && (
          <div>Left: rotate · Right/Middle: pan · Wheel: zoom · M/R/S: move/rotate/scale · F: place on face · A: arrange · Del: delete</div>
        )}
        <div>Views: 0-6 · K: perspective/ortho · Z: zoom to selection</div>
      </div>
      {/* PrusaSlicer's view toolbar: the standard views, the projection and zoom to selection */}
      <div className="viewer-toolbar">
        {VIEWS.map((v) => (
          <button key={v.id} title={`${v.label} view (${v.key})`} onClick={() => requestCamera({ mode: 'view', view: v.id })}>
            {v.label}
          </button>
        ))}
        <button
          className={ortho ? 'active' : ''}
          title={ortho ? 'Orthographic projection (K)' : 'Perspective projection (K)'}
          onClick={toggleOrtho}
        >
          {ortho ? 'Ortho' : 'Persp'}
        </button>
        <button title="Zoom to selection (Z)" aria-label="Zoom to selection (Z)" onClick={() => requestCamera({ mode: 'fit' })}>
          ⌖
        </button>
      </div>
      <button className="viewer-fit" title="Reset view" aria-label="Reset view" onClick={() => requestCamera({ mode: 'bed' })}>
        ⌂
      </button>
    </div>
  );
}
