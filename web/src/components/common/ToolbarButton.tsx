import type { ReactNode } from 'react';

/** One button of a section toolbar (F-13) – the tools of the objects panel and of Simple mode. */
export function ToolbarButton({
  title,
  onClick,
  disabled,
  active,
  className,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  /** draws the pressed state of a mode button (move/rotate/scale, place on face) */
  active?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const cls = [active && 'active', className].filter(Boolean).join(' ');
  return (
    <button className={cls || undefined} title={title} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
