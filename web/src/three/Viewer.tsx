import { useRef, useMemo } from 'react';
import { useStore } from '../state/store';
import { VIEWS } from './viewer/cameraMath';
import { printerLayerLimits } from '../plater/layerProfile';
import { useKeyboardShortcuts } from './viewer/useKeyboardShortcuts';
import type { SceneRefs } from './viewer/types';
import { useGizmo } from './viewer/useGizmo';
import { usePlaterObjects } from './viewer/usePlaterObjects';
import { useBed } from './viewer/useBed';
import { useCamera, useCameraState } from './viewer/useCamera';
import { useGcodePreview } from './viewer/useGcodePreview';
import { useOutdatedResult } from '../state/useOutdatedResult';
import { useScene } from './viewer/useScene';
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
 * The phone's view row (T-099): four icon buttons in one line – Home, Iso, turn left and turn right.
 * The seven named views need two rows of short labels over the model, and a thumb needs neither Top
 * nor Bottom on a companion screen; the two turns give the four isometric corners instead, staying at
 * the same elevation and distance.
 */
const PHONE_VIEWS: Array<{
  id: 'home' | 'iso' | 'turn-left' | 'turn-right';
  label: string;
  title: string;
  icon: IconName;
  testId: string;
}> = [
  { id: 'home', label: 'Home', title: 'Home view – frame the whole plate', icon: 'viewHome', testId: 'view-home' },
  { id: 'iso', label: 'Iso view', title: 'Iso view (0)', icon: 'viewIso', testId: 'view-iso' },
  { id: 'turn-left', label: 'Turn left 90°', title: 'Turn the view 90° to the left', icon: 'viewTurnLeft', testId: 'view-turn-left' },
  { id: 'turn-right', label: 'Turn right 90°', title: 'Turn the view 90° to the right', icon: 'viewTurnRight', testId: 'view-turn-right' },
];

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

  // T-092: on a phone the seven views share one row of short buttons over the top of the scene, which
  // is also what the Preview's view buttons are – one tap, and each frames the toolpaths (the same
  // `focusBox` a key uses)
  const phone = useMediaQuery(PHONE_QUERY);
  // #14: the Preview's plate hides the underside of the model anyway, so its view row drops Bottom;
  // the Plater keeps all seven (checking overhangs and the first layer from below), and the keyboard
  // shortcut still reaches the bottom view in both
  const desktopViews = view === 'preview' ? VIEWS.filter((v) => v.id !== 'bottom') : VIEWS;

  return (
    <div className={`viewer ${placeOnFace ? 'place-on-face' : ''}`} ref={containerRef}>
      {/* L-4: the tool strip floats at the top centre; the open tool's controls are in the context
          panel and carry the key hints, so there is no banner repeating them over the scene */}
      <ToolStrip />
      <div className="viewer-hint">
        {view === 'plater' && (
          <div>Left: rotate · Right/Middle: pan · Wheel: zoom · M/R/S: move/rotate/scale · F: place on face · A: arrange · Del: delete</div>
        )}
        <div>Views: 0-6 · K: perspective/ortho · Z: zoom to selection</div>
      </div>
      {/* PrusaSlicer's view toolbar: the standard views, the projection and zoom to selection.
          It floats centred in the band between the cards, as the tool strip does, so it never sits
          under the context panel. On a phone it is the four-button row described in `PHONE_VIEWS`. */}
      <div className="viewer-bar-band">
        {phone ? (
          <div className="viewer-toolbar" data-testid="viewer-view-row">
            {PHONE_VIEWS.map((v) => (
              <button
                key={v.id}
                className="viewer-view-button"
                title={v.title}
                aria-label={v.label}
                data-testid={v.testId}
                onClick={() => {
                  if (v.id === 'home') return requestCamera({ mode: 'bed' });
                  if (v.id === 'iso') return requestCamera({ mode: 'view', view: 'iso' });
                  return requestCamera({ mode: 'turn', turns: v.id === 'turn-left' ? -1 : 1 });
                }}
              >
                <Icon name={v.icon} size={20} />
              </button>
            ))}
          </div>
        ) : (
          <div className="viewer-toolbar">
            {desktopViews.map((v) => (
              <button
                key={v.id}
                className="viewer-view-button"
                title={`${v.label} view (${v.key})`}
                aria-label={`${v.label} view`}
                data-testid={`viewer-view-${v.id}`}
                onClick={() => requestCamera({ mode: 'view', view: v.id })}
              >
                {v.label}
              </button>
            ))}
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
          </div>
        )}
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
