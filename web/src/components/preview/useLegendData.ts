import { useMemo } from 'react';
import { useStore } from '../../state/store';
import { sumTimes } from './formats';

/**
 * The numbers the preview legend needs (F-14): the G-code, the extruders it uses and the two
 * figures that turn the feedrate-only times into the slicer's estimate. The preview panel and the
 * left column's legend card show the same legend, so they read the same data from one place.
 */
export function useLegendData() {
  const gcode = useStore((s) => s.gcode);
  const estimatedSeconds = useStore((s) => s.job?.info?.estimatedTimeSeconds);
  const usedTools = useMemo(() => (gcode ? [...new Set(gcode.tools)].sort((a, b) => a - b) : []), [gcode]);
  // feature times come from feedrates only, scale them to the slicer's estimate (as the layer legend does)
  const featureTimeScale = useMemo(() => {
    const sum = sumTimes(gcode?.featureTime ?? {});
    return estimatedSeconds && sum > 0 ? estimatedSeconds / sum : 1;
  }, [gcode, estimatedSeconds]);
  // share of the print time without travel, so the extruding features add up to 100 %
  const featureShare = useMemo(() => {
    const share: Record<string, number> = {};
    if (!gcode) return share;
    const base = sumTimes(gcode.featureTime) - (gcode.featureTime.Travel || 0);
    if (base <= 0) return share;
    for (const [feature, seconds] of Object.entries(gcode.featureTime)) share[feature] = (seconds / base) * 100;
    return share;
  }, [gcode]);
  return { gcode, usedTools, featureTimeScale, featureShare, estimatedSeconds };
}
