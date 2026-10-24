/**
 * The frame every tool panel sits in (T-046): the tool's title, a close button, a scrolling body and
 * an optional sticky footer for the primary action ("Perform cut"). The tool supplies only its body
 * (and footer); position and size live in CSS (`styles.css`), so the mobile layout (P3) can turn the
 * same panel into a bottom sheet without touching a component.
 */
import type { ReactNode } from 'react';
import { CLOSE_ICON } from '../common/icons';
import { ToolbarButton } from '../common/ToolbarButton';
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
  return (
    <div className="tool-panel" role="dialog" aria-label={title} data-testid="tool-panel">
      <div className="tool-panel-head">
        <span className="tool-panel-title" data-testid="tool-panel-title">
          {title}
        </span>
        <ToolbarButton
          title={`Close ${title} (Esc)`}
          icon={CLOSE_ICON}
          onClick={onClose}
          className="tool-panel-close"
          testId="tool-panel-close"
        />
      </div>
      <div className="tool-panel-body">{children}</div>
      {footer && (
        <div className="tool-panel-foot" data-testid="tool-panel-foot">
          {footer}
        </div>
      )}
    </div>
  );
}
