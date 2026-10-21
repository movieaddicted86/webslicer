import { useId, useMemo } from 'react';
import { useStore } from '../../state/store';
import { layerMoves, toolPosition } from '../../gcode/moves';
import type { ParsedGcode } from '../../gcode/types';

/**
 * PrusaSlicer's horizontal slider: plays the moves of the top visible layer one by one. The range is
 * the moves of that layer, "end of layer" (no cut) shows the whole layer.
 */
export function MoveSlider({ gcode }: { gcode: ParsedGcode }) {
  const range = useStore((s) => s.previewLayerRange);
  const moveCut = useStore((s) => s.previewMoveCut);
  const setMoveCut = useStore((s) => s.setPreviewMoveCut);
  const moves = useMemo(() => layerMoves(gcode, range[1]), [gcode, range[1]]);
  const sliderId = useId();
  if (moves.length === 0) return null;
  const first = moves[0];
  const last = moves[moves.length - 1];
  const value = moveCut ?? last;
  const pos = toolPosition(gcode, value);
  const done = value - first + 1;
  return (
    <div className="move-slider">
      <label className="small" htmlFor={sliderId}>
        Move
      </label>
      <input
        id={sliderId}
        type="range"
        min={first}
        max={last}
        value={value}
        title="Print the top layer move by move"
        onChange={(e) => {
          const v = Number(e.target.value);
          setMoveCut(v >= last ? undefined : v);
        }}
      />
      <div className="muted small">
        {done} / {moves.length} moves
        {pos ? ` · X ${pos[0].toFixed(1)} Y ${pos[1].toFixed(1)} Z ${pos[2].toFixed(2)}` : ''}
      </div>
    </div>
  );
}
