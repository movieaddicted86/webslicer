/**
 * The tool strip: the floating pill over the scene, between the object list card and the context
 * panel. It is the one place that opens a tool – the registry provides buttons, groups, shortcuts and
 * disabled reasons – and it also carries the object commands that act on the selection.
 *
 * The groups are in PrusaSlicer's order; when they do not fit, the trailing ones move into an overflow
 * menu and `stripLayout` decides that from the width the band offers, so the layout is pure and
 * testable. On a narrow screen the strip scrolls instead: a dropdown over the scene would cover the
 * object the user just tapped. The band is measured, not assumed – the pill is centred between the
 * cards.
 *
 * The strip keeps the `tool-strip` layer and the `tool-bar` hook: it is still the one control that
 * opens the tools. Its buttons keep `tool-<id>`, and each carries `aria-pressed` for the open tool.
 */
import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../state/store';
import type { State } from '../../state/types';
import { ToolbarButton } from '../common/ToolbarButton';
import { Icon } from '../../icons/Icon';
import { isToolActive, toolTitle, TOOLS } from '../../tools/registry';
import {
  COMMAND_ICONS,
  COMMAND_KEYS,
  COMMAND_LABELS,
  commandDisabled,
  commandFacts,
  commandTitle,
  type CommandFacts,
  type StripCommand,
} from '../../tools/stripCommands';
import { runStripCommand } from '../../tools/stripActions';
import {
  COMPACT_QUERY,
  STRIP_GROUPS,
  fitGroups,
  hiddenItems,
  itemName,
  itemsOfGroup,
  stripFits,
  stripRoom,
  type StripGroupId,
  type StripItem,
} from './stripLayout';
import { useMediaQuery } from '../left/useMediaQuery';
import { ArrangeSettingsMenu } from '../left/ArrangeSettingsMenu';
import './ToolStrip.css';

/** The reason each tool is unavailable (`''` when it is available), as one comparable string. */
const availabilitySignature = (state: State) => TOOLS.map((t) => t.isAvailable(state).reason ?? '').join('\u0000');

export function ToolStrip() {
  const activeTool = useStore((s) => s.activeTool);
  const transformMode = useStore((s) => s.transformMode);
  const openTool = useStore((s) => s.openTool);
  const signature = useStore(availabilitySignature);
  const facts = useStore(useShallow(commandFacts));
  const reasons = signature.split('\u0000');
  const bandRef = useRef<HTMLDivElement>(null);
  // the band's width decides the fit; the window width is the first guess, the observer corrects it
  const [room, setRoom] = useState(() => window.innerWidth);
  const compact = useMediaQuery(COMPACT_QUERY);

  // the room the strip has is the band the cards leave free over the scene, not the window: folding or
  // hiding a card changes it at the same window size
  useEffect(() => {
    const band = bandRef.current;
    if (!band) return;
    const observer = new ResizeObserver(([entry]) => setRoom(entry.contentRect.width));
    observer.observe(band);
    return () => observer.disconnect();
  }, []);

  const available = stripRoom(room);
  // names only while they leave every group in the pill; the tooltips carry them otherwise
  const labels = !compact && stripFits(available, true);
  // a narrow window keeps every group and scrolls; a desktop window trades the trailing groups for the
  // overflow menu instead
  const { visible, hidden } = compact ? { visible: STRIP_GROUPS, hidden: [] as StripGroupId[] } : fitGroups(available, labels);

  /** One button of the strip: a registry tool or an object command. */
  const button = (item: StripItem) => {
    if (item.kind === 'command') {
      const command = item.command;
      if (command === 'arrangeSettings') return <ArrangeSettingsMenu key={command} testId={`tool-${command}`} />;
      return (
        <ToolbarButton
          key={command}
          className="tool-bar-tool"
          testId={`tool-${command}`}
          title={commandTitle(command, facts)}
          icon={COMMAND_ICONS[command]}
          disabled={commandDisabled(facts)[command]}
          onClick={() => runStripCommand(command)}
        />
      );
    }
    const tool = item.tool;
    const reason = reasons[TOOLS.indexOf(tool)];
    const pressed = isToolActive(tool, { activeTool, transformMode });
    return (
      <ToolbarButton
        key={tool.id}
        className="tool-bar-tool"
        testId={`tool-${tool.id}`}
        title={toolTitle(tool.title, tool.shortcut?.keys, reason)}
        icon={tool.icon}
        label={labels ? tool.label : undefined}
        active={pressed}
        pressed={pressed}
        disabled={!!reason}
        onClick={() => openTool(tool.id)}
      />
    );
  };

  return (
    <div className="tool-strip" data-testid="tool-strip">
      <div className="tool-strip-band" ref={bandRef}>
        <div
          className={`tool-strip-pill${labels ? ' with-labels' : ''}${compact ? ' compact' : ''}`}
          data-testid="tool-bar"
          role="toolbar"
          aria-label="Tools"
        >
          {visible.map((group) => (
            <div className="tool-bar-group" key={group} data-group={group}>
              <span className="tool-sep" aria-hidden="true" />
              {itemsOfGroup(group).map(button)}
            </div>
          ))}
          {hidden.length > 0 && <StripOverflow items={hiddenItems(hidden)} labels={labels} facts={facts} />}
        </div>
      </div>
    </div>
  );
}

