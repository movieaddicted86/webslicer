import { useId, type ReactNode } from 'react';
import type { IconName } from '../../icons/table';
import { Icon } from '../../icons/Icon';
import './PanelCard.css';

/**
 * One titled card of the context panel: a heading with an optional icon and a body. The cards are the
 * blocks of a mode (Transform, Settings, Parts, Layer ranges, Printer, …), so the panel reads as a
 * short stack of named things instead of one long form.
 *
 * The heading is the `aria-labelledby` of the section: a screen reader announces each card by its
 * name and the page can be walked by heading.
 */
export function PanelCard({
  title,
  icon,
  aside,
  testId,
  children,
}: {
  title: ReactNode;
  icon?: IconName;
  /** a control in the heading's corner (an action that belongs to the whole card) */
  aside?: ReactNode;
  testId?: string;
  children: ReactNode;
}) {
  const id = useId();
  const titleId = `${id}-title`;
  return (
    <section className="panel-card" data-testid={testId} aria-labelledby={titleId}>
      <div className="panel-card-head">
        <h3 id={titleId} className="panel-card-title">
          {icon && <Icon name={icon} size={16} />}
          {title}
        </h3>
        {aside}
      </div>
      <div className="panel-card-body">{children}</div>
    </section>
  );
}
