import type { LucideIcon } from 'lucide-react';

/** One button of a section toolbar (F-13) – the tools of the objects panel and of Simple mode. */
export function ToolbarButton({
  title,
  icon: Icon,
  onClick,
  disabled,
  active,
  className,
  label,
  testId,
}: {
  title: string;
  /** the SVG icon of the action – the same icon everywhere the action appears */
  icon: LucideIcon;
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
      <Icon size={18} strokeWidth={2} aria-hidden="true" focusable="false" />
      {label && (
        <span className="btn-label" aria-hidden="true">
          {label}
        </span>
      )}
    </button>
  );
}