/**
 * The trailing groups that did not fit, as one "⋯" menu. Its items are the same entries with the same
 * tooltips and the same disabled reasons; choosing one closes the menu and does what the button would.
 */
function StripOverflow({ items, labels, facts }: { items: StripItem[]; labels: boolean; facts: CommandFacts }) {
  const activeTool = useStore((s) => s.activeTool);
  const transformMode = useStore((s) => s.transformMode);
  const signature = useStore(availabilitySignature);
  const openTool = useStore((s) => s.openTool);
  const reasons = signature.split('\u0000');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    // capture phase: Escape closes the menu and must not also close the open tool
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  /** What one item shows and what it does. */
  const row = (item: StripItem) => {
    if (item.kind === 'command') {
      const command: StripCommand = item.command;
      return {
        key: command,
        name: labels ? COMMAND_LABELS[command] : itemName(item),
        title: commandTitle(command, facts),
        icon: COMMAND_ICONS[command],
        keyLabel: COMMAND_KEYS[command],
        disabled: commandDisabled(facts)[command],
        pressed: false,
        run: () => runStripCommand(command),
      };
    }
    const tool = item.tool;
    const reason = reasons[TOOLS.indexOf(tool)];
    return {
      key: tool.id,
      name: itemName(item),
      title: toolTitle(tool.title, tool.shortcut?.keys, reason),
      icon: tool.icon,
      keyLabel: tool.shortcut?.keys.at(-1) ?? '',
      disabled: !!reason,
      pressed: isToolActive(tool, { activeTool, transformMode }),
      run: () => openTool(tool.id),
    };
  };

  return (
    <div className="strip-overflow" ref={ref}>
      <button
        className={`strip-overflow-trigger${open ? ' active' : ''}`}
        title="More tools"
        aria-label="More tools"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid="tool-overflow"
      >
        <Icon name="more" size={18} />
      </button>
      {open && (
        <div className="strip-overflow-menu" role="menu" aria-label="More tools" data-testid="tool-overflow-menu">
          {items.map((item) => {
            const r = row(item);
            return (
              <button
                key={r.key}
                role="menuitem"
                title={r.title}
                aria-pressed={r.pressed}
                disabled={r.disabled}
                data-testid={`tool-overflow-${r.key}`}
                onClick={() => {
                  setOpen(false);
                  r.run();
                }}
              >
                <Icon name={r.icon} size={16} />
                <span className="strip-overflow-name">{r.name}</span>
                {r.keyLabel && <kbd>{r.keyLabel}</kbd>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
