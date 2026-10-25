import { useId, type ReactNode } from 'react';
import { Icon } from '../../icons/Icon';
import { SectionHeader } from '../common/SectionHeader';
import './SideCard.css';

/**
 * A collapsible card of the left column (layout 3.0): a heading with a title and a chevron that folds
 * the body away. The heading is a real `section` heading through `SectionHeader`, the chevron a button
 * with `aria-expanded` and `aria-controls`, so the fold is reachable and announced by the keyboard and
 * the screen reader instead of being a click-only decoration.
 *
 * The body is only rendered while the card is open, so a folded card costs nothing but its heading.
 */
export function SideCard({
  title,
  count,
  aside,
  open,
  onToggle,
  toggleLabel,
  testId,
  toggleTestId,
  children,
}: {
  title: ReactNode;
  /** a small number after the title (the object count) */
  count?: number;
  /** a control of the whole card in its heading, before the fold chevron (a badge, a select) */
  aside?: ReactNode;
  /** the body is visible; the chevron reports it as `aria-expanded` */
  open: boolean;
  onToggle: () => void;
  /** what the chevron does, as its tooltip and accessible name */
  toggleLabel: string;
  testId?: string;
  toggleTestId?: string;
  children: ReactNode;
}) {
  const id = useId();
  const titleId = `${id}-title`;
  const bodyId = `${id}-body`;
  return (
    <section className={`side-card ${open ? '' : 'folded'}`} data-testid={testId} aria-labelledby={titleId}>
      <SectionHeader
        title={
          <span id={titleId} className="side-card-title">
            {title}
            {count !== undefined && <span className="badge">{count}</span>}
          </span>
        }
      >
        {aside}
        <button
          className="card-chevron"
          data-testid={toggleTestId}
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={toggleLabel}
          title={toggleLabel}
          onClick={onToggle}
        >
          <Icon name="expand" size={16} />
        </button>
      </SectionHeader>
      {open && (
        <div className="side-card-body" id={bodyId}>
          {children}
        </div>
      )}
    </section>
  );
}
