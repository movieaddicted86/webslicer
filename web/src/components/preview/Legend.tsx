import { useMemo } from 'react';
import { useStore } from '../../state/store';
import { FEATURE_COLORS, type ParsedGcode } from '../../gcode/types';
import { RANGE_SCHEMES, legendSteps, schemeRange, type PreviewColorMode } from '../../gcode/colorschemes';
import { colorPrintSegments, normalizeColor } from '../../gcode/colorprint';
import { fmtFeatureTime, fmtLayerTime, fmtZ } from '../../format';
import './Legend.css';

/** Gradient legend of a range colour scheme (speed, fan, temperature, …), maximum on top like PrusaSlicer. */
function RangeLegend({ gcode, mode, estimatedSeconds }: { gcode: ParsedGcode; mode: PreviewColorMode; estimatedSeconds?: number }) {
  const scheme = RANGE_SCHEMES[mode];
  const range = useMemo(() => schemeRange(gcode, mode), [gcode, mode]);
  // layer times come from feedrates only; scale them to the slicer's estimate (which includes acceleration)
  const timeScale = useMemo(() => {
    if (!scheme?.perLayer || !estimatedSeconds) return 1;
    const sum = gcode.layerTime.reduce((a, b) => a + b, 0);
    return sum > 0 ? estimatedSeconds / sum : 1;
  }, [gcode, scheme?.perLayer, estimatedSeconds]);
  // a mode without a range scheme has no gradient to show
  if (!scheme) return null;
  const label = (v: number) => (scheme.perLayer ? fmtLayerTime(v * timeScale) : v.toFixed(scheme.decimals));
  if (range[1] <= 0 && range[0] <= 0) return <div className="muted small">No data for this view in the G-code.</div>;
  return (
    <ul className="legend range" data-testid="legend">
      {legendSteps(range, scheme.log).map((st, i) => (
        <li key={i}>
          <span className="swatch" style={{ background: st.color }} />
          <span className="name">{label(st.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The legend under the colour mode select (F-14): the range gradient, the extruders, the colour-print
 * segments or - the default - the feature list with time, share and length, which is also the switch
 * that hides a feature in the preview.
 */
export function PreviewLegend({
  gcode,
  usedTools,
  featureTimeScale,
  featureShare,
  estimatedSeconds,
}: {
  gcode: ParsedGcode;
  usedTools: number[];
  featureTimeScale: number;
  featureShare: Record<string, number>;
  estimatedSeconds?: number;
}) {
  const colorMode = useStore((s) => s.previewColorMode);
  const vis = useStore((s) => s.previewFeatureVisibility);
  const toggle = useStore((s) => s.togglePreviewFeature);
  const baseColor = useStore((s) => normalizeColor(s.presets.filament[0]?.current.filament_colour));
  const toolColors = useStore((s) => s.presets.filament.map((f) => normalizeColor(f.current.filament_colour)).join(','));
  const customGcodes = useStore((s) => s.customGcodes);
  if (RANGE_SCHEMES[colorMode]) return <RangeLegend gcode={gcode} mode={colorMode} estimatedSeconds={estimatedSeconds} />;
  if (colorMode === 'tool') {
    return (
      <ul className="legend" data-testid="legend">
        {usedTools.map((t) => (
          <li key={t}>
            <span className="swatch" style={{ background: toolColors.split(',')[t] ?? baseColor }} />
            <span className="name">Extruder {t + 1}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (colorMode === 'colorprint') {
    return (
      <ul className="legend" data-testid="legend">
        {colorPrintSegments(baseColor, customGcodes, gcode.layerZ[gcode.layerCount - 1] ?? 0).map((s, i) => (
          <li key={i}>
            <span className="swatch" style={{ background: s.color }} />
            <span className="name">{i === 0 ? 'Default color' : `Color ${i}`}</span>
            <span className="muted">
              {fmtZ(s.fromZ)} – {fmtZ(s.toZ)} mm
            </span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="legend features" data-testid="legend" title="Time, share of the print time (without travel) and extruded length">
      {gcode.featureTypes.map((f) => (
        <li
          key={f}
          className={vis[f] === false ? 'off' : ''}
          role="checkbox"
          aria-checked={vis[f] !== false}
          tabIndex={0}
          title={`${vis[f] === false ? 'Show' : 'Hide'} ${f} in the preview`}
          onClick={() => toggle(f)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            toggle(f);
          }}
        >
          <span className="swatch" style={{ background: FEATURE_COLORS[f] || FEATURE_COLORS.Unknown }} />
          <span className="name">{f}</span>
          <span className="muted time">{fmtFeatureTime((gcode.featureTime[f] || 0) * featureTimeScale)}</span>
          <span className="muted pct">{(featureShare[f] ?? 0).toFixed(1)}%</span>
          <span className="muted len">{((gcode.featureLength[f] || 0) / 1000).toFixed(1)} m</span>
        </li>
      ))}
      {gcode.featureTime.Travel ? (
        <li className="static" title="Travel is not extruded and has no share of its own">
          <span className="swatch" style={{ background: FEATURE_COLORS.Unknown, opacity: 0.35 }} />
          <span className="name">Travel</span>
          <span className="muted time">{fmtFeatureTime(gcode.featureTime.Travel * featureTimeScale)}</span>
          <span className="pct" />
          <span className="len" />
        </li>
      ) : null}
    </ul>
  );
}
