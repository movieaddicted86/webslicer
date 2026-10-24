import { Icon } from '../../icons/Icon';
import type { IconName } from '../../icons/table';

/**
 * One icon button of a toolbar – the tools of the strip, the object list and Simple mode, and the
 * tool panels' chrome. The title is the button's accessible name and its tooltip ("Name (Key)", and
 * the reason when it is disabled).
 *
 * `active` paints the button as the current mode; `pressed` says the same thing to assistive
 * technology (`aria-pressed`) and is set on the buttons that are a toggle, such as the open tool.
 */
export function ToolbarButton({
  title,
  icon,
  onClick,
  disabled,
  active,
  pressed,
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
  /** the button is a toggle and is currently on; announced as `aria-pressed` */
  pressed?: boolean;
  className?: string;
  /** a visible name next to the icon (the wide tool bar, T-055); without it the button is icon-only */
  label?: string;
  /** a stable test hook; it names the action, not its place on the screen */
  testId?: string;
}) {
  const cls = [active && 'active', className].filter(Boolean).join(' ');
  // Icon-only buttons show the tooltip as the accessible name; a labelled one carries the name itself.
  return (
    <button
      className={cls || undefined}
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
    >
      <Icon name={icon} size={18} />
      {label && (
        <span className="btn-label" aria-hidden="true">
          {label}
        </span>
      )}
    </button>
  );
}
