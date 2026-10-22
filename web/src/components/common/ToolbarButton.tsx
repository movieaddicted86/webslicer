import type { LucideIcon } from 'lucide-react';

/** One button of a section toolbar (F-13) – the tools of the objects panel and of Simple mode. */
export function ToolbarButton({
  title,
  icon: Icon,
  onClick,
  disabled,
  active,
  className,
}: {
  title: string;
  /** the SVG icon of the action – the same icon everywhere the action appears */
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  /** draws the pressed state of a mode button (move/rotate/scale, place on face) */
  active?: boolean;
  className?: string;
}) {
  const cls = [active && 'active', className].filter(Boolean).join(' ');
  // The buttons show an icon only, so the tooltip is also the accessible name.
  return (
    <button className={cls || undefined} title={title} aria-label={title} onClick={onClick} disabled={disabled}>
      <Icon size={18} strokeWidth={2} aria-hidden="true" focusable="false" />
    </button>
  );
}
