import type { ReactNode } from 'react';
import './PanelRow.css';

/**
 * One row of a panel card: the name on the left, its control in the right-hand 150 px column. The
 * rows are the mockup's compact form – a whole card of labelled controls, each with the same weight
 * and the same alignment, instead of a form whose labels wander with the control width.
 *
 * The control is whatever the card needs (a select, a numeric field, a switch, a button); the row only
 * gives it its place and its line height.
 */
export function PanelRow({
  label,
  title,
  testId,
  children,
}: {
  label: ReactNode;
  /** a tooltip on the name */
  title?: string;
  /** the row's hook, for the rows a spec reads as one thing (a setting and its switch) */
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div className="panel-row" data-testid={testId}>
      <span className="lab" title={title}>
        {label}
      </span>
      <span className="ctl">{children}</span>
    </div>
  );
}
