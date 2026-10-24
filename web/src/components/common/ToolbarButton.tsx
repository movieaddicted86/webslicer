import { Icon } from '../../icons/Icon';
import type { IconName } from '../../icons/table';

/** One button of a section toolbar (F-13) – the tools of the objects panel and of Simple mode. */
export function ToolbarButton({
  title,
  icon,
  onClick,
  disabled,
  active,
  className,
  label,
  testId,
}: {
  title: string;
  /** the function whose icon the button shows – the same icon everywhere the function appears */
  icon: IconName;
  onClick: () => void;
  disabled?: boolean;
  /** draws the pressed state of a mode button (move/rotate/scale, place on face) */
  active?: boolean;
  className?: string;
  /** a visible name next to the icon (the wide tool bar, T-055); without it the button is icon-only */
  label?: string;
  /** a stable test hook; it names the action, not its place on the screen */
  testId?: string;
}) {
  const cls = [active && 'active', className].filter(Boolean).join(' ');
  // Icon-only buttons show the tooltip as the accessible name; a labelled one carries the name itself.
  return (
    <button className={cls || undefined} title={title} aria-label={title} onClick={onClick} disabled={disabled} data-testid={testId}>
      <Icon name={icon} size={18} />
      {label && (
        <span className="btn-label" aria-hidden="true">
          {label}
        </span>
      )}
    </button>
  );
}
