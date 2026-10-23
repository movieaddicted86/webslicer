import { useStore } from '../../../state/store';
import { extruderCss } from '../../../palette';
import { ToolSection } from '../fields/ToolSection';
import { ToolPanel } from '../ToolPanel';
import './PaintToolPanel.css';

/**
 * The paint panel (T-046, moved out of the sidebar): the brush options of the open paint tool –
 * enforcer / blocker / erase, the extruder palette in multi-material mode, the brush radius and
 * "Clear all" with the number of painted triangles. The tool id decides the kind; the stroke itself
 * runs in `three/viewer/painting.ts`.
 */
const TITLES = { supports: 'Paint supports', seam: 'Paint seam', mmu: 'Paint extruder' } as const;

export function PaintToolPanel() {
  const tool = useStore((s) => s.activeTool);
  const paintTool = useStore((s) => s.paintTool);
  const brushRadius = useStore((s) => s.brushRadius);
  const paintExtruder = useStore((s) => s.paintExtruder);
  const extruders = useStore((s) => s.extruderCount());
  const setPaintTool = useStore((s) => s.setPaintTool);
  const setBrushRadius = useStore((s) => s.setBrushRadius);
  const setPaintExtruder = useStore((s) => s.setPaintExtruder);
  const clearPaint = useStore((s) => s.clearPaint);
  const close = useStore((s) => s.closeTool);
  const o = useStore((s) => (s.selectedIds.length === 1 ? s.objects.find((x) => x.id === s.selectedIds[0]) : undefined));
  const kind = tool === 'paintSupports' ? 'supports' : tool === 'paintSeam' ? 'seam' : 'mmu';
  const paint = o?.paint?.[kind];
  const count = paint ? paint.reduce((a, v) => a + (v ? 1 : 0), 0) : 0;
  return (
    <ToolPanel
      title={TITLES[kind]}
      onClose={close}
      footer={
        o && (
          <button className="tool-clear" title={`Remove all paint of ${o.name}`} onClick={() => clearPaint(o.id, kind)} disabled={!count}>
            Clear all{count ? ` (${count})` : ''}
          </button>
        )
      }
    >
      <ToolSection>
        {kind === 'mmu' ? (
          <div className="paint-tools">
            {Array.from({ length: extruders }, (_, i) => i + 1).map((n) => (
              <label
                key={n}
                className={`tool extruder ${paintExtruder === n ? 'active' : ''}`}
                style={{ borderColor: paintExtruder === n ? extruderCss(n) : undefined }}
                title={`Extruder ${n}`}
              >
                <input type="radio" checked={paintExtruder === n} onChange={() => setPaintExtruder(n)} />
                <span className="swatch" style={{ background: extruderCss(n) }} /> {n}
              </label>
            ))}
          </div>
        ) : (
          <div className="paint-tools">
            <label className={`tool enforcer ${paintTool === 'enforcer' ? 'active' : ''}`} title="Left mouse button">
              <input type="radio" checked={paintTool === 'enforcer'} onChange={() => setPaintTool('enforcer')} /> Enforcer
            </label>
            <label
              className={`tool blocker ${paintTool === 'blocker' ? 'active' : ''}`}
              title="Left mouse button (or right button any time)"
            >
              <input type="radio" checked={paintTool === 'blocker'} onChange={() => setPaintTool('blocker')} /> Blocker
            </label>
            <label className={`tool erase ${paintTool === 'erase' ? 'active' : ''}`} title="Left mouse button (or Shift+left any time)">
              <input type="radio" checked={paintTool === 'erase'} onChange={() => setPaintTool('erase')} /> Erase
            </label>
          </div>
        )}
        <label className="brush">
          <span>Brush {brushRadius.toFixed(1)} mm</span>
          <input type="range" min={0.5} max={25} step={0.5} value={brushRadius} onChange={(e) => setBrushRadius(Number(e.target.value))} />
        </label>
        <div className="muted small">
          {kind === 'supports'
            ? 'Enforcers force supports, blockers prevent them. Set Supports to "For support enforcers only" or "Everywhere".'
            : kind === 'seam'
              ? 'Enforcers attract the seam, blockers repel it.'
              : 'Painted triangles are printed with the selected extruder; unpainted ones use the object extruder.'}
        </div>
      </ToolSection>
    </ToolPanel>
  );
}
