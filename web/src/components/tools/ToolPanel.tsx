/**
 * The frame every tool panel sits in: the tool's title, a close button, a scrolling body and an
 * optional sticky footer for the primary action ("Perform cut"). The tool supplies only its body
 * (and footer).
 *
 * Since layout step L-4 the frame is rendered inside the context panel's tool mode, so the panel is
 * the right column instead of a box next to the tool bar; its header and footer stay in view and the
 * body scrolls. The hint block at the end of the body comes from the open tool's registry entry, so
 * every tool panel has one and no tool has to remember to add it.
 */
import type { ReactNode } from 'react';
import { useStore } from '../../state/store';
import { toolById } from '../../tools/registry';
import { ToolHints } from './ToolHints';
import { Icon } from '../../icons/Icon';
import './ToolPanel.css';

export function ToolPanel({
  title,
  onClose,
  footer,
  children,
}: {
  title: string;
  /** closes the tool (Esc does the same) */
  onClose: () => void;
  /** the primary action(s), pinned to the bottom of the panel */
  footer?: ReactNode;
  children: ReactNode;
}) {
  // the registry entry of the open tool carries its key hints; the panel frame shows them
  const tool = toolById(useStore((s) => s.activeTool));
  return (
    <div className="tool-panel" role="dialog" aria-label={title} data-testid="tool-panel">
      <div className="tool-panel-head">
        <span className="tool-panel-title" data-testid="tool-panel-title">
          {title}
        </span>
        <button
          type="button"
          className="tool-panel-close"
          title="Close (Esc)"
          aria-label="Close (Esc)"
          onClick={onClose}
          data-testid="tool-panel-close"
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="tool-panel-body">
        {children}
        {tool && <ToolHints tool={tool} />}
      </div>
      {footer && (
        <div className="tool-panel-foot" data-testid="tool-panel-foot">
          {footer}
        </div>
      )}
    </div>
  );
}
