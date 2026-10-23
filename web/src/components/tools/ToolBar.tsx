/**
 * The left tool bar of the 3D view (T-046): one vertical button per registry entry, grouped
 * (transform | edit | paint) with the shared `ToolbarButton`. Disabled tools show their `isAvailable`
 * reason as the tooltip, the open tool and – with no panel open – the current transform mode are
 * highlighted. Clicking the open tool closes it (the toggle lives in `openTool`).
 */
import { useStore } from '../../state/store';
import { ToolbarButton } from '../common/ToolbarButton';
import { isToolActive, toolsInGroup, type ToolGroup } from '../../tools/registry';

const GROUPS: ToolGroup[] = ['transform', 'edit', 'paint'];

/** The tooltip of a bar button: the name, its shortcut and – when unavailable – the reason. */
function toolTitle(title: string, keys?: string[], reason?: string): string {
  const base = keys?.length ? `${title} (${keys[keys.length - 1]})` : title;
  return reason ? `${base}: ${reason}` : base;
}

export function ToolBar() {
  const state = useStore((s) => s);
  const openTool = useStore((s) => s.openTool);
  return (
    <div className="tool-bar" role="toolbar" aria-label="Tools" aria-orientation="vertical">
      {GROUPS.map((group, gi) => (
        <div className="tool-bar-group" key={group}>
          {gi > 0 && <span className="tool-sep" aria-hidden="true" />}
          {toolsInGroup(group).map((tool) => {
            const available = tool.isAvailable(state);
            return (
              <ToolbarButton
                key={tool.id}
                title={toolTitle(tool.title, tool.shortcut?.keys, available.reason)}
                icon={tool.icon}
                active={isToolActive(tool, state)}
                disabled={!available.ok}
                onClick={() => void openTool(tool.id)}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
