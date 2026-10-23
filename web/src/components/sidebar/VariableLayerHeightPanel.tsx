/**
 * The variable layer height panel (T-045): the chart of the selected object's profile, the Adaptive /
 * Smooth / Reset buttons and their sliders, and the brush that adds or subtracts layer height by
 * dragging in the chart. Shown in the manipulation panel of a single selected object (like the height
 * ranges), for Advanced/Expert – the whole object list is one of those modes.
 *
 * The chart is a plain SVG: Z up the vertical axis, layer height along the horizontal one. Dragging in it
 * applies the brush of the shared algorithm around the Z under the pointer; "Subtract" turns the drag
 * into "thinner layers".
 */
import { useMemo, useRef, useState } from 'react';
import { maxNeighbourHeightDiff, profileHeights } from '@webslicer/shared';
import { useStore, type PlaterObject } from '../../state/store';
import { chartFrame, printerLayerLimits } from '../../plater/layerProfile';
import { SectionHeader } from '../common/SectionHeader';
import { NumericField } from '../common/NumericField';
import { fmt } from '../../format';

/** The chart's size in SVG units (the CSS scales it to the panel width). */
const W = 170;
const H = 150;

export function VariableLayerHeightPanel({ o }: { o: PlaterObject }) {
  const settings = useStore((s) => s.profileSettings);
  const setSettings = useStore((s) => s.setProfileSettings);
  const applyAdaptive = useStore((s) => s.applyAdaptive);
  const applySmooth = useStore((s) => s.applySmooth);
  const resetProfile = useStore((s) => s.resetProfile);
  const brushProfile = useStore((s) => s.brushProfile);
  const printer = useStore((s) => s.presets.printer.current);
  const [subtract, setSubtract] = useState(false);
  const dragging = useRef(false);

  const limits = useMemo(() => printerLayerLimits(printer), [printer]);
  const profile = o.layerProfile || [];
  const zMax = o.size[2] || 1;
  const frame = useMemo(() => chartFrame(profile, limits, zMax, W, H), [profile, limits, zMax]);
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
  const paint = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!hasProfile) return;
    brushProfile(o.id, zAt(e), subtract ? -settings.brushDelta : settings.brushDelta);
  };
  const line = frame.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  return (
    <div className="layer-profile-panel">
      <SectionHeader title="Variable layer height">
        <button onClick={() => applyAdaptive(o.id)} title="Compute an adaptive profile from the surface slopes">
          Adaptive
        </button>
        <button onClick={() => applySmooth(o.id)} disabled={!hasProfile} title="Smooth the profile">
          Smooth
        </button>
        <button onClick={() => resetProfile(o.id)} disabled={!hasProfile} title="Back to the object's fixed layer height">
          Reset
        </button>
      </SectionHeader>
      <svg
        className="layer-profile-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Layer height profile: Z from bottom to top, layer height from left to right"
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          paint(e);
        }}
        onPointerMove={(e) => {
          if (dragging.current) paint(e);
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
      <div className="layer-profile-stats muted small">
        {hasProfile
          ? `${heights.length} layers · ${fmt(minH, 3)}–${fmt(maxH, 3)} mm · max jump ${fmt(jumps, 3)} mm`
          : `Fixed layer height (limits ${fmt(limits.min, 2)}–${fmt(limits.max, 2)} mm)`}
      </div>
      <label className="manip-row">
        <span>Quality</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={settings.quality}
          onChange={(e) => setSettings({ quality: Number(e.target.value) })}
          title="Adaptive quality: 0 = finest, 1 = fastest"
        />
        <span className="unit">{Math.round(settings.quality * 100)}%</span>
      </label>
      <label className="manip-row">
        <span>Radius</span>
        <input
          type="range"
          min={0.2}
          max={10}
          step={0.2}
          value={settings.radius}
          onChange={(e) => setSettings({ radius: Number(e.target.value) })}
          title="Smoothing radius in mm"
        />
        <NumericField
          text={String(settings.radius)}
          step={0.2}
          min={0.2}
          onText={(t) => {
            const n = Number(t);
            if (Number.isFinite(n) && n > 0) setSettings({ radius: n });
          }}
        />
        <span className="unit">mm</span>
      </label>
      <label className="arrange-check">
        <input type="checkbox" checked={settings.keepMin} onChange={(e) => setSettings({ keepMin: e.target.checked })} />
        Keep minimum
      </label>
      <label className="arrange-check">
        <input type="checkbox" checked={subtract} onChange={(e) => setSubtract(e.target.checked)} />
        Brush subtracts (drag in the chart)
      </label>
    </div>
  );
}
