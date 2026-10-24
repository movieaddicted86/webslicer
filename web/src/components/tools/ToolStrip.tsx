/**
 * The tool strip (layout 3.0, L-4): the floating pill at the top centre of the scene. It is the one
 * place that opens a tool – the registry provides the buttons, their groups, their shortcuts and their
 * disabled reasons – and it also carries the object commands that act on the selection and the
 * Prepare | Preview switch that used to be two tabs in the top bar.
 *
 * The pill's groups are in PrusaSlicer's order. When they do not fit, the trailing ones move into an
 * overflow menu; `stripLayout` decides that from the width the scene offers, so the layout is pure and
 * testable and the strip never wraps. On a narrow screen it scrolls instead: a dropdown over the scene
 * would cover the object the user just tapped.
 *
 * Names appear next to the icons only while the whole strip still fits with them – a horizontal strip
 * has far less room than the old vertical bar, so the width decides and there is no separate switch.
 * Every button carries its "Name (Key)" tooltip (and the reason when it is disabled).
 *
 * The strip keeps the `tool-bar` hook: it is still the one control that opens the tools. Its buttons
 * keep `tool-<id>`, and each carries `aria-pressed` for the open tool.
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
  SWITCH_TEXT_QUERY,
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
import { STRIP_VIEW_ENTRIES } from '../../nav/navMap';
import './ToolStrip.css';

/** The reason each tool is unavailable (`''` when it is available), as one comparable string. */
const availabilitySignature = (state: State) => TOOLS.map((t) => t.isAvailable(state).reason ?? '').join('\u0000');

/** The two views the switch offers; the table lives in the navigation map (one home per function). */
const VIEWS = STRIP_VIEW_ENTRIES;

export function ToolStrip() {
  const activeTool = useStore((s) => s.activeTool);
  const transformMode = useStore((s) => s.transformMode);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const openTool = useStore((s) => s.openTool);
  const signature = useStore(availabilitySignature);
  const facts = useStore(useShallow(commandFacts));
  const reasons = signature.split('\u0000');
  const hostRef = useRef<HTMLDivElement>(null);
  // the scene's width decides the fit; the window width is the first guess, the observer corrects it
  const [room, setRoom] = useState(() => window.innerWidth);
  const compact = useMediaQuery(COMPACT_QUERY);
  const switchText = useMediaQuery(SWITCH_TEXT_QUERY);

  // the room the strip has is the width of the scene it floats over, not the window: the columns and
  // the rail change how much is left at the same window size
  useEffect(() => {
    const scene = hostRef.current?.parentElement;
    if (!scene) return;
    const observer = new ResizeObserver(([entry]) => setRoom(entry.contentRect.width));
    observer.observe(scene);
    return () => observer.disconnect();
  }, []);

  const available = stripRoom(room, switchText);
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
    <div className="tool-strip" data-testid="tool-strip" ref={hostRef}>
      <div
        className={`tool-strip-pill${labels ? ' with-labels' : ''}${compact ? ' compact' : ''}`}
        data-testid="tool-bar"
        role="toolbar"
        aria-label="Tools"
      >
        <div
          className={`strip-switch${switchText ? ' with-text' : ''}`}
          role="radiogroup"
          aria-label="View"
          data-testid="view-switch"
          onKeyDown={(e) => {
            // the two radios walk with the arrow keys, as a segmented control should
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            const next = view === 'plater' ? 'preview' : 'plater';
            setView(next);
            e.currentTarget.querySelector<HTMLButtonElement>(`[data-testid="view-${next}"]`)?.focus();
          }}
        >
          {VIEWS.map((v) => {
            // every entry of the map is a view; the switch is a radiogroup, so each button is a radio
            const id = v.action.kind === 'view' ? v.action.view : 'plater';
            return (
              <button
                key={v.id}
                role="radio"
                aria-checked={view === id}
                aria-label={v.label}
                title={`${v.label} view`}
                tabIndex={view === id ? 0 : -1}
                className={view === id ? 'active' : ''}
                onClick={() => setView(id)}
                data-testid={v.testId}
                data-nav-id={v.id}
              >
                <Icon name={v.icon} size={16} />
                <span className="strip-switch-label">{v.label}</span>
              </button>
            );
          })}
        </div>
        {visible.map((group) => (
          <div className="tool-bar-group" key={group} data-group={group}>
            <span className="tool-sep" aria-hidden="true" />
            {itemsOfGroup(group).map(button)}
          </div>
        ))}
        {hidden.length > 0 && <StripOverflow items={hiddenItems(hidden)} labels={labels} facts={facts} />}
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
