/**
 * The variable layer height panel (T-046, moved out of the sidebar; the feature is T-045): the chart
 * of the selected object's profile, the Adaptive / Smooth / Reset buttons and their sliders, and the
 * brush that adds or subtracts layer height by dragging in the chart.
 *
 * The chart is a plain SVG: Z up the vertical axis, layer height along the horizontal one. Dragging in
 * it applies the brush of the shared algorithm around the Z under the pointer; "Brush subtracts" turns
 * the drag into "thinner layers". Every action is one undo step (the whole drag is one).
 */
import { useMemo, useRef, useState } from 'react';
import { maxNeighbourHeightDiff, profileHeights } from '@webslicer/shared';
import { useStore } from '../../../state/store';
import { chartFrame, printerLayerLimits } from '../../../plater/layerProfile';
import { SliderField } from '../fields/SliderField';
import { ToggleRow } from '../fields/ToggleRow';
import { ToolPanel } from '../ToolPanel';
import { fmt } from '../../../format';
import './LayerHeightPanel.css';

/** The chart's size in SVG units (the CSS scales it to the panel width). */
const W = 170;
const H = 150;

export function LayerHeightPanel() {
  const settings = useStore((s) => s.profileSettings);
  const setSettings = useStore((s) => s.setProfileSettings);
  const applyAdaptive = useStore((s) => s.applyAdaptive);
  const applySmooth = useStore((s) => s.applySmooth);
  const resetProfile = useStore((s) => s.resetProfile);
  const brushProfile = useStore((s) => s.brushProfile);
  const close = useStore((s) => s.closeTool);
  const printer = useStore((s) => s.presets.printer.current);
  const o = useStore((s) => (s.selectedIds.length === 1 ? s.objects.find((x) => x.id === s.selectedIds[0]) : undefined));
  const [subtract, setSubtract] = useState(false);
  const dragging = useRef(false);

  // every hook runs before the guard: the panel closes with the last selection, but a render must
  // never change the hook order
  const limits = useMemo(() => printerLayerLimits(printer), [printer]);
  const profile = useMemo(() => o?.layerProfile ?? [], [o]);
  const zMax = o?.size[2] || 1;
  const frame = useMemo(() => chartFrame(profile, limits, zMax, W, H), [profile, limits, zMax]);
  if (!o) return null;

  const hasProfile = profile.length >= 2;
  const heights = profileHeights(profile);
  const minH = heights.length ? Math.min(...heights) : 0;
  const maxH = heights.length ? Math.max(...heights) : 0;
  const jumps = maxNeighbourHeightDiff(profile);

  /** The Z under the pointer: the chart's Y axis runs from the object's top down to its bottom. */
  const zAt = (e: React.PointerEvent<SVGSVGElement>): number => {
    const r = e.currentTarget.getBoundingClientRect();
    // the SVG is scaled by CSS: convert the pixel position back into SVG units
    const y = ((e.clientY - r.top) / r.height) * H;
    const t = (H - frame.pad - y) / (H - 2 * frame.pad);
    return Math.min(frame.zMax, Math.max(0, t * frame.zMax));
  };
  const paint = (e: React.PointerEvent<SVGSVGElement>, undoable: boolean) => {
    if (!hasProfile) return;
    brushProfile(o.id, zAt(e), subtract ? -settings.brushDelta : settings.brushDelta, undoable);
  };
  const line = frame.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  return (
    <ToolPanel
      title="Variable layer height"
      onClose={close}
      footer={
        <span className="layer-profile-stats muted small">
          {hasProfile
            ? `${heights.length} layers · ${fmt(minH, 3)}–${fmt(maxH, 3)} mm · max jump ${fmt(jumps, 3)} mm`
            : `Fixed layer height (limits ${fmt(limits.min, 2)}–${fmt(limits.max, 2)} mm)`}
        </span>
      }
    >
      <div className="layer-profile-actions">
        <button onClick={() => applyAdaptive(o.id)} title="Compute an adaptive profile from the surface slopes">
          Adaptive
        </button>
        <button onClick={() => applySmooth(o.id)} disabled={!hasProfile} title="Smooth the profile">
          Smooth
        </button>
        <button onClick={() => resetProfile(o.id)} disabled={!hasProfile} title="Back to the object's fixed layer height">
          Reset
        </button>
      </div>
      <svg
        className="layer-profile-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Layer height profile: Z from bottom to top, layer height from left to right"
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          // the whole drag is one undo step: only its first sample records history
          paint(e, true);
        }}
        onPointerMove={(e) => {
          if (dragging.current) paint(e, false);
        }}
        onPointerUp={(e) => {
          dragging.current = false;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
      >
        <rect className="chart-bg" x={frame.pad} y={frame.pad} width={W - 2 * frame.pad} height={H - 2 * frame.pad} />
        {hasProfile && (
          <>
            <polyline className="chart-line" points={line} />
            {frame.points.map((p, i) => (
              <circle key={i} className="chart-point" cx={p.x} cy={p.y} r={0.8} />
            ))}
          </>
        )}
        {!hasProfile && (
          <text className="chart-empty" x={W / 2} y={H / 2} textAnchor="middle">
            No profile – press Adaptive
          </text>
        )}
      </svg>
      <SliderField
        label="Quality"
        value={settings.quality}
        min={0}
        max={1}
        step={0.05}
        title="Adaptive quality: 0 = finest, 1 = fastest"
        onChange={(quality) => setSettings({ quality })}
        format={{
          show: (v) => `${Math.round(v * 100)}%`,
          parse: (t) => (Number.isFinite(Number(t.replace('%', ''))) ? Number(t.replace('%', '')) / 100 : undefined),
        }}
      />
      <SliderField
        label="Radius"
        value={settings.radius}
        min={0.2}
        max={10}
        step={0.2}
        unit="mm"
        title="Smoothing radius in mm"
        onChange={(radius) => setSettings({ radius })}
      />
      <ToggleRow label="Keep minimum" checked={settings.keepMin} onChange={(keepMin) => setSettings({ keepMin })} />
      <ToggleRow label="Brush subtracts (drag in the chart)" checked={subtract} onChange={setSubtract} />
    </ToolPanel>
  );
}
