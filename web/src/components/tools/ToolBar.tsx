/**
 * The left tool bar of the 3D view (T-046): one vertical button per registry entry, grouped
 * (transform | edit | paint) with the shared `ToolbarButton`. Disabled tools show their `isAvailable`
 * reason as the tooltip, the open tool and – with no panel open – the current transform mode are
 * highlighted. Clicking the open tool closes it (the toggle lives in `openTool`).
 *
 * T-055: the buttons show a short label next to the icon while the 3D view is wide enough; the
 * toggle at the bottom of the bar overrides that choice and the browser remembers it. The width is
 * measured on the bar's parent (a container query by hand: the bar's own width *is* the answer, so
 * it cannot decide it), never on the window – the sidebar and, later, the mobile layout change how
 * much room the view has at the same window size.
 *
 * The bar subscribes to two primitives only – the open tool/transform mode and a signature of the
 * availability – so a paint stroke (which writes the store on every sample) does not re-render nine
 * buttons; the availability itself is asked of the tool definitions.
 */
import { useEffect, useRef, useState } from 'react';
import { Tags } from 'lucide-react';
import { useStore } from '../../state/store';
import { ToolbarButton } from '../common/ToolbarButton';
import { isToolActive, toolsInGroup, TOOLS, type ToolGroup } from '../../tools/registry';

const GROUPS: ToolGroup[] = ['transform', 'edit', 'paint'];

/** From this width of the 3D view on, the labels fit next to the icons. */
export const LABEL_MIN_VIEW_WIDTH = 1100;

/** The user's choice of labels; absent means "decide by the available width". */
const LABELS_KEY = 'webslicer.toolLabels';

function loadLabels(): boolean | undefined {
  try {
    const v = localStorage.getItem(LABELS_KEY);
    return v === 'on' ? true : v === 'off' ? false : undefined;
  } catch {
    return undefined;
  }
}

function saveLabels(show: boolean): void {
  try {
    localStorage.setItem(LABELS_KEY, show ? 'on' : 'off');
  } catch {
    /* private window: the choice just does not survive the reload */
  }
}

/** The reason each tool is unavailable (`''` when it is available), as one comparable string. */
const availabilitySignature = (state: Parameters<(typeof TOOLS)[number]['isAvailable']>[0]) =>
  TOOLS.map((t) => t.isAvailable(state).reason ?? '').join('\u0000');

/** The tooltip of a bar button: the name, its shortcut and – when unavailable – the reason. */
function toolTitle(title: string, keys?: string[], reason?: string): string {
  const base = keys?.length ? `${title} (${keys[keys.length - 1]})` : title;
  return reason ? `${base}: ${reason}` : base;
}

export function ToolBar() {
  const activeTool = useStore((s) => s.activeTool);
  const transformMode = useStore((s) => s.transformMode);
  const signature = useStore((s) => availabilitySignature(s));
  const openTool = useStore((s) => s.openTool);
  const reasons = signature.split('\u0000');
  const barRef = useRef<HTMLDivElement>(null);
  // the user's override; `undefined` → follow the width
  const [override, setOverride] = useState<boolean | undefined>(loadLabels);
  const [wide, setWide] = useState(false);
  const showLabels = override ?? wide;

  useEffect(() => {
    const view = barRef.current?.parentElement;
    if (!view) return;
    const observer = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= LABEL_MIN_VIEW_WIDTH));
    observer.observe(view);
    return () => observer.disconnect();
  }, []);

  const toggle = () => {
    const next = !showLabels;
    saveLabels(next);
    setOverride(next);
  };

  return (
    <div
      ref={barRef}
      className={`tool-bar${showLabels ? ' with-labels' : ''}`}
      role="toolbar"
      aria-label="Tools"
      aria-orientation="vertical"
    >
      {GROUPS.map((group, gi) => (
        <div className="tool-bar-group" key={group}>
          {gi > 0 && <span className="tool-sep" aria-hidden="true" />}
          {toolsInGroup(group).map((tool) => {
            const reason = reasons[TOOLS.indexOf(tool)];
            return (
              <ToolbarButton
                key={tool.id}
                className="tool-bar-tool"
                title={toolTitle(tool.title, tool.shortcut?.keys, reason)}
                icon={tool.icon}
                label={showLabels ? tool.label : undefined}
                active={isToolActive(tool, { activeTool, transformMode })}
                disabled={!!reason}
                onClick={() => openTool(tool.id)}
              />
            );
          })}
        </div>
      ))}
      <span className="tool-sep" aria-hidden="true" />
      {/* the label toggle: an explicit choice overrides the automatic one (T-055) */}
      <ToolbarButton
        className="tool-bar-labels"
        title={showLabels ? 'Hide tool labels' : 'Show tool labels'}
        icon={Tags}
        active={override !== undefined}
        onClick={toggle}
      />
    </div>
  );
}
