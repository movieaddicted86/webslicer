import { useRef, useMemo } from 'react';
import { useStore } from '../state/store';
import { viewDef } from './viewer/cameraMath';
import { printerLayerLimits } from '../plater/layerProfile';
import { useKeyboardShortcuts } from './viewer/useKeyboardShortcuts';
import type { CamRequest, SceneRefs } from './viewer/types';
import { useGizmo } from './viewer/useGizmo';
import { usePlaterObjects } from './viewer/usePlaterObjects';
import { useBed } from './viewer/useBed';
import { useCamera, useCameraState } from './viewer/useCamera';
import { useGcodePreview } from './viewer/useGcodePreview';
import { useOutdatedResult } from '../state/useOutdatedResult';
import { useScene } from './viewer/useScene';
import { useAutoFrame } from './viewer/useAutoFrame';
import { useShells } from './viewer/useShells';
import { useCutPlane } from './viewer/useCutPlane';
import { normalizeColor } from '../gcode/colorprint';
import { paintKindOf } from '../tools/paintKind';
import { ToolStrip } from '../components/tools/ToolStrip';
import { useMediaQuery } from '../components/left/useMediaQuery';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/table';
import './Viewer.css';

export { VOLUME_COLORS } from './viewer/colors';

/** The width below which the view bar is the phone's compact row (the same number as the stylesheet). */
const PHONE_QUERY = '(max-width: 640px)';

/**
 * The view row, on every screen (T-105): four icon buttons in one line – Home, Iso, turn left and
 * turn right. The seven named views needed two rows of short labels over the model; the two turns
 * give the four isometric corners instead, staying at the same elevation and distance. The number
 * keys 0–6 still select the standard views on a keyboard.
 */
const VIEW_ISO = viewDef('iso');
const VIEW_BUTTONS: Array<{
  id: 'home' | 'iso' | 'turn-left' | 'turn-right';
  label: string;
  title: string;
  icon: IconName;
  request: CamRequest;
  testId: string;
}> = [
  {
    id: 'home',
    label: 'Home',
    title: 'Home view – frame the whole plate',
    icon: 'viewHome',
    request: { mode: 'bed' },
    testId: 'view-home',
  },
  {
    id: 'iso',
    label: `${VIEW_ISO.label} view`,
    title: `${VIEW_ISO.label} view (${VIEW_ISO.key})`,
    icon: 'viewIso',
    request: { mode: 'view', view: 'iso' },
    testId: 'view-iso',
  },
  {
    id: 'turn-left',
    label: 'Turn left 90°',
    title: 'Turn the view 90° to the left',
    icon: 'viewTurnLeft',
    request: { mode: 'turn', turns: -1 },
    testId: 'view-turn-left',
  },
  {
    id: 'turn-right',
    label: 'Turn right 90°',
    title: 'Turn the view 90° to the right',
    icon: 'viewTurnRight',
    request: { mode: 'turn', turns: 1 },
    testId: 'view-turn-right',
  },
];

export function Viewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const refsRef = useRef<SceneRefs | null>(null);
  const { ortho, request: camRequest, toggleOrtho, requestCamera } = useCameraState();
  const phone = useMediaQuery(PHONE_QUERY);

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
  // the wide window's guided card blocks the lower scene only while the flow is open in a plate view
  const flowStep = useStore((s) => s.flowStep);
  const guidedCard = !phone && flowStep !== undefined && (view === 'plater' || view === 'preview');
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
  // Z-06: the plate fails the checks while a result is on screen – the toolpaths turn grey
  const outdated = useOutdatedResult();
  /** "Shells": the plater meshes shown translucent over the toolpaths */
  const shells = useStore((s) => s.previewShowShells) && view === 'preview' && !!gcode;
  // vendor bed model/texture of the selected printer ("vendor|model.stl|texture.svg", empty when none)
  const bedAssetKey = useStore((s) => {
    const p = s.presets.printer;
    if (!p.vendorId || !p.printerModel) return '';
    const m = s.vendors.flatMap((v) => v.models).find((x) => x.vendorId === p.vendorId && x.id === p.printerModel);
    return m && (m.bedModel || m.bedTexture) ? `${m.vendorId}|${m.bedModel || ''}|${m.bedTexture || ''}` : '';
  });

  // --- init scene (the touch gestures frame everything on a double tap, like the Home button)
  useScene(refsRef, containerRef, { frameAll: () => requestCamera({ mode: 'bed' }) });

  useBed(refsRef, bedShape, bedAssetKey);

  // --- perspective / orthographic (PrusaSlicer's K), and the camera commands: standard views,
  // zoom to selection, fit the bed
  useCamera(refsRef, ortho, camRequest);

  // --- the plate and its objects are framed into the room above the sheet (T-101) or above the
  // guided start's floating card (T-106) – whichever blocks the scene on this window
  useAutoFrame(refsRef, requestCamera, phone, guidedCard);

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
    outdated,
  });

  // keyboard
  useKeyboardShortcuts(requestCamera, toggleOrtho);

  return (
    <div className={`viewer view-${view} ${placeOnFace ? 'place-on-face' : ''}`} ref={containerRef}>
      {/* L-4: the tool strip floats at the top centre; the open tool's controls are in the context
          panel and carry the key hints, so there is no banner repeating them over the scene.
          T-101/AC-8: the Preview edits no plate, so a phone shows no strip there and the view row
          takes the top edge – the sheet then leaves most of the screen to the toolpaths. */}
      {!(phone && view === 'preview') && <ToolStrip />}
      <div className="viewer-hint">
        {view === 'plater' && (
          <div>Left: rotate · Right/Middle: pan · Wheel: zoom · M/R/S: move/rotate/scale · F: place on face · A: arrange · Del: delete</div>
        )}
        <div>Views: 0-6 · K: perspective/ortho · Z: zoom to selection</div>
      </div>
      {/* The view row: Home, Iso and the two quarter turns, the projection and zoom to selection –
          the same four view buttons on every screen (T-105). It floats centred in the band between
          the cards, as the tool strip does, so it never sits under the context panel. */}
      <div className="viewer-bar-band">
        <div className="viewer-toolbar" data-testid="viewer-view-row">
          {VIEW_BUTTONS.map((v) => (
            <button
              key={v.id}
              className="viewer-view-button"
              title={v.title}
              aria-label={v.label}
              data-testid={v.testId}
              onClick={() => requestCamera(v.request)}
            >
              <Icon name={v.icon} size={20} />
            </button>
          ))}
          {/* the projection and the zoom-to-selection stay as they were: on the phone the row is the
              four views alone, the keys and gestures cover the rest */}
          {!phone && (
            <>
              <button
                className={ortho ? 'active' : ''}
                title={ortho ? 'Orthographic projection (K)' : 'Perspective projection (K)'}
                data-testid="viewer-projection"
                onClick={toggleOrtho}
              >
                {ortho ? 'Ortho' : 'Persp'}
              </button>
              <button
                title="Zoom to selection (Z)"
                aria-label="Zoom to selection (Z)"
                data-testid="viewer-fit-selection"
                onClick={() => requestCamera({ mode: 'fit' })}
              >
                ⌖
              </button>
            </>
          )}
        </div>
        <button
          className="viewer-fit"
          title="Reset view"
          aria-label="Reset view"
          data-testid="viewer-fit"
          onClick={() => requestCamera({ mode: 'bed' })}
        >
          ⌂
        </button>
      </div>
    </div>
  );
}
