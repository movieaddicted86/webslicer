/**
 * The left tool bar of the 3D view (T-046): one vertical button per registry entry, grouped
 * (transform | edit | paint) with the shared `ToolbarButton`. Disabled tools show their `isAvailable`
 * reason as the tooltip, the open tool and – with no panel open – the current transform mode are
 * highlighted. Clicking the open tool closes it (the toggle lives in `openTool`).
 *
 * The bar subscribes to two primitives only – the open tool/transform mode and a signature of the
 * availability – so a paint stroke (which writes the store on every sample) does not re-render nine
 * buttons; the availability itself is asked of the tool definitions.
 */
import { useStore } from '../../state/store';
import { ToolbarButton } from '../common/ToolbarButton';
import { isToolActive, toolsInGroup, TOOLS, type ToolGroup } from '../../tools/registry';

const GROUPS: ToolGroup[] = ['transform', 'edit', 'paint'];

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
  return (
    <div className="tool-bar" role="toolbar" aria-label="Tools" aria-orientation="vertical">
      {GROUPS.map((group, gi) => (
        <div className="tool-bar-group" key={group}>
          {gi > 0 && <span className="tool-sep" aria-hidden="true" />}
          {toolsInGroup(group).map((tool) => {
            const reason = reasons[TOOLS.indexOf(tool)];
            return (
              <ToolbarButton
                key={tool.id}
                title={toolTitle(tool.title, tool.shortcut?.keys, reason)}
                icon={tool.icon}
                active={isToolActive(tool, { activeTool, transformMode })}
                disabled={!!reason}
                onClick={() => openTool(tool.id)}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
