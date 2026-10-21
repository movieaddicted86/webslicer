import { useId } from 'react';
import { useStore } from '../../state/store';
import type { ParsedGcode } from '../../gcode/types';
import { CODE_LABEL, layerIndexOfZ } from './formats';

/** The top and bottom layer sliders; the marks on the top one are the colour changes and pauses. */
export function LayerSlider({ gcode }: { gcode: ParsedGcode }) {
  const range = useStore((s) => s.previewLayerRange);
  const setRange = useStore((s) => s.setPreviewLayerRange);
  const customGcodes = useStore((s) => s.customGcodes);
  const topId = useId();
  const bottomId = useId();
  return (
    <>
      <label className="small" htmlFor={topId}>
        Top
      </label>
      <div className="slider-with-markers">
        <input id={topId} type="range" min={0} max={gcode.layerCount - 1} value={range[1]} onChange={(e) => setRange([Math.min(range[0], Number(e.target.value)), Number(e.target.value)])} />
        <div className="slider-markers">
          {customGcodes.map((c) => {
            const idx = layerIndexOfZ(gcode.layerZ, c.printZ);
            if (idx < 0) return null;
            const pct = gcode.layerCount > 1 ? (idx / (gcode.layerCount - 1)) * 100 : 0;
            return (
              <button
                key={c.printZ}
                className={`marker ${c.type}`}
                style={{ left: `${pct}%`, background: c.type === 'color_change' ? c.color : undefined }}
                title={`${CODE_LABEL[c.type]} at Z ${c.printZ.toFixed(2)} mm – click to jump`}
                onClick={() => setRange([Math.min(range[0], idx), idx])}
              />
            );
          })}
        </div>
      </div>
      <label className="small" htmlFor={bottomId}>
        Bottom
      </label>
      <input id={bottomId} type="range" min={0} max={gcode.layerCount - 1} value={range[0]} onChange={(e) => setRange([Number(e.target.value), Math.max(range[1], Number(e.target.value))])} />
    </>
  );
}
